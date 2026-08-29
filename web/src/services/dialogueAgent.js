import { AGENT_RESULT_SCHEMA } from '../core/dialogue-agent/index.js'

const baseUrl = String(import.meta.env?.VITE_DIALOGUE_AGENT_API_BASE_URL || '').replace(/\/$/, '')

function pick(value, keys) {
  const out = {}
  for (const key of keys) {
    if (value?.[key] !== undefined && value?.[key] !== null && value?.[key] !== '') out[key] = value[key]
  }
  return out
}

function relevanceText(value) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function relevanceScore(row, query) {
  const source = relevanceText(Object.values(row || {}).filter((value) => typeof value === 'string').join(' '))
  const target = relevanceText(query)
  if (!target || !source) return 0
  let score = 0
  for (let index = 0; index < target.length - 1; index += 1) {
    if (source.includes(target.slice(index, index + 2))) score += 1
  }
  return score
}

function selectRows(rows, limit, query = '', priority = () => false) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => ({ row, index, score: relevanceScore(row, query), priority: priority(row) ? 1 : 0 }))
    .sort((left, right) => right.priority - left.priority || right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ row }) => row)
}

function compactScenario(brief = {}) {
  return {
    questionId: brief.questionId,
    scenarioId: brief.scenarioId,
    content: brief.content,
    professionalFocus: pick(brief.professionalFocus, ['content', 'relatedCapabilities', 'doNotAssume', 'sourceRef']),
    // 排序字母只有在保留选项语义时才能构成可用先验。不将选项文本传给
    // Dialogue Agent 会使 A/B/C/D 失去指代，导致首问退化为跨题通用问句。
    pretestOptions: (brief.pretestOptions || []).map((row) => pick(row, [
      'optionCode', 'content', 'assessmentRelation'
    ])),
    contextFacts: (brief.contextFacts || []).slice(0, 2).map((row) => pick(row, [
      'id', 'epistemicStatus', 'content'
    ])),
    importantUnknowns: (brief.importantUnknowns || []).slice(0, 2).map((row) => pick(row, [
      'id', 'epistemicStatus', 'content', 'doNotAssume'
    ]))
  }
}

/**
 * 浏览器保存完整运行卡用于审计；发给模型的是等义的紧凑卡，避免每轮重复传输
 * Excel 治理元数据和展示字段。任何 HARD_BOUNDARY、Evidence ID 与结论边界都不裁掉。
 */
export function compactRuntimeCard(runtimeCard, context = {}) {
  const teacherContext = runtimeCard?.scenarioBrief?.teacherContext || {}
  const query = `${context.teacherTurn || ''} ${(context.recentTeacherTurns || []).join(' ')}`.trim()
  const lenses = selectRows(runtimeCard?.professionalLenses, 4, query, (row) => row?.scope === 'SCENARIO_LENS')
  const evidencePolicies = selectRows(
    (runtimeCard?.evidencePolicies || []).filter((row) => row?.claimType !== 'ORIGIN_POLICY' && row?.runtimeUse !== 'ORIGIN_POLICY'),
    3,
    query
  )
  const hardBoundaries = (runtimeCard?.dialoguePolicies || []).filter((row) => row?.type === 'HARD_BOUNDARY')
  const advisoryPolicies = selectRows((runtimeCard?.dialoguePolicies || []).filter((row) => row?.type !== 'HARD_BOUNDARY'), 2, query)
  return {
    datasetId: runtimeCard?.dataProvenance?.datasetId || '',
    schemaVersion: runtimeCard?.dataProvenance?.schemaVersion || '',
    configFingerprint: runtimeCard?.dataProvenance?.configFingerprint || '',
    itemId: runtimeCard?.itemId || '',
    scenarioBrief: compactScenario(runtimeCard?.scenarioBrief),
    rankingPrior: query ? { assessmentRelation: 'PRIOR_ONLY', alreadyConsideredAtOpening: true } : {
        assessmentRelation: 'PRIOR_ONLY',
        finalRanking: teacherContext.finalRanking || [],
        firstRanking: teacherContext.firstRanking || [],
        scoreSummary: teacherContext.scoreSummary || null,
        pretestPrior: pick(runtimeCard?.scenarioBrief?.pretestPrior, ['content', 'doNotAssume'])
      },
    processPrior: teacherContext.processPrior || null,
    professionalLenses: lenses.map((row) => pick(row, [
      'capabilityId', 'name', 'definition', 'applicability', 'tradeoffs',
      'observableIndicators', 'prohibitedInference'
    ])),
    evidencePolicies: evidencePolicies.map((row) => pick(row, [
      'understandingId', 'evidenceClaimId', 'claimTemplate', 'applicability',
      'counterevidence', 'alternativeExplanation'
    ])),
    dialoguePolicies: [...hardBoundaries, ...advisoryPolicies].map((row) => row?.type === 'HARD_BOUNDARY'
      ? pick(row, ['policyId', 'type', 'name', 'triggerConditions', 'prohibitedActions', 'safetyGateRequired'])
      : pick(row, ['policyId', 'type', 'name', 'probeIntents', 'prohibitedActions', 'agentMayDecline'])),
    synthesisPolicies: [],
    dataProvenance: pick(runtimeCard?.dataProvenance, ['datasetId', 'schemaVersion', 'configFingerprint'])
  }
}

export function compactEvidenceRuntimeCard(runtimeCard, context = {}) {
  const query = String(context.teacherTurn || '')
  const policies = selectRows(
    (runtimeCard?.evidencePolicies || []).filter((row) => row?.claimType !== 'ORIGIN_POLICY' && row?.runtimeUse !== 'ORIGIN_POLICY'),
    6,
    query
  )
  return {
    datasetId: runtimeCard?.dataProvenance?.datasetId || '',
    schemaVersion: runtimeCard?.dataProvenance?.schemaVersion || '',
    configFingerprint: runtimeCard?.dataProvenance?.configFingerprint || '',
    itemId: runtimeCard?.itemId || '',
    scenarioBrief: pick(runtimeCard?.scenarioBrief, ['questionId', 'scenarioId', 'content']),
    rankingPrior: null,
    processPrior: null,
    professionalLenses: [],
    evidencePolicies: policies.map((row) => pick(row, [
      'recordId', 'understandingId', 'evidenceClaimId', 'claimType', 'capabilityRefs',
      'claimTemplate', 'applicability', 'supportAnchors', 'allowedResponseOrigins',
      'independenceRequirement', 'teacherConfirmationRequired', 'sourceSpanRequired', 'minEvidenceLevel',
      'counterevidence', 'pseudoEvidence', 'alternativeExplanation', 'discriminatingObservation',
      'maxSupportedConclusion', 'prohibitedConclusion', 'sourceRef'
    ])),
    dialoguePolicies: [],
    synthesisPolicies: []
  }
}

function compactEvidenceState(state = {}) {
  return {
    schemaVersion: state.schemaVersion || '',
    itemId: state.itemId || '',
    version: Number(state.version || 0),
    claims: Object.values(state.claims || {}).map((claim) => pick(claim, [
      'evidenceClaimId', 'understandingId', 'status', 'confidence', 'hasConflict', 'revisionCount'
    ])),
    recentRecords: (state.records || []).slice(-4).map((record) => pick(record, [
      'evidenceClaimId', 'understandingId', 'relation', 'span', 'proposedStatus', 'effectiveStatus',
      'responseOrigin', 'confidence', 'policyRecordId', 'policySourceRef', 'policySchemaVersion',
      'policyConfigFingerprint', 'determinationReasons', 'lifecycle'
    ]))
  }
}

/**
 * DialogueProgressState 是已发生对话的工作记忆，不是新的专业判分层。只传输最近、
 * 与选择下一问直接相关的字段，避免把完整审计对象每轮重复发给模型。
 */
export function compactDialogueProgressState(state = {}) {
  return {
    schemaVersion: state.schemaVersion || '',
    itemId: state.itemId || '',
    version: Number(state.version || 0),
    phase: state.phase || 'OPENING',
    questionLedger: (state.questionLedger || []).slice(-6).map((entry) => pick(entry, [
      'questionId', 'turnId', 'action', 'questionText', 'goalLabel', 'rationale', 'openThreadId',
      'phase', 'answerStatus', 'answerTurnId', 'answerExcerpt', 'understanding', 'workingHypotheses'
    ])),
    openThreads: (state.openThreads || []).slice(-4).map((thread) => pick(thread, [
      'openThreadId', 'statement', 'rationale', 'status', 'originTurnId', 'lastTouchedTurnId',
      'touchCount', 'consultedPolicyIds', 'hypothesisIds', 'lastTeacherTurnId'
    ])),
    coveredCues: (state.coveredCues || []).slice(-8).map((cue) => pick(cue, [
      'cueId', 'sourceTurnId', 'span', 'meaning', 'confidence', 'sourceKind', 'openThreadId',
      'hypothesisIds', 'formalEvidenceIds'
    ])),
    stagnation: pick(state.stagnation, [
      'score', 'consecutiveSimilarGoals', 'repeatedQuestionCount', 'lastQuestionSemanticKey',
      'lastProgressTurnId', 'reasonCodes'
    ])
  }
}

function previousHistory(request) {
  const history = (request.history || []).map((turn) => ({
    role: turn.role === 'teacher' ? 'teacher' : 'assistant',
    text: String(turn.text || '').trim()
  })).filter((turn) => turn.text)
  const teacherTurn = String(request.teacherTurn || '').trim()
  if (teacherTurn && history.at(-1)?.role === 'teacher' && history.at(-1)?.text === teacherTurn) history.pop()
  return history
}

function mapAgentResult(response) {
  const direction = response.direction || {}
  const boundary = response.boundary || {}
  return {
    schemaVersion: AGENT_RESULT_SCHEMA,
    resultId: String(response.request_id || crypto.randomUUID()),
    action: response.action,
    visibleText: String(response.visible_text || ''),
    direction: {
      label: String(direction.label || '继续理解教师'),
      openThreadId: String(direction.open_thread_id || `open-${response.request_id || Date.now()}`),
      rationale: String(direction.rationale || '承接教师当前表达'),
      consultedPolicyIds: Array.isArray(direction.consulted_policy_ids) ? direction.consulted_policy_ids : []
    },
    evidenceCandidates: (response.evidence_candidates || []).map((candidate) => ({
      evidenceClaimId: candidate.evidence_claim_id,
      understandingId: candidate.understanding_id,
      relation: candidate.relation,
      proposedStatus: candidate.proposed_status,
      responseOrigin: candidate.response_origin,
      confidence: candidate.confidence,
      spans: candidate.spans,
      rationale: candidate.rationale
    })),
    completionRecommendation: {
      recommended: Boolean(response.completion_recommendation?.recommended),
      reason: String(response.completion_recommendation?.reason || '')
    },
    boundary: {
      kind: boundary.kind || 'NONE',
      policyId: String(boundary.policy_id || '')
    },
    understanding: response.understanding || null,
    workingHypotheses: response.working_hypotheses || [],
    trace: {
      agentId: `http:${response.provider || 'unknown'}`,
      provider: response.provider || 'unknown',
      model: String(response.model || 'unknown'),
      promptVersion: String(response.prompt_version || 'unknown'),
      requestId: String(response.request_id || ''),
      providerRequestId: String(response.provider_request_id || ''),
      generationAttempts: Number(response.trace?.generation_attempts || 1),
      latencyMs: Number(response.latency_ms || 0),
      usage: response.usage || null
    }
  }
}

async function requestJson(path, options = {}) {
  if (!baseUrl) {
    const error = new Error('dialogue_agent_not_configured')
    error.code = 'dialogue_agent_not_configured'
    throw error
  }
  let response
  try {
    response = await fetch(`${baseUrl}${path}`, options)
  } catch (cause) {
    const error = new Error(cause?.name === 'AbortError' ? 'dialogue_agent_aborted' : 'dialogue_agent_unreachable')
    error.code = cause?.name === 'AbortError' ? 'dialogue_agent_aborted' : 'dialogue_agent_unreachable'
    throw error
  }
  const result = await response.json().catch(() => null)
  if (!response.ok || !result?.ok) {
    const error = new Error(result?.message || result?.error || `dialogue_agent_http_${response.status}`)
    error.code = result?.error || `dialogue_agent_http_${response.status}`
    throw error
  }
  return result
}

export async function runDialogueAgent(request, options = {}) {
  const first = request.kind === 'FIRST_QUESTION'
  const body = {
    phase: first ? 'first' : 'next',
    session_id: request.runtimeCard.sessionId,
    item_id: request.runtimeCard.itemId,
    ...(options.expectedProvider ? { expected_provider: String(options.expectedProvider) } : {}),
    ...(options.expectedModel ? { expected_model: String(options.expectedModel) } : {}),
    teacher_turn: first ? '' : request.teacherTurn,
    compiled_card: compactRuntimeCard(request.runtimeCard, {
      teacherTurn: request.teacherTurn,
      recentTeacherTurns: previousHistory(request).filter((turn) => turn.role === 'teacher').slice(-2).map((turn) => turn.text)
    }),
    evidence_summary: compactEvidenceState(request.evidenceState),
    dialogue_progress_state: compactDialogueProgressState(request.dialogueProgressState),
    history: previousHistory(request),
    runtime_limits: {
      remaining_ms: Number(options.remainingMs || 0),
      one_question_only: true,
      max_visible_chars: 140
    }
  }
  const result = await requestJson('/v1/dialogue/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal
  })
  return mapAgentResult(result)
}

export async function analyzeDialogueEvidence(request, options = {}) {
  const body = {
    phase: 'next',
    session_id: request.runtimeCard.sessionId,
    item_id: request.runtimeCard.itemId,
    ...(options.expectedProvider ? { expected_provider: String(options.expectedProvider) } : {}),
    ...(options.expectedModel ? { expected_model: String(options.expectedModel) } : {}),
    teacher_turn: request.teacherTurn,
    eliciting_question: request.elicitingQuestion || '',
    compiled_card: compactEvidenceRuntimeCard(request.runtimeCard, { teacherTurn: request.teacherTurn }),
    evidence_summary: compactEvidenceState(request.evidenceState),
    history: previousHistory(request)
  }
  const response = await requestJson('/v1/evidence/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal
  })
  return {
    resultId: String(response.request_id || crypto.randomUUID()),
    evidenceCandidates: (response.evidence_candidates || []).map((candidate) => ({
      evidenceClaimId: candidate.evidence_claim_id,
      understandingId: candidate.understanding_id,
      relation: candidate.relation,
      proposedStatus: candidate.proposed_status,
      responseOrigin: candidate.response_origin,
      confidence: candidate.confidence,
      spans: candidate.spans,
      rationale: candidate.rationale
    })),
    trace: {
      provider: response.provider || 'unknown',
      model: String(response.model || 'unknown'),
      promptVersion: String(response.prompt_version || 'unknown'),
      requestId: String(response.request_id || ''),
      providerRequestId: String(response.provider_request_id || ''),
      latencyMs: Number(response.latency_ms || 0),
      usage: response.usage || null
    }
  }
}

export async function getDialogueAgentHealth(options = {}) {
  return requestJson('/health', { method: 'GET', signal: options.signal })
}
