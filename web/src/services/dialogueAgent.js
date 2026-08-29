import { AGENT_RESULT_SCHEMA } from '../core/dialogue-agent/index.js'

const baseUrl = String(import.meta.env?.VITE_DIALOGUE_AGENT_API_BASE_URL || '').replace(/\/$/, '')

function pick(value, keys) {
  const out = {}
  for (const key of keys) {
    if (value?.[key] !== undefined && value?.[key] !== null && value?.[key] !== '') out[key] = value[key]
  }
  return out
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
      'id', 'type', 'epistemicStatus', 'content', 'optionCode', 'assessmentRelation',
      'applicability', 'plausibleInterpretation', 'alternativeExplanation', 'missingInformation',
      'discriminatingObservation', 'relatedCapabilities', 'doNotAssume', 'sourceRef'
    ])),
    contextFacts: (brief.contextFacts || []).map((row) => pick(row, [
      'id', 'epistemicStatus', 'content', 'plausibleInterpretation', 'alternativeExplanation',
      'missingInformation', 'discriminatingObservation', 'relatedCapabilities', 'doNotAssume', 'sourceRef'
    ])),
    importantUnknowns: (brief.importantUnknowns || []).map((row) => pick(row, [
      'id', 'epistemicStatus', 'content', 'plausibleInterpretation', 'alternativeExplanation',
      'missingInformation', 'discriminatingObservation', 'relatedCapabilities', 'doNotAssume', 'sourceRef'
    ]))
  }
}

/**
 * 浏览器保存完整运行卡用于审计；发给模型的是等义的紧凑卡，避免每轮重复传输
 * Excel 治理元数据和展示字段。任何 HARD_BOUNDARY、Evidence ID 与结论边界都不裁掉。
 */
export function compactRuntimeCard(runtimeCard) {
  const teacherContext = runtimeCard?.scenarioBrief?.teacherContext || {}
  return {
    datasetId: runtimeCard?.dataProvenance?.datasetId || '',
    schemaVersion: runtimeCard?.dataProvenance?.schemaVersion || '',
    configFingerprint: runtimeCard?.dataProvenance?.configFingerprint || '',
    itemId: runtimeCard?.itemId || '',
    scenarioBrief: compactScenario(runtimeCard?.scenarioBrief),
    rankingPrior: {
      assessmentRelation: 'PRIOR_ONLY',
      finalRanking: teacherContext.finalRanking || [],
      firstRanking: teacherContext.firstRanking || [],
      scoreSummary: teacherContext.scoreSummary || null,
      pretestPrior: pick(runtimeCard?.scenarioBrief?.pretestPrior, ['content', 'doNotAssume', 'sourceRef'])
    },
    processPrior: teacherContext.processPrior || null,
    professionalLenses: (runtimeCard?.professionalLenses || []).map((row) => pick(row, [
      'recordId', 'capabilityId', 'name', 'definition', 'pathId', 'pathName', 'pathDescription',
      'applicability', 'exclusions', 'tradeoffs', 'observableOpportunities', 'observableIndicators',
      'notEquivalentTo', 'absenceNotInterpretableWhen', 'prohibitedInference', 'autonomyNote', 'scope', 'sourceRef'
    ])),
    evidencePolicies: (runtimeCard?.evidencePolicies || []).map((row) => pick(row, [
      'recordId', 'understandingId', 'evidenceClaimId', 'claimType', 'capabilityRefs', 'pathRefs',
      'claimTemplate', 'applicability', 'supportAnchors', 'allowedResponseOrigins',
      'independenceRequirement', 'teacherConfirmationRequired', 'sourceSpanRequired', 'minEvidenceLevel',
      'counterevidence', 'pseudoEvidence', 'alternativeExplanation', 'discriminatingObservation',
      'contradictionRule', 'contextBoundary', 'maxSupportedConclusion', 'prohibitedConclusion',
      'crossContextRequirement', 'fairnessNote', 'memoryCandidateAllowed', 'owner', 'runtimeUse', 'sourceRef'
    ])),
    dialoguePolicies: (runtimeCard?.dialoguePolicies || []).map((row) => pick(row, [
      'recordId', 'policyId', 'type', 'name', 'targetUnderstandingIds', 'targetCapabilityIds',
      'missionRelation', 'triggerConditions', 'postureOptions', 'freedomScope', 'allowedActions',
      'probeIntents', 'prohibitedActions', 'constraintLevel', 'rrmcSignal', 'eventTriggers',
      'expirationTurns', 'agentMayDecline', 'relationshipSignals', 'cognitiveLoadSignals',
      'safetyGateRequired', 'runtimeUse', 'sourceRef'
    ])),
    synthesisPolicies: (runtimeCard?.synthesisPolicies || []).map((row) => pick(row, [
      'recordId', 'policyId', 'type', 'name', 'triggerConditions', 'requiredEvidenceClaimIds',
      'requiredCapabilityIds', 'minSourceDiversity', 'counterevidenceRequired',
      'teacherConfirmationRequired', 'contextBoundary', 'confidenceBands', 'maxPermittedClaim',
      'prohibitedClaim', 'memoryType', 'memoryWriteRule', 'memoryExpiryRule', 'correctionRule',
      'prohibitedStopCondition', 'runtimeUse', 'sourceRef'
    ])),
    dataProvenance: runtimeCard?.dataProvenance || {}
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
    recentRecords: (state.records || []).slice(-12).map((record) => pick(record, [
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
    questionLedger: (state.questionLedger || []).slice(-12).map((entry) => pick(entry, [
      'questionId', 'turnId', 'action', 'questionText', 'goalLabel', 'rationale', 'openThreadId',
      'phase', 'answerStatus', 'answerTurnId', 'answerExcerpt', 'understanding', 'workingHypotheses'
    ])),
    openThreads: (state.openThreads || []).slice(-12).map((thread) => pick(thread, [
      'openThreadId', 'statement', 'rationale', 'status', 'originTurnId', 'lastTouchedTurnId',
      'touchCount', 'consultedPolicyIds', 'hypothesisIds', 'lastTeacherTurnId'
    ])),
    coveredCues: (state.coveredCues || []).slice(-20).map((cue) => pick(cue, [
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
    compiled_card: compactRuntimeCard(request.runtimeCard),
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

export async function getDialogueAgentHealth(options = {}) {
  return requestJson('/health', { method: 'GET', signal: options.signal })
}
