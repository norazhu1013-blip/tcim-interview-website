import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const EXPECTED_SCHEMA_VERSION = '0.2.1'
export const EXPECTED_DATASET_ID = 'TCIM_NEW_FIVE_TABLES_RUNTIME_V0.2.1'
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
      if (/[ABCD]{4}|高分组合|\d+(?:\.\d+)?\s*分/.test(String(prior.content || ''))) {
        addIssue(errors, 'pretest_prior_overprecise', location + '.pretestPrior.content', '前测弱先验不得包含完整排序、分数或高分组合')
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

function validateEpistemicRouting(questions, errors) {
  const expected = {
    contextFacts: new Set(['SCENARIO_FACT']),
    importantUnknowns: new Set(['UNKNOWN']),
    workingHypotheses: new Set(['HUMAN_HYPOTHESIS', 'AI_HYPOTHESIS']),
    contextVariants: new Set(['CONTEXT_VARIANT'])
  }
  const expectedTypes = {
    contextFacts: new Set(['SCENARIO_FACT']),
    importantUnknowns: new Set(['IMPORTANT_UNKNOWN']),
    workingHypotheses: new Set(['IMPORTANT_UNKNOWN', 'PLAUSIBLE_INTERPRETATION']),
    contextVariants: new Set(['ALTERNATIVE_INTERPRETATION'])
  }
  for (const questionId of EXPECTED_QUESTION_IDS) {
    const question = questions[questionId]
    if (!isObject(question)) continue
    const location = '$.questions.' + questionId
    for (const [field, statuses] of Object.entries(expected)) {
      for (const [index, row] of arrayField(question, field, location, errors).entries()) {
        if (!statuses.has(row?.epistemicStatus)) {
          addIssue(errors, 'epistemic_routing_mismatch', location + '.' + field + '[' + index + ']', field + ' 中出现不匹配的认识状态：' + String(row?.epistemicStatus || ''))
        }
        if (!expectedTypes[field].has(row?.type)) {
          addIssue(errors, 'epistemic_item_type_mismatch', location + '.' + field + '[' + index + ']', field + ' 中出现不匹配的条目类型：' + String(row?.type || ''))
        }
      }
    }
  }
}

function validateProfileAttribution(evidenceEntries, errors) {
  const allowed = new Set(Array.from({ length: 12 }, (_, index) => 'C' + String(index + 1).padStart(2, '0')))
  const covered = new Set()
  for (const entry of evidenceEntries) {
    const policy = entry.value
    if (policy?.claimType !== 'CAPABILITY_EVIDENCE') continue
    const primary = String(policy?.primaryProfileCapabilityId || '')
    if (!allowed.has(primary)) {
      addIssue(errors, 'primary_profile_capability_missing', entry.location + '.primaryProfileCapabilityId', '能力证据必须且只能指定一个全局主要画像能力 C01-C12')
      continue
    }
    covered.add(primary)
    const bases = new Set((policy?.capabilityRefs || []).map((value) => String(value || '').match(/^(C\d{2})/)?.[1]).filter(Boolean))
    if (!bases.has(primary)) {
      addIssue(errors, 'primary_profile_capability_unlinked', entry.location + '.primaryProfileCapabilityId', '主要画像能力必须包含在 capabilityRefs 的全局父级中')
    }
    let anchors = policy?.supportAnchors
    if (typeof anchors === 'string') {
      try { anchors = JSON.parse(anchors) } catch { anchors = null }
    }
    const keys = isObject(anchors) ? Object.keys(anchors).sort() : []
    if (JSON.stringify(keys) !== JSON.stringify(['L0', 'L1', 'L2', 'L3'])) {
      addIssue(errors, 'support_anchor_scale_invalid', entry.location + '.supportAnchors', '支持锚点必须完整使用 L0-L3')
    }
    if (policy?.evidenceClaimId === 'Q08-T3-001') {
      const l0 = String(anchors?.L0 || '')
      if (!l0.includes('不形成能力证据') || !String(policy?.pseudoEvidence || '').includes('AI先说出办法后教师认同')) {
        addIssue(errors, 'q08_stem_pollution_not_blocked', entry.location, 'Q08 必须明确隔离题面复述及AI先提示后认同造成的虚假证据')
      }
    }
  }
  const missing = [...allowed].filter((capabilityId) => !covered.has(capabilityId))
  if (missing.length) {
    addIssue(errors, 'primary_profile_capability_coverage_gap', '$.questions', '十题能力证据无法形成以下全局画像维度：' + missing.join(', '))
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

function validateGovernanceRelations(lensEntries, evidenceEntries, dialogueEntries, errors) {
  const capabilityIds = new Set(
    lensEntries.map((entry) => entry.value?.capabilityId).filter(isNonEmptyString)
  )
  for (const entry of lensEntries) {
    const parents = Array.isArray(entry.value?.parentCapabilityIds) ? entry.value.parentCapabilityIds : []
    for (const parent of parents) {
      if (!capabilityIds.has(parent)) {
        addIssue(errors, 'unresolved_parent_capability', entry.location + '.parentCapabilityIds', '未解析 parentCapabilityId：' + String(parent))
      }
    }
  }

  const pathIdsByQuestion = new Map()
  const pathEntriesById = new Map()
  for (const entry of lensEntries) {
    const pathId = entry.value?.pathId
    if (!isNonEmptyString(pathId)) continue
    if (!pathIdsByQuestion.has(entry.questionId)) pathIdsByQuestion.set(entry.questionId, new Set())
    pathIdsByQuestion.get(entry.questionId).add(pathId)
    pathEntriesById.set(pathId, entry.value)
  }

  for (const entry of evidenceEntries) {
    const policy = entry.value || {}
    const pathRefs = arrayField(policy, 'pathRefs', entry.location, errors)
    const isOrigin = policy.claimType === 'ORIGIN_POLICY' || policy.runtimeUse === 'ORIGIN_POLICY'
    if (isOrigin) {
      if (policy.pathRelationMode !== 'NOT_APPLICABLE') {
        addIssue(errors, 'origin_path_mode_invalid', entry.location + '.pathRelationMode', 'ORIGIN_POLICY 必须为 NOT_APPLICABLE')
      }
      if (policy.pathMatchRule !== 'NONE') {
        addIssue(errors, 'origin_path_rule_invalid', entry.location + '.pathMatchRule', 'ORIGIN_POLICY 必须为 NONE')
      }
      if (pathRefs.length !== 0) {
        addIssue(errors, 'origin_path_refs_forbidden', entry.location + '.pathRefs', 'ORIGIN_POLICY 不得绑定专业路径')
      }
      continue
    }

    if (policy.pathRelationMode !== 'ALTERNATIVE_PATHS') {
      addIssue(errors, 'evidence_path_mode_invalid', entry.location + '.pathRelationMode', '能力证据必须声明 ALTERNATIVE_PATHS')
    }
    if (policy.pathMatchRule !== 'ANY_OF') {
      addIssue(errors, 'evidence_path_rule_invalid', entry.location + '.pathMatchRule', '可替代路径必须使用 ANY_OF，不能按全部满足解释')
    }
    if (pathRefs.length < 2 || pathRefs.length > 3) {
      addIssue(errors, 'evidence_path_count_invalid', entry.location + '.pathRefs', '能力证据必须绑定2—3条可替代路径')
    }
    const allowed = new Set([
      ...(pathIdsByQuestion.get('ALL') || []),
      ...(pathIdsByQuestion.get(entry.questionId) || [])
    ])
    for (const pathRef of pathRefs) {
      if (!allowed.has(pathRef)) {
        addIssue(errors, 'unresolved_evidence_path', entry.location + '.pathRefs', '未解析或跨题 pathId：' + String(pathRef))
      }
    }
    const pathParents = new Set(pathRefs.flatMap((pathRef) => pathEntriesById.get(pathRef)?.parentCapabilityIds || []))
    const capabilityBases = new Set((policy.capabilityRefs || []).map((value) => String(value || '').match(/^(C\d{2})/)?.[1]).filter(Boolean))
    if (JSON.stringify([...pathParents].sort()) !== JSON.stringify([...capabilityBases].sort())) {
      addIssue(errors, 'evidence_path_capability_mismatch', entry.location + '.capabilityRefs', 'capabilityRefs 必须与所绑定路径的全局父级集合完全一致')
    }
    if (!pathParents.has(String(policy.primaryProfileCapabilityId || ''))) {
      addIssue(errors, 'primary_profile_capability_path_mismatch', entry.location + '.primaryProfileCapabilityId', '主要画像能力必须属于所绑定路径的全局父级')
    }
  }

  for (const entry of dialogueEntries) {
    const expected = DIALOGUE_RUNTIME_BY_TYPE[entry.value?.type]
    if (expected && entry.value?.runtimeUse !== expected) {
      addIssue(errors, 'dialogue_runtime_use_mismatch', entry.location + '.runtimeUse', 'type=' + entry.value?.type + ' 时必须为 ' + expected)
    }
  }
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
  validateEpistemicRouting(questions, errors)
  validateProfileAttribution(evidenceEntries, errors)
  validateGovernanceRelations(lensEntries, evidenceEntries, dialogueEntries, errors)

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
    '../src/generated/tcim-new-five-tables.runtime.v0.2.1.json'
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
