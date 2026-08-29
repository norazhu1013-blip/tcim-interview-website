import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const EXPECTED_SCHEMA_VERSION = '0.1.0'
export const EXPECTED_DATASET_ID = 'TCIM_NEW_FIVE_TABLES_RUNTIME_V0.1'
export const EXPECTED_QUESTION_IDS = Object.freeze(
  Array.from({ length: 10 }, (_, index) => 'Q' + String(index + 1).padStart(2, '0'))
)

const LEGACY_KEY_NAMES = new Set([
  'common',
  'items',
  'ontology',
  'slots',
  'anchors',
  'priority',
  'probe',
  'stop',
  'abilityframework',
  'itemcapabilitymapping',
  'empiricalscoringrules',
  'slotid',
  'targetslot',
  'targetslots',
  'evidenceslots'
])

const TEVV_KEY_NAMES = new Set([
  'tevcaseid',
  'tevlevel',
  'tevmethod',
  'slicedimensions',
  'releasegate'
])

const DIALOGUE_RUNTIME_BY_TYPE = Object.freeze({
  AFFORDANCE: 'AFFORDANCE_CARD',
  MONITOR: 'MONITOR_CARD',
  HARD_BOUNDARY: 'HARD_BOUNDARY',
  COMPILATION_BOUNDARY: 'COMPILER_BOUNDARY'
})

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && Boolean(value.trim())
}

function normalizeKey(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function addIssue(list, code, location, message) {
  list.push({ code, location, message })
}

function sortIssues(issues) {
  return issues.sort((left, right) =>
    (left.location + '|' + left.code + '|' + left.message)
      .localeCompare(right.location + '|' + right.code + '|' + right.message, 'en')
  )
}

function walk(value, location, visit) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, location + '[' + index + ']', visit))
    return
  }
  if (!isObject(value)) return
  for (const [key, child] of Object.entries(value)) {
    const childLocation = location + '.' + key
    visit(key, child, childLocation)
    walk(child, childLocation, visit)
  }
}

function arrayField(owner, key, location, errors, required = true) {
  const value = owner?.[key]
  if (Array.isArray(value)) return value
  if (required || value !== undefined) {
    addIssue(errors, 'array_required', location + '.' + key, key + ' 必须是数组')
  }
  return []
}

function collectEntries(globalData, questions, field, errors) {
  const entries = []
  for (const [index, value] of arrayField(globalData, field, '$.global', errors).entries()) {
    entries.push({ value, location: '$.global.' + field + '[' + index + ']', questionId: 'ALL' })
  }
  for (const questionId of EXPECTED_QUESTION_IDS) {
    const question = questions[questionId]
    if (!isObject(question)) continue
    for (const [index, value] of arrayField(question, field, '$.questions.' + questionId, errors).entries()) {
      entries.push({ value, location: '$.questions.' + questionId + '.' + field + '[' + index + ']', questionId })
    }
  }
  return entries
}

function validateUniqueField(entries, field, label, errors) {
  const seen = new Map()
  for (const entry of entries) {
    const value = entry.value?.[field]
    if (!isNonEmptyString(value)) {
      addIssue(errors, 'id_required', entry.location + '.' + field, label + ' 不能为空')
      continue
    }
    if (seen.has(value)) {
      addIssue(
        errors,
        'duplicate_id',
        entry.location + '.' + field,
        label + ' 重复：' + value + '；首次位于 ' + seen.get(value)
      )
    } else {
      seen.set(value, entry.location + '.' + field)
    }
  }
  return new Set(seen.keys())
}

function validateHardBoundaries(dialogueEntries, errors) {
  const hardCounts = new Map(EXPECTED_QUESTION_IDS.map((id) => [id, 0]))
  hardCounts.set('ALL', 0)

  for (const entry of dialogueEntries) {
    const policy = entry.value
    const byType = policy?.type === 'HARD_BOUNDARY'
    const byRuntime = policy?.runtimeUse === 'HARD_BOUNDARY'
    if (!byType && !byRuntime) continue

    if (byType !== byRuntime) {
      addIssue(
        errors,
        'hard_boundary_marker_mismatch',
        entry.location,
        'HARD_BOUNDARY 必须同时由 type 与 runtimeUse 标识'
      )
    }
    if (policy?.constraintLevel !== 'HARD') {
      addIssue(
        errors,
        'hard_boundary_not_hard',
        entry.location + '.constraintLevel',
        'HARD_BOUNDARY 的 constraintLevel 必须为 HARD'
      )
    }
    if (!Array.isArray(policy?.prohibitedActions) || policy.prohibitedActions.length === 0) {
      addIssue(
        errors,
        'hard_boundary_actions_missing',
        entry.location + '.prohibitedActions',
        'HARD_BOUNDARY 必须包含可识别的 prohibitedActions'
      )
    }
    hardCounts.set(entry.questionId, (hardCounts.get(entry.questionId) || 0) + 1)
  }

  for (const scope of ['ALL', ...EXPECTED_QUESTION_IDS]) {
    if ((hardCounts.get(scope) || 0) === 0) {
      const location = scope === 'ALL' ? '$.global.dialoguePolicies' : '$.questions.' + scope + '.dialoguePolicies'
      addIssue(errors, 'hard_boundary_missing', location, scope + ' 缺少可识别的 HARD_BOUNDARY')
    }
  }

  return [...hardCounts.values()].reduce((total, count) => total + count, 0)
}

function validatePretest(questions, errors) {
  for (const questionId of EXPECTED_QUESTION_IDS) {
    const question = questions[questionId]
    if (!isObject(question)) continue
    const location = '$.questions.' + questionId
    const prior = question.pretestPrior
    if (!isObject(prior)) {
      addIssue(errors, 'pretest_prior_missing', location + '.pretestPrior', 'pretestPrior 必须是对象')
    } else {
      if (prior.type !== 'PRETEST_PRIOR_RULE') {
        addIssue(errors, 'pretest_prior_type', location + '.pretestPrior.type', '前测先验必须标为 PRETEST_PRIOR_RULE')
      }
      if (prior.assessmentRelation !== 'PRIOR_ONLY') {
        addIssue(errors, 'pretest_not_prior_only', location + '.pretestPrior.assessmentRelation', '前测先验必须标为 PRIOR_ONLY')
      }
    }

    const options = arrayField(question, 'pretestOptions', location, errors)
    if (options.length === 0) {
      addIssue(errors, 'pretest_options_missing', location + '.pretestOptions', '每题必须包含前测选项')
    }
    for (const [index, option] of options.entries()) {
      if (option?.type !== 'PRETEST_OPTION' || option?.assessmentRelation !== 'PRIOR_ONLY') {
        addIssue(
          errors,
          'pretest_option_not_prior_only',
          location + '.pretestOptions[' + index + ']',
          '前测选项必须同时标为 PRETEST_OPTION 与 PRIOR_ONLY'
        )
      }
    }
  }
}

function validateDialogueReferences(questions, globalData, errors) {
  const globalUnderstandingIds = new Set(
    arrayField(globalData, 'evidencePolicies', '$.global', errors)
      .map((policy) => policy?.understandingId)
      .filter(isNonEmptyString)
  )
  const globalCapabilityIds = new Set(
    arrayField(globalData, 'professionalLenses', '$.global', errors)
      .map((lens) => lens?.capabilityId)
      .filter(isNonEmptyString)
  )

  for (const questionId of EXPECTED_QUESTION_IDS) {
    const question = questions[questionId]
    if (!isObject(question)) continue
    const questionLocation = '$.questions.' + questionId
    const understandingIds = new Set(globalUnderstandingIds)
    const capabilityIds = new Set(globalCapabilityIds)
    for (const policy of arrayField(question, 'evidencePolicies', questionLocation, errors)) {
      if (isNonEmptyString(policy?.understandingId)) understandingIds.add(policy.understandingId)
    }
    for (const lens of arrayField(question, 'professionalLenses', questionLocation, errors)) {
      if (isNonEmptyString(lens?.capabilityId)) capabilityIds.add(lens.capabilityId)
    }

    const dialoguePolicies = arrayField(question, 'dialoguePolicies', questionLocation, errors)
    for (const [index, policy] of dialoguePolicies.entries()) {
      const policyLocation = questionLocation + '.dialoguePolicies[' + index + ']'
      for (const understandingId of arrayField(policy, 'targetUnderstandingIds', policyLocation, errors)) {
        if (!understandingIds.has(understandingId)) {
          addIssue(
            errors,
            'unresolved_target_understanding',
            policyLocation + '.targetUnderstandingIds',
            '未解析 understandingId：' + String(understandingId)
          )
        }
      }
      for (const capabilityId of arrayField(policy, 'targetCapabilityIds', policyLocation, errors)) {
        if (!capabilityIds.has(capabilityId)) {
          addIssue(
            errors,
            'unresolved_target_capability',
            policyLocation + '.targetCapabilityIds',
            '未解析 capabilityId：' + String(capabilityId)
          )
        }
      }
    }
  }
}

function validateEvidenceReferences(synthesisEntries, claimIds, errors) {
  for (const entry of synthesisEntries) {
    const refs = arrayField(entry.value, 'requiredEvidenceClaimIds', entry.location, errors, false)
    for (const claimId of refs) {
      if (!claimIds.has(claimId)) {
        addIssue(
          errors,
          'unresolved_evidence_claim',
          entry.location + '.requiredEvidenceClaimIds',
          '未解析 evidenceClaimId：' + String(claimId)
        )
      }
    }
  }
}

function collectWarnings(data, lensEntries, evidenceEntries, dialogueEntries, warnings) {
  const capabilityIds = new Set(
    lensEntries.map((entry) => entry.value?.capabilityId).filter(isNonEmptyString)
  )
  const unresolvedParents = []
  for (const entry of lensEntries) {
    const parents = Array.isArray(entry.value?.parentCapabilityIds) ? entry.value.parentCapabilityIds : []
    for (const parent of parents) {
      if (!capabilityIds.has(parent)) unresolvedParents.push({ parent, location: entry.location })
    }
  }
  if (unresolvedParents.length > 0) {
    const examples = unresolvedParents.slice(0, 3).map((item) => item.parent).join(', ')
    addIssue(
      warnings,
      'unresolved_parent_labels',
      '$.global/professionalLenses',
      unresolvedParents.length + ' 个 parentCapabilityIds 未解析；仅警告。示例：' + examples
    )
  }

  const withoutPathRefs = evidenceEntries.filter((entry) =>
    !Array.isArray(entry.value?.pathRefs) || entry.value.pathRefs.length === 0
  )
  if (withoutPathRefs.length > 0) {
    addIssue(
      warnings,
      'path_refs_not_compiled',
      '$.global/questions.evidencePolicies',
      withoutPathRefs.length + ' 条证据政策没有编译 pathRefs；按已知源数据缺口仅警告'
    )
  }

  const runtimeMismatches = dialogueEntries.filter((entry) => {
    const expected = DIALOGUE_RUNTIME_BY_TYPE[entry.value?.type]
    return expected && entry.value?.runtimeUse !== expected
  })
  if (runtimeMismatches.length > 0) {
    const examples = runtimeMismatches.slice(0, 3).map((entry) => entry.value?.policyId).join(', ')
    addIssue(
      warnings,
      'dialogue_runtime_use_mismatch',
      '$.global/questions.dialoguePolicies',
      runtimeMismatches.length + ' 条 type/runtimeUse 不匹配；按已知源数据问题仅警告。示例：' + examples
    )
  }

  void data
}

export function validateNewFiveRuntime(data) {
  const errors = []
  const warnings = []

  if (!isObject(data)) {
    addIssue(errors, 'root_not_object', '$', '运行时数据必须是对象')
    return { ok: false, errors, warnings, stats: {} }
  }

  if (data.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    addIssue(
      errors,
      'schema_version_mismatch',
      '$.schemaVersion',
      'schemaVersion 必须为 ' + EXPECTED_SCHEMA_VERSION
    )
  }
  if (data.datasetId !== EXPECTED_DATASET_ID) {
    addIssue(errors, 'dataset_id_mismatch', '$.datasetId', 'datasetId 必须为 ' + EXPECTED_DATASET_ID)
  }

  const globalData = isObject(data.global) ? data.global : {}
  if (!isObject(data.global)) addIssue(errors, 'global_missing', '$.global', 'global 必须是对象')
  const questions = isObject(data.questions) ? data.questions : {}
  if (!isObject(data.questions)) addIssue(errors, 'questions_missing', '$.questions', 'questions 必须是对象')

  const actualQuestionIds = Object.keys(questions).sort()
  const expectedQuestionIds = [...EXPECTED_QUESTION_IDS].sort()
  if (JSON.stringify(actualQuestionIds) !== JSON.stringify(expectedQuestionIds)) {
    addIssue(
      errors,
      'question_set_mismatch',
      '$.questions',
      'questions 必须且只能包含 Q01-Q10；实际为 ' + actualQuestionIds.join(', ')
    )
  }
  for (const questionId of EXPECTED_QUESTION_IDS) {
    const question = questions[questionId]
    if (!isObject(question)) continue
    if (question.questionId !== questionId) {
      addIssue(
        errors,
        'question_id_mismatch',
        '$.questions.' + questionId + '.questionId',
        'questionId 必须与对象键一致'
      )
    }
  }

  walk(data, '$', (key, value, location) => {
    const normalized = normalizeKey(key)
    if (LEGACY_KEY_NAMES.has(normalized)) {
      addIssue(errors, 'legacy_key_present', location, '发现旧五表结构键：' + key)
    }
    if (TEVV_KEY_NAMES.has(normalized)) {
      addIssue(errors, 'tevv_field_present', location, '运行时不得包含 TEVV 字段：' + key)
    }
    if ((key === 'type' && value === 'TEVV') || (key === 'runtimeUse' && value === 'TEVV_CASE')) {
      addIssue(errors, 'tevv_policy_present', location, 'TEVV policy 不得进入运行时')
    }
  })

  const lensEntries = collectEntries(globalData, questions, 'professionalLenses', errors)
  const evidenceEntries = collectEntries(globalData, questions, 'evidencePolicies', errors)
  const dialogueEntries = collectEntries(globalData, questions, 'dialoguePolicies', errors)
  const synthesisEntries = collectEntries(globalData, questions, 'synthesisPolicies', errors)

  const claimIds = validateUniqueField(evidenceEntries, 'evidenceClaimId', 'evidenceClaimId', errors)
  validateUniqueField(evidenceEntries, 'understandingId', 'understandingId', errors)
  validateUniqueField(
    [...dialogueEntries, ...synthesisEntries],
    'policyId',
    'dialogue/synthesis policyId',
    errors
  )

  validateDialogueReferences(questions, globalData, errors)
  validateEvidenceReferences(synthesisEntries, claimIds, errors)
  const hardBoundaryCount = validateHardBoundaries(dialogueEntries, errors)
  validatePretest(questions, errors)
  collectWarnings(data, lensEntries, evidenceEntries, dialogueEntries, warnings)

  return {
    ok: errors.length === 0,
    errors: sortIssues(errors),
    warnings: sortIssues(warnings),
    stats: {
      questions: actualQuestionIds.length,
      professionalLenses: lensEntries.length,
      evidencePolicies: evidenceEntries.length,
      dialoguePolicies: dialogueEntries.length,
      synthesisPolicies: synthesisEntries.length,
      hardBoundaries: hardBoundaryCount
    }
  }
}

function formatIssue(issue) {
  return '[' + issue.code + '] ' + issue.location + ' — ' + issue.message
}

export function verifyRuntimeFile(runtimeFile) {
  let data
  try {
    data = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'))
  } catch (error) {
    return {
      ok: false,
      errors: [{
        code: 'runtime_json_unreadable',
        location: runtimeFile,
        message: error instanceof Error ? error.message : String(error)
      }],
      warnings: [],
      stats: {}
    }
  }
  return validateNewFiveRuntime(data)
}

const currentFile = fileURLToPath(import.meta.url)
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFile)

if (isDirectRun) {
  const runtimeFile = path.resolve(
    path.dirname(currentFile),
    '../src/generated/tcim-new-five-tables.runtime.v0.1.json'
  )
  const result = verifyRuntimeFile(runtimeFile)

  for (const warning of result.warnings) console.warn('警告：' + formatIssue(warning))
  if (!result.ok) {
    for (const error of result.errors) console.error('错误：' + formatIssue(error))
    console.error('新五表运行时验证失败：' + result.errors.length + ' 个错误')
    process.exitCode = 1
  } else {
    const stats = result.stats
    console.log(
      '新五表运行时验证通过：' +
      stats.questions + ' 题，' +
      stats.evidencePolicies + ' 条证据政策，' +
      stats.dialoguePolicies + ' 条对话政策，' +
      stats.synthesisPolicies + ' 条综合/记忆政策，' +
      stats.hardBoundaries + ' 条 HARD boundary；TEVV 未进入运行时。'
    )
  }
}
