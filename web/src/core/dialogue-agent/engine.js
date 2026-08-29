import {
  AGENT_REQUEST_SCHEMA,
  EVIDENCE_STATUSES,
  RESPONSE_ORIGINS,
  dialoguePolicyMap,
  validateAgentResult,
  validateRuntimeCard
} from './contracts.js'
import { initializeEvidenceState, commitEvidenceCandidates } from './evidence.js'
import { isExplicitExit, safeExitResult, validateHardBoundaries } from './boundaries.js'

export const DIALOGUE_SESSION_SCHEMA = 'dialogue-agent.session/v2'

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function defaultNow() {
  return Date.now()
}

function audit(session, type, data, now) {
  session.auditLog.push({
    eventId: `dialogue-log-${session.auditLog.length + 1}`,
    type,
    at: now(),
    sessionVersion: session.version,
    ...data
  })
}

function policySummary(runtimeCard) {
  const summary = { affordance: 0, monitor: 0, hardBoundary: 0, other: 0 }
  for (const policy of runtimeCard.dialoguePolicies) {
    if (policy.type === 'AFFORDANCE') summary.affordance += 1
    else if (policy.type === 'MONITOR') summary.monitor += 1
    else if (policy.type === 'HARD_BOUNDARY') summary.hardBoundary += 1
    else summary.other += 1
  }
  return summary
}

/** 持久化会话只能在运行数据身份、题目和领域契约完全一致时恢复。 */
export function validateDialogueSessionForResume(session, expected = {}) {
  const errors = []
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    return { ok: false, errors: ['dialogue_session_not_object'] }
  }
  if (session.schemaVersion !== DIALOGUE_SESSION_SCHEMA) errors.push('dialogue_session_schema_mismatch')
  if (expected.sessionId && session.sessionId !== expected.sessionId) errors.push('dialogue_session_id_mismatch')
  if (expected.itemId && session.itemId !== expected.itemId) errors.push('dialogue_session_item_mismatch')

  const runtimeCard = session.runtimeCard
  const checkedCard = validateRuntimeCard(runtimeCard)
  if (!checkedCard.ok) errors.push(...checkedCard.errors.map((error) => 'runtime_card:' + error))
  if (runtimeCard?.sessionId !== session.sessionId) errors.push('runtime_card_session_mismatch')
  if (runtimeCard?.itemId !== session.itemId) errors.push('runtime_card_item_mismatch')
  if (runtimeCard?.scenarioBrief?.questionId !== session.itemId) errors.push('runtime_card_question_mismatch')

  const provenance = runtimeCard?.dataProvenance || {}
  if (expected.datasetId && provenance.datasetId !== expected.datasetId) errors.push('runtime_dataset_mismatch')
  if (expected.configFingerprint && provenance.configFingerprint !== expected.configFingerprint) {
    errors.push('runtime_config_fingerprint_mismatch')
  }
  if (expected.runtimeSchemaVersion && provenance.schemaVersion !== expected.runtimeSchemaVersion) {
    errors.push('runtime_schema_version_mismatch')
  }

  if (session.evidenceState?.schemaVersion !== 'dialogue-agent.evidence-state/v2') {
    errors.push('evidence_state_schema_mismatch')
  }
  if (session.evidenceState?.itemId !== session.itemId) errors.push('evidence_state_item_mismatch')
  for (const record of Array.isArray(session.evidenceState?.records) ? session.evidenceState.records : []) {
    if (!RESPONSE_ORIGINS.includes(record?.responseOrigin)) errors.push('evidence_record_origin_missing')
    if (record?.relation !== 'CONTRADICT' && !EVIDENCE_STATUSES.includes(record?.effectiveStatus)) {
      errors.push('evidence_record_effective_status_missing')
    }
    if (expected.configFingerprint && record?.policyConfigFingerprint !== expected.configFingerprint) {
      errors.push('evidence_record_policy_fingerprint_mismatch')
    }
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)] }
}

function guidanceTrace(runtimeCard, direction, directionMeta) {
  const policies = dialoguePolicyMap(runtimeCard)
  const consultedPolicyIds = Array.isArray(direction.consultedPolicyIds) ? direction.consultedPolicyIds : []
  const known = consultedPolicyIds.filter((policyId) => policies.has(policyId))
  const unknown = consultedPolicyIds.filter((policyId) => !policies.has(policyId))
  const affordancePolicyIds = known.filter((policyId) => policies.get(policyId).type === 'AFFORDANCE')
  return {
    openThreadId: direction.openThreadId,
    openThreadMappedToDialoguePolicy: directionMeta.mappedDialoguePolicy,
    consultedPolicyIds,
    unknownConsultedPolicyIds: unknown,
    affordancePolicyIds,
    affordanceSemantics: 'SOFT'
  }
}

export function createDialogueSession(runtimeCard, options = {}) {
  const checked = validateRuntimeCard(runtimeCard)
  if (!checked.ok) {
    const error = new Error(`Dialogue runtime card invalid: ${checked.errors.join('; ')}`)
    error.code = 'invalid_runtime_card'
    error.details = checked.errors
    throw error
  }
  const now = options.now || defaultNow
  const session = {
    schemaVersion: DIALOGUE_SESSION_SCHEMA,
    sessionId: runtimeCard.sessionId,
    itemId: runtimeCard.itemId,
    status: 'READY',
    version: 0,
    turnSeq: 0,
    runtimeCard: clone(runtimeCard),
    evidenceState: initializeEvidenceState(runtimeCard),
    history: [],
    auditLog: [],
    pendingRequest: null,
    lastAgentResult: null
  }
  audit(session, 'RuntimeCardAccepted', {
    runtimeCardId: runtimeCard.runtimeCardId,
    evidenceKeys: checked.evidenceKeys,
    dialoguePolicySummary: policySummary(runtimeCard)
  }, now)
  return session
}

function nextRequest(session, kind, teacherTurn, options = {}) {
  const turnId = kind === 'FIRST_QUESTION' ? 'turn-0' : `turn-${session.turnSeq}`
  return {
    schemaVersion: AGENT_REQUEST_SCHEMA,
    requestId: options.requestId || `${session.sessionId}:${session.itemId}:${turnId}`,
    attempt: options.attempt || 1,
    kind,
    turnId,
    teacherTurn: teacherTurn || '',
    runtimeCard: clone(session.runtimeCard),
    policySemantics: {
      affordance: 'SOFT',
      hardBoundary: 'HARD',
      completion: 'ADVISORY'
    },
    evidenceState: clone(session.evidenceState),
    history: clone(session.history)
  }
}

function pause(session, request, error, now) {
  // 页面可能在 provider 返回前因倒计时或教师退出而完成。迟到的 abort/error
  // 只能被丢弃，不能把不可逆的 COMPLETED 状态重新降为 PAUSED。
  if (session.status === 'COMPLETED') {
    return {
      ok: false,
      status: 'completed',
      retryable: false,
      stale: true,
      question: null,
      visibleText: null,
      error: error?.code || error?.message || String(error || 'late_agent_result')
    }
  }
  session.status = 'PAUSED'
  session.pendingRequest = clone(request)
  session.version += 1
  const code = error?.code || error?.message || String(error || 'agent_unavailable')
  audit(session, 'DialoguePaused', { requestId: request.requestId, turnId: request.turnId, reason: code }, now)
  return {
    ok: false,
    status: 'paused',
    retryable: true,
    retryAction: 'retry',
    question: null,
    visibleText: null,
    teacherNotice: '刚才的问题暂时没有生成成功，您的回答已经保存。请重试。',
    error: code
  }
}

async function execute(session, request, provider, options = {}) {
  const now = options.now || defaultNow
  if (session.status === 'COMPLETED') return pause(session, request, { code: 'dialogue_already_completed' }, now)
  session.status = 'GENERATING'
  session.pendingRequest = clone(request)
  session.version += 1
  audit(session, 'AgentRequestPending', { requestId: request.requestId, turnId: request.turnId, attempt: request.attempt }, now)
  if (typeof provider !== 'function') return pause(session, request, { code: 'agent_provider_missing' }, now)

  let result
  try {
    result = await provider(clone(request))
  } catch (error) {
    return pause(session, request, { code: error?.code || error?.message || 'agent_provider_failed' }, now)
  }

  if (session.status === 'COMPLETED') return pause(session, request, { code: 'late_agent_result_discarded' }, now)

  const contract = validateAgentResult(result, session.runtimeCard)
  if (!contract.ok) return pause(session, request, { code: `invalid_agent_result:${contract.errors.join('|')}` }, now)

  const boundary = validateHardBoundaries({
    visibleText: result.visibleText,
    action: result.action,
    boundary: result.boundary,
    teacherTurn: request.teacherTurn,
    runtimeCard: session.runtimeCard
  })
  if (!boundary.ok) return pause(session, request, { code: `hard_boundary_rejected:${boundary.issues.join('|')}` }, now)

  const evidence = commitEvidenceCandidates(
    session.evidenceState,
    result.evidenceCandidates,
    { turnId: request.turnId, teacherTurn: request.teacherTurn, agentResultId: result.resultId },
    session.runtimeCard,
    { now }
  )
  session.evidenceState = evidence.state
  session.lastAgentResult = clone(result)
  session.pendingRequest = null
  session.history.push({
    role: 'agent',
    text: result.visibleText,
    action: result.action,
    resultId: result.resultId,
    direction: clone(result.direction),
    at: now()
  })
  session.status = result.action === 'CLOSE' ? 'COMPLETED' : 'ACTIVE'
  session.version += 1

  audit(session, 'AgentResultAccepted', {
    requestId: request.requestId,
    turnId: request.turnId,
    resultId: result.resultId,
    action: result.action,
    direction: clone(result.direction),
    guidance: guidanceTrace(session.runtimeCard, result.direction, contract.directionMeta),
    completionRecommendation: clone(result.completionRecommendation),
    evidenceAccepted: evidence.accepted.map((item) => item.evidenceIds).flat(),
    evidenceRejected: evidence.rejected
  }, now)

  return {
    ok: true,
    status: session.status.toLowerCase(),
    retryable: false,
    action: result.action,
    question: result.action === 'ASK' ? result.visibleText : null,
    visibleText: result.visibleText,
    direction: clone(result.direction),
    completionRecommendation: clone(result.completionRecommendation),
    evidence: { accepted: evidence.accepted, rejected: evidence.rejected }
  }
}

export async function startDialogue(session, provider, options = {}) {
  if (!session || session.status !== 'READY') throw new Error('dialogue_not_ready')
  const request = nextRequest(session, 'FIRST_QUESTION', '', options)
  audit(session, 'AgentRequested', { requestId: request.requestId, turnId: request.turnId, kind: request.kind }, options.now || defaultNow)
  return execute(session, request, provider, options)
}

export async function submitTeacherTurn(session, teacherTurn, provider, options = {}) {
  if (!session || !['ACTIVE', 'READY'].includes(session.status)) throw new Error('dialogue_not_active')
  const text = String(teacherTurn || '').trim()
  if (!text) throw new Error('teacher_turn_empty')
  const now = options.now || defaultNow
  session.turnSeq += 1
  session.history.push({ role: 'teacher', text, turnId: `turn-${session.turnSeq}`, at: now() })
  session.version += 1
  audit(session, 'TeacherTurnSaved', { turnId: `turn-${session.turnSeq}`, exactText: text }, now)

  if (isExplicitExit(text)) {
    const handled = safeExitResult(`turn-${session.turnSeq}`)
    session.history.push({ role: 'agent', text: handled.visibleText, action: 'CLOSE', resultId: 'hard-boundary-exit', at: now() })
    session.status = 'COMPLETED'
    session.pendingRequest = null
    session.version += 1
    audit(session, 'HardBoundaryHandled', { turnId: handled.turnId, kind: 'EXIT', action: 'CLOSE' }, now)
    return handled
  }

  const request = nextRequest(session, 'TEACHER_TURN', text, options)
  audit(session, 'AgentRequested', { requestId: request.requestId, turnId: request.turnId, kind: request.kind }, now)
  return execute(session, request, provider, options)
}

/** 重试复用已保存请求，不重复追加教师原话，也不生成本地专业问句。 */
export async function retryDialogue(session, provider, options = {}) {
  if (!session || session.status !== 'PAUSED' || !session.pendingRequest) throw new Error('dialogue_not_paused')
  const request = { ...clone(session.pendingRequest), attempt: Number(session.pendingRequest.attempt || 1) + 1 }
  audit(session, 'AgentRetryRequested', { requestId: request.requestId, turnId: request.turnId, attempt: request.attempt }, options.now || defaultNow)
  return execute(session, request, provider, options)
}
