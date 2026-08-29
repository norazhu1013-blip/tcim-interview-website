/** Dialogue Agent 领域契约，直接消费新版运行数据。 */

export const RUNTIME_CARD_SCHEMA = 'dialogue-agent.runtime-card/v2'
export const AGENT_RESULT_SCHEMA = 'dialogue-agent.result/v2'
export const AGENT_REQUEST_SCHEMA = 'dialogue-agent.request/v2'

export const AGENT_ACTIONS = Object.freeze(['ASK', 'CLOSE'])
export const BOUNDARY_KINDS = Object.freeze(['NONE', 'SAFETY', 'PRIVACY', 'EXIT'])
export const EVIDENCE_RELATIONS = Object.freeze(['SUPPORT', 'CONTRADICT', 'REVISE'])
export const RESPONSE_ORIGINS = Object.freeze(['RO0', 'RO1', 'RO2', 'RO3', 'RO4'])
export const EVIDENCE_STATUSES = Object.freeze([
  'NOT_DEMONSTRATED',
  'PARTIAL',
  'SUFFICIENT',
  'HIGH_QUALITY'
])

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmpty(value) {
  return typeof value === 'string' && Boolean(value.trim())
}

function add(errors, condition, message) {
  if (!condition) errors.push(message)
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

export function evidenceKey(evidenceClaimId, understandingId) {
  return `${String(evidenceClaimId || '')}::${String(understandingId || '')}`
}

export function createRuntimeCard(input = {}) {
  return {
    schemaVersion: RUNTIME_CARD_SCHEMA,
    runtimeCardId: input.runtimeCardId || `${input.sessionId || 'session'}:${input.itemId || 'question'}`,
    sessionId: input.sessionId || '',
    itemId: input.itemId || '',
    scenarioBrief: clone(input.scenarioBrief || {}),
    professionalLenses: clone(input.professionalLenses || []),
    evidencePolicies: clone(input.evidencePolicies || []),
    dialoguePolicies: clone(input.dialoguePolicies || []),
    synthesisPolicies: clone(input.synthesisPolicies || []),
    dataProvenance: clone(input.dataProvenance || {})
  }
}

export function evidencePolicyMap(runtimeCard) {
  const map = new Map()
  for (const policy of runtimeCard?.evidencePolicies || []) {
    // RO0—RO4 行描述“回答从哪里来”，不是教师能力证据命题，不能写入
    // canonical Evidence State。它们仍保留在 RuntimeCard 中供模型判断来源污染。
    if (policy?.claimType === 'ORIGIN_POLICY' || policy?.runtimeUse === 'ORIGIN_POLICY') continue
    if (!nonEmpty(policy?.evidenceClaimId) || !nonEmpty(policy?.understandingId)) continue
    map.set(evidenceKey(policy.evidenceClaimId, policy.understandingId), policy)
  }
  return map
}

export function dialoguePolicyMap(runtimeCard) {
  const map = new Map()
  for (const policy of runtimeCard?.dialoguePolicies || []) {
    if (nonEmpty(policy?.policyId)) map.set(policy.policyId, policy)
  }
  return map
}

export function validateRuntimeCard(card) {
  const errors = []
  add(errors, isObject(card), 'runtime_card 必须是对象')
  if (!isObject(card)) return { ok: false, errors, evidenceKeys: [] }

  add(errors, card.schemaVersion === RUNTIME_CARD_SCHEMA, `schemaVersion 必须为 ${RUNTIME_CARD_SCHEMA}`)
  add(errors, nonEmpty(card.runtimeCardId), 'runtimeCardId 不能为空')
  add(errors, nonEmpty(card.sessionId), 'sessionId 不能为空')
  add(errors, nonEmpty(card.itemId), 'itemId 不能为空')
  add(errors, isObject(card.scenarioBrief), 'scenarioBrief 必须是对象')
  add(errors, /^Q\d{2}$/.test(card.scenarioBrief?.questionId || ''), 'scenarioBrief.questionId 必须为 Q01 形式')
  add(errors, nonEmpty(card.scenarioBrief?.scenarioId), 'scenarioBrief.scenarioId 不能为空')
  add(errors, nonEmpty(card.scenarioBrief?.content), 'scenarioBrief.content 不能为空')

  for (const field of ['professionalLenses', 'evidencePolicies', 'dialoguePolicies', 'synthesisPolicies']) {
    add(errors, Array.isArray(card[field]), `${field} 必须是数组`)
  }
  add(errors, Array.isArray(card.evidencePolicies) && card.evidencePolicies.length > 0, 'evidencePolicies 不能为空')

  const keys = []
  for (const [index, policy] of (Array.isArray(card.evidencePolicies) ? card.evidencePolicies : []).entries()) {
    add(errors, isObject(policy), `evidencePolicies[${index}] 必须是对象`)
    if (!isObject(policy)) continue
    add(errors, nonEmpty(policy.evidenceClaimId), `evidencePolicies[${index}].evidenceClaimId 不能为空`)
    add(errors, nonEmpty(policy.understandingId), `evidencePolicies[${index}].understandingId 不能为空`)
    const isOriginPolicy = policy.claimType === 'ORIGIN_POLICY' || policy.runtimeUse === 'ORIGIN_POLICY'
    if (!isOriginPolicy && nonEmpty(policy.evidenceClaimId) && nonEmpty(policy.understandingId)) {
      keys.push(evidenceKey(policy.evidenceClaimId, policy.understandingId))
    }
  }
  add(errors, keys.length > 0, '至少需要一条可写入的专业证据命题')
  add(errors, new Set(keys).size === keys.length, 'evidenceClaimId 与 understandingId 的组合不得重复')

  for (const [index, policy] of (Array.isArray(card.dialoguePolicies) ? card.dialoguePolicies : []).entries()) {
    add(errors, isObject(policy), `dialoguePolicies[${index}] 必须是对象`)
    if (!isObject(policy)) continue
    add(errors, nonEmpty(policy.policyId), `dialoguePolicies[${index}].policyId 不能为空`)
    add(errors, nonEmpty(policy.type), `dialoguePolicies[${index}].type 不能为空`)
  }

  return { ok: errors.length === 0, errors, evidenceKeys: keys }
}

/**
 * 这里只验证模型返回的结构。证据是否能写入 canonical state，交由 evidence 模块逐条判定，
 * 因而一个表外方向或一个无效候选都不会令整轮对话失效。
 */
export function validateAgentResult(result, runtimeCard) {
  const errors = []
  add(errors, isObject(result), 'agent_result 必须是对象')
  if (!isObject(result)) return { ok: false, errors }

  add(errors, result.schemaVersion === AGENT_RESULT_SCHEMA, `schemaVersion 必须为 ${AGENT_RESULT_SCHEMA}`)
  add(errors, nonEmpty(result.resultId), 'resultId 不能为空')
  add(errors, AGENT_ACTIONS.includes(result.action), 'action 必须是 ASK 或 CLOSE')
  add(errors, nonEmpty(result.visibleText), 'visibleText 不能为空')
  add(errors, isObject(result.direction), 'direction 必须是对象')
  add(errors, nonEmpty(result.direction?.label), 'direction.label 不能为空')
  add(errors, nonEmpty(result.direction?.openThreadId), 'direction.openThreadId 不能为空')
  add(errors, nonEmpty(result.direction?.rationale), 'direction.rationale 不能为空')
  add(errors, Array.isArray(result.direction?.consultedPolicyIds), 'direction.consultedPolicyIds 必须是数组')
  add(errors, Array.isArray(result.evidenceCandidates), 'evidenceCandidates 必须是数组')
  add(errors, isObject(result.completionRecommendation), 'completionRecommendation 必须是对象')
  add(errors, typeof result.completionRecommendation?.recommended === 'boolean', 'completionRecommendation.recommended 必须是布尔值')
  add(errors, isObject(result.boundary), 'boundary 必须是对象')
  add(errors, BOUNDARY_KINDS.includes(result.boundary?.kind), 'boundary.kind 非法')
  add(errors, isObject(result.trace), 'trace 必须是对象')
  add(errors, nonEmpty(result.trace?.agentId), 'trace.agentId 不能为空')
  add(errors, nonEmpty(result.trace?.model), 'trace.model 不能为空')
  add(errors, nonEmpty(result.trace?.promptVersion), 'trace.promptVersion 不能为空')

  for (const [index, candidate] of (Array.isArray(result.evidenceCandidates) ? result.evidenceCandidates : []).entries()) {
    add(errors, isObject(candidate), `evidenceCandidates[${index}] 必须是对象`)
    if (!isObject(candidate)) continue
    add(errors, nonEmpty(candidate.evidenceClaimId), `evidenceCandidates[${index}].evidenceClaimId 不能为空`)
    add(errors, nonEmpty(candidate.understandingId), `evidenceCandidates[${index}].understandingId 不能为空`)
    add(errors, EVIDENCE_RELATIONS.includes(candidate.relation), `evidenceCandidates[${index}].relation 非法`)
    add(errors, RESPONSE_ORIGINS.includes(candidate.responseOrigin), `evidenceCandidates[${index}].responseOrigin 非法`)
    add(errors, Array.isArray(candidate.spans), `evidenceCandidates[${index}].spans 必须是数组`)
    if (candidate.relation !== 'CONTRADICT') {
      add(errors, EVIDENCE_STATUSES.includes(candidate.proposedStatus), `evidenceCandidates[${index}].proposedStatus 非法`)
    }
  }

  const policies = dialoguePolicyMap(runtimeCard)
  const openThreadId = result.direction?.openThreadId || null
  return {
    ok: errors.length === 0,
    errors,
    directionMeta: {
      openThreadId,
      mappedDialoguePolicy: openThreadId ? policies.has(openThreadId) : false
    }
  }
}
