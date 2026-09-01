import {
  EVIDENCE_RELATIONS,
  EVIDENCE_STATUSES,
  RESPONSE_ORIGINS,
  evidenceKey,
  evidencePolicyMap
} from './contracts.js'

const STATUS_ORDER = Object.freeze({
  NOT_DEMONSTRATED: 0,
  PARTIAL: 1,
  SUFFICIENT: 2,
  HIGH_QUALITY: 3
})

const ORIGIN_STATUS_CEILING = Object.freeze({
  RO0: 'HIGH_QUALITY',
  RO1: 'HIGH_QUALITY',
  RO2: 'SUFFICIENT',
  RO3: 'PARTIAL',
  RO4: 'PARTIAL'
})

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function lowerStatus(left, right) {
  return STATUS_ORDER[left] <= STATUS_ORDER[right] ? left : right
}

function activeSupportTurnIds(evidenceState, key, currentTurnId) {
  const claim = evidenceState?.claims?.[key]
  if (!claim) return new Set()
  const active = new Set(claim.activeEvidenceIds || [])
  return new Set(
    (evidenceState.records || [])
      .filter((record) =>
        active.has(record.evidenceId) &&
        record.lifecycle === 'ACTIVE' &&
        record.relation !== 'CONTRADICT' &&
        ['PARTIAL', 'SUFFICIENT', 'HIGH_QUALITY'].includes(record.effectiveStatus || record.proposedStatus) &&
        record.sourceTurnId &&
        record.sourceTurnId !== currentTurnId
      )
      .map((record) => record.sourceTurnId)
  )
}

function highQualityTurnRequirement(policy) {
  if (policy?.minEvidenceLevel === 'L3') return 3
  return 2
}

/**
 * 模型只提出 proposedStatus；canonical 状态由来源独立性与表3政策字段确定。
 * 当前合同没有单独的“教师已确认”输入，因此用不同教师轮次的有效支持作为可审计代理。
 */
export function determineEvidenceStatus(candidate, policy, evidenceState, context = {}) {
  const responseOrigin = candidate?.responseOrigin
  const proposedStatus = candidate?.relation === 'CONTRADICT' ? null : candidate?.proposedStatus
  let ceiling = ORIGIN_STATUS_CEILING[responseOrigin] || 'PARTIAL'
  const reasons = ['origin_ceiling:' + String(responseOrigin || 'MISSING') + '=' + ceiling]

  if (responseOrigin === 'RO2' && String(policy?.independenceRequirement || '').trim()) {
    ceiling = lowerStatus(ceiling, 'PARTIAL')
    reasons.push('independence_requirement_caps_prompted_origin')
  }

  const key = evidenceKey(policy?.evidenceClaimId, policy?.understandingId)
  const priorTurnIds = activeSupportTurnIds(evidenceState, key, context.turnId)
  const distinctSupportingTurns = priorTurnIds.size + 1
  const requiredTurnsForHighQuality = highQualityTurnRequirement(policy)
  if (distinctSupportingTurns < requiredTurnsForHighQuality) {
    ceiling = lowerStatus(ceiling, 'SUFFICIENT')
    if (policy?.teacherConfirmationRequired) reasons.push('teacher_confirmation_requires_distinct_turn')
    if (policy?.minEvidenceLevel) {
      reasons.push('min_evidence_level:' + policy.minEvidenceLevel + '_requires_' + requiredTurnsForHighQuality + '_turns_for_high_quality')
    }
  }

  const effectiveStatus = proposedStatus ? lowerStatus(proposedStatus, ceiling) : null
  if (proposedStatus && proposedStatus !== effectiveStatus) {
    reasons.push('status_downgraded:' + proposedStatus + '->' + effectiveStatus)
  }

  return {
    proposedStatus,
    effectiveStatus,
    ceiling,
    responseOrigin: responseOrigin || null,
    distinctSupportingTurns,
    requiredTurnsForHighQuality,
    allowedResponseOrigins: clone(policy?.allowedResponseOrigins || []),
    minEvidenceLevel: policy?.minEvidenceLevel || null,
    teacherConfirmationRequired: Boolean(policy?.teacherConfirmationRequired),
    independenceRequirement: policy?.independenceRequirement || '',
    reasons
  }
}

function claimState(policy) {
  return {
    evidenceClaimId: policy.evidenceClaimId,
    understandingId: policy.understandingId,
    status: 'UNKNOWN',
    confidence: 0,
    hasConflict: false,
    activeEvidenceIds: [],
    activeConflictIds: [],
    revisionCount: 0
  }
}

export function initializeEvidenceState(runtimeCard) {
  const claims = {}
  for (const policy of evidencePolicyMap(runtimeCard).values()) {
    claims[evidenceKey(policy.evidenceClaimId, policy.understandingId)] = claimState(policy)
  }
  return {
    schemaVersion: 'dialogue-agent.evidence-state/v2',
    itemId: runtimeCard.itemId,
    version: 0,
    nextEvidenceSeq: 1,
    claims,
    records: [],
    revisions: [],
    auditLog: []
  }
}

/** 候选只有映射到合法 claim 且精确引用本轮教师原话，才有资格写入 canonical evidence。 */
export function validateEvidenceCandidate(candidate, teacherTurn, runtimeCard, options = {}) {
  const errors = []
  const turn = String(teacherTurn || '')
  if (!candidate || typeof candidate !== 'object') return { ok: false, errors: ['candidate_not_object'] }

  const key = evidenceKey(candidate.evidenceClaimId, candidate.understandingId)
  const policy = evidencePolicyMap(runtimeCard).get(key)
  if (!policy) errors.push('unknown_evidence_claim_mapping')
  if (!EVIDENCE_RELATIONS.includes(candidate.relation)) errors.push('invalid_relation')
  if (!RESPONSE_ORIGINS.includes(candidate.responseOrigin)) errors.push('invalid_response_origin')
  if (policy && Array.isArray(policy.allowedResponseOrigins) && policy.allowedResponseOrigins.length && !policy.allowedResponseOrigins.includes(candidate.responseOrigin)) {
    errors.push('response_origin_not_allowed')
  }
  if (!Array.isArray(candidate.spans) || candidate.spans.length === 0) errors.push('missing_teacher_span')
  const spans = Array.isArray(candidate.spans) ? candidate.spans.map((value) => String(value || '').trim()).filter(Boolean) : []
  if (!spans.length) errors.push('missing_teacher_span')
  for (const span of spans) if (!turn.includes(span)) errors.push(`span_not_in_teacher_turn:${span}`)
  if (candidate.relation !== 'CONTRADICT' && !EVIDENCE_STATUSES.includes(candidate.proposedStatus)) errors.push('invalid_proposed_status')
  if (candidate.confidence != null && (!Number.isFinite(Number(candidate.confidence)) || Number(candidate.confidence) < 0 || Number(candidate.confidence) > 1)) {
    errors.push('invalid_confidence')
  }
  const determination = policy
    ? determineEvidenceStatus(candidate, policy, options.evidenceState, { turnId: options.turnId })
    : null
  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    spans,
    key,
    policy,
    determination
  }
}

function event(state, type, data, now) {
  state.auditLog.push({
    eventId: `evlog-${state.auditLog.length + 1}`,
    type,
    at: now(),
    evidenceVersion: state.version,
    ...data
  })
}

function makeRecord(state, candidate, checked, span, context, runtimeCard, now) {
  const policy = checked.policy || {}
  const determination = checked.determination || {}
  return {
    evidenceId: `e-${state.nextEvidenceSeq++}`,
    evidenceClaimId: candidate.evidenceClaimId,
    understandingId: candidate.understandingId,
    relation: candidate.relation,
    span,
    sourceTurnId: context.turnId,
    sourceTeacherText: context.teacherTurn,
    agentResultId: context.agentResultId,
    proposedStatus: determination.proposedStatus,
    effectiveStatus: determination.effectiveStatus,
    responseOrigin: determination.responseOrigin,
    confidence: candidate.confidence == null ? null : Number(candidate.confidence),
    rationale: candidate.rationale || '',
    policyRecordId: policy.recordId || null,
    policySourceRef: policy.sourceRef || null,
    policySchemaVersion: runtimeCard?.dataProvenance?.schemaVersion || null,
    policyConfigFingerprint: runtimeCard?.dataProvenance?.configFingerprint || null,
    determinationReasons: clone(determination.reasons || []),
    determination: clone(determination),
    validationBasis: 'MODEL_PROPOSAL_WITH_DETERMINISTIC_POLICY_CEILING',
    requiresHumanReview: true,
    lifecycle: 'ACTIVE',
    createdAt: now()
  }
}

function supersedeClaimRecords(state, claim, context, now) {
  const superseded = []
  for (const record of state.records) {
    if (
      record.evidenceClaimId === claim.evidenceClaimId &&
      record.understandingId === claim.understandingId &&
      record.lifecycle === 'ACTIVE'
    ) {
      record.lifecycle = 'SUPERSEDED'
      record.supersededAt = now()
      record.supersededByTurnId = context.turnId
      superseded.push(record.evidenceId)
    }
  }
  claim.activeEvidenceIds = []
  claim.activeConflictIds = []
  claim.hasConflict = false
  return superseded
}

function recomputeClaimFromActiveEvidence(state, claim) {
  const activeIds = new Set(claim.activeEvidenceIds || [])
  const activeRecords = state.records.filter((record) => (
    activeIds.has(record.evidenceId)
    && record.lifecycle === 'ACTIVE'
    && record.relation !== 'CONTRADICT'
    && EVIDENCE_STATUSES.includes(record.effectiveStatus)
  ))
  if (!activeRecords.length) {
    claim.status = 'UNKNOWN'
    claim.confidence = 0
    return
  }
  const highestOrder = Math.max(...activeRecords.map((record) => STATUS_ORDER[record.effectiveStatus]))
  const strongest = activeRecords.filter((record) => STATUS_ORDER[record.effectiveStatus] === highestOrder)
  claim.status = strongest[0].effectiveStatus
  claim.confidence = Math.max(0, ...strongest.map((record) => Number(record.confidence || 0)))
}

/** 非法候选只进入拒绝日志，不污染 canonical evidence。 */
export function commitEvidenceCandidates(evidenceState, candidates, context, runtimeCard, options = {}) {
  const now = options.now || (() => Date.now())
  const state = clone(evidenceState)
  const accepted = []
  const rejected = []

  for (const [index, candidate] of (candidates || []).entries()) {
    const checked = validateEvidenceCandidate(candidate, context.teacherTurn, runtimeCard, {
      evidenceState: state,
      turnId: context.turnId
    })
    if (!checked.ok) {
      const rejection = {
        index,
        evidenceClaimId: candidate?.evidenceClaimId || null,
        understandingId: candidate?.understandingId || null,
        errors: checked.errors
      }
      rejected.push(rejection)
      event(state, 'EvidenceCandidateRejected', { turnId: context.turnId, agentResultId: context.agentResultId, ...rejection }, now)
      continue
    }

    const claim = state.claims[checked.key]
    const before = clone(claim)
    let supersededEvidenceIds = []
    if (candidate.relation === 'REVISE') {
      supersededEvidenceIds = supersedeClaimRecords(state, claim, context, now)
      claim.revisionCount += 1
    }

    const records = checked.spans.map((span) =>
      makeRecord(state, candidate, checked, span, context, runtimeCard, now)
    )
    state.records.push(...records)
    if (candidate.relation === 'CONTRADICT') {
      claim.activeConflictIds.push(...records.map((record) => record.evidenceId))
      claim.hasConflict = true
    } else {
      claim.activeEvidenceIds.push(...records.map((record) => record.evidenceId))
      // SUPPORT 是累积证据，较弱的后续补充不能静默覆盖较强的既有状态；
      // 真正修订必须显式使用 REVISE，旧记录会被保留为 SUPERSEDED。
      recomputeClaimFromActiveEvidence(state, claim)
    }

    state.version += 1
    const commit = {
      index,
      evidenceClaimId: candidate.evidenceClaimId,
      understandingId: candidate.understandingId,
      relation: candidate.relation,
      responseOrigin: checked.determination.responseOrigin,
      proposedStatus: checked.determination.proposedStatus,
      effectiveStatus: checked.determination.effectiveStatus,
      determination: clone(checked.determination),
      evidenceIds: records.map((record) => record.evidenceId),
      supersededEvidenceIds,
      before,
      after: clone(claim)
    }
    accepted.push(commit)
    if (candidate.relation === 'REVISE') {
      state.revisions.push({
        revisionId: `rev-${state.revisions.length + 1}`,
        evidenceClaimId: candidate.evidenceClaimId,
        understandingId: candidate.understandingId,
        turnId: context.turnId,
        supersededEvidenceIds,
        replacementEvidenceIds: commit.evidenceIds,
        reason: candidate.rationale || 'teacher_correction',
        at: now()
      })
    }
    event(state, candidate.relation === 'REVISE' ? 'EvidenceRevised' : 'EvidenceCommitted', {
      turnId: context.turnId,
      agentResultId: context.agentResultId,
      evidenceClaimId: candidate.evidenceClaimId,
      understandingId: candidate.understandingId,
      relation: candidate.relation,
      responseOrigin: checked.determination.responseOrigin,
      proposedStatus: checked.determination.proposedStatus,
      effectiveStatus: checked.determination.effectiveStatus,
      determinationReasons: clone(checked.determination.reasons),
      policyRecordId: checked.policy.recordId || null,
      policySourceRef: checked.policy.sourceRef || null,
      policySchemaVersion: runtimeCard?.dataProvenance?.schemaVersion || null,
      policyConfigFingerprint: runtimeCard?.dataProvenance?.configFingerprint || null,
      exactTeacherSpans: checked.spans,
      evidenceIds: commit.evidenceIds,
      supersededEvidenceIds,
      before,
      after: clone(claim)
    }, now)
  }

  return { state, accepted, rejected }
}
