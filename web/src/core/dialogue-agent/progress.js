/**
 * Dialogue Agent 自己的多轮工作记忆。
 *
 * 它只归档已经发生的提问、教师原话线索和 Agent 自报的方向，不选择下一条
 * 专业路线，也不把“谈过”升级为 canonical Evidence。
 */

export const DIALOGUE_PROGRESS_SCHEMA = 'dialogue-agent.progress-state/v1'

export const DIALOGUE_PHASES = Object.freeze([
  'OPENING',
  'EXPLORING',
  'DEEPENING',
  'INTEGRATING',
  'REPAIRING',
  'CLOSING'
])

const THREAD_STATUSES = Object.freeze(['ACTIVE', 'DEFERRED', 'RESOLVED', 'ABANDONED'])
const ANSWER_STATUSES = Object.freeze(['PENDING', 'RECEIVED', 'DECLINED', 'NOT_APPLICABLE'])
const REPAIR_RE = /(纠正|修正|澄清|重新理解|理解准确|没理解|不是.{0,6}意思|我说的是|换个问法)/i
const INTEGRATE_RE = /(整合|综合|总结|归纳|联系起来|收束)/i
const DEEPEN_RE = /(比较|区别|条件|边界|机制|后果|改变|深入|深化|为什么|依据)/i
const EMPTY_PROGRESS = Object.freeze({
  score: 0,
  consecutiveSimilarGoals: 0,
  repeatedQuestionCount: 0,
  lastQuestionSemanticKey: '',
  lastProgressTurnId: '',
  reasonCodes: []
})

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function nonEmpty(value) {
  return typeof value === 'string' && Boolean(value.trim())
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))]
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/(您|你|刚才|提到|这个|能不能|可以|请|具体|说说|谈谈|一下)/g, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function bigrams(value) {
  const text = normalizeText(value)
  if (!text) return new Set()
  if (text.length === 1) return new Set([text])
  const out = new Set()
  for (let index = 0; index < text.length - 1; index += 1) out.add(text.slice(index, index + 2))
  return out
}

function diceSimilarity(left, right) {
  const a = bigrams(left)
  const b = bigrams(right)
  if (!a.size || !b.size) return 0
  let overlap = 0
  for (const value of a) if (b.has(value)) overlap += 1
  return (2 * overlap) / (a.size + b.size)
}

function normalizeUnderstanding(value = {}) {
  return {
    teacherQuote: String(value.teacherQuote ?? value.teacher_quote ?? '').trim(),
    meaning: String(value.meaning || '').trim(),
    confidence: String(value.confidence || 'LOW').trim().toUpperCase()
  }
}

function normalizeHypotheses(values) {
  return (Array.isArray(values) ? values : []).map((value) => ({
    hypothesisId: String(value?.hypothesisId ?? value?.hypothesis_id ?? '').trim(),
    statement: String(value?.statement || '').trim(),
    status: String(value?.status || 'UNKNOWN').trim().toUpperCase(),
    confidence: Number.isFinite(Number(value?.confidence)) ? Number(value.confidence) : 0,
    sourceRefs: uniqueStrings(value?.sourceRefs ?? value?.source_refs)
  })).filter((value) => value.hypothesisId && value.statement)
}

function directionOf(result = {}) {
  const direction = result.direction || {}
  return {
    label: String(direction.label || '').trim(),
    openThreadId: String(direction.openThreadId ?? direction.open_thread_id ?? '').trim(),
    rationale: String(direction.rationale || '').trim(),
    consultedPolicyIds: uniqueStrings(direction.consultedPolicyIds ?? direction.consulted_policy_ids)
  }
}

function phaseFor(result, context, direction) {
  if (result.action === 'CLOSE') return 'CLOSING'
  const signal = `${direction.label} ${direction.rationale} ${context.teacherTurn || ''}`
  if (REPAIR_RE.test(signal)) return 'REPAIRING'
  if (INTEGRATE_RE.test(signal)) return 'INTEGRATING'
  if (DEEPEN_RE.test(signal)) return 'DEEPENING'
  if (!String(context.teacherTurn || '').trim() || context.kind === 'FIRST_QUESTION') return 'OPENING'
  return 'EXPLORING'
}

function nextId(prefix, collection) {
  return `${prefix}-${collection.length + 1}`
}

function questionSemanticKey(questionText, direction) {
  return [
    direction.openThreadId,
    normalizeText(direction.label),
    normalizeText(questionText)
  ].join('::')
}

function updateStagnation(state, entry, addedCueCount) {
  const previous = [...state.questionLedger].reverse().find((item) => item.action === 'ASK')
  const prior = state.stagnation || EMPTY_PROGRESS
  const reasons = []
  let consecutive = 0
  let repeats = Number(prior.repeatedQuestionCount || 0)
  let score = Math.max(0, Number(prior.score || 0) - 1)

  if (previous) {
    const exactQuestion = normalizeText(previous.questionText) === normalizeText(entry.questionText)
    const sameThreadGoal = Boolean(
      previous.openThreadId
      && previous.openThreadId === entry.openThreadId
      && normalizeText(previous.goalLabel) === normalizeText(entry.goalLabel)
    )
    const nearQuestion = diceSimilarity(previous.questionText, entry.questionText) >= 0.82
    const similar = exactQuestion || sameThreadGoal || nearQuestion
    if (exactQuestion) reasons.push('exact_question_repeat')
    else if (sameThreadGoal) reasons.push('same_thread_same_goal')
    else if (nearQuestion) reasons.push('near_question_repeat')

    if (similar) repeats += 1
    if (similar && addedCueCount === 0) {
      consecutive = Number(prior.consecutiveSimilarGoals || 0) + 1
      score = Math.min(3, Math.max(1, Number(prior.score || 0) + 1))
      reasons.push('no_new_covered_cue')
    }
  }

  state.stagnation = {
    score,
    consecutiveSimilarGoals: consecutive,
    repeatedQuestionCount: repeats,
    lastQuestionSemanticKey: entry.semanticKey,
    lastProgressTurnId: entry.turnId,
    reasonCodes: reasons
  }
}

function upsertThread(state, direction, context, hypotheses, action, now) {
  if (!direction.openThreadId) return
  for (const thread of state.openThreads) {
    if (thread.status === 'ACTIVE' && thread.openThreadId !== direction.openThreadId) {
      thread.status = action === 'CLOSE' ? 'ABANDONED' : 'DEFERRED'
      thread.updatedAt = now()
    }
  }
  let thread = state.openThreads.find((item) => item.openThreadId === direction.openThreadId)
  if (!thread) {
    thread = {
      openThreadId: direction.openThreadId,
      statement: direction.label,
      rationale: direction.rationale,
      status: action === 'CLOSE' ? 'ABANDONED' : 'ACTIVE',
      originTurnId: context.turnId,
      lastTouchedTurnId: context.turnId,
      touchCount: 1,
      consultedPolicyIds: direction.consultedPolicyIds,
      hypothesisIds: hypotheses.map((item) => item.hypothesisId),
      lastTeacherTurnId: '',
      createdAt: now(),
      updatedAt: now()
    }
    state.openThreads.push(thread)
    return
  }
  thread.statement = direction.label || thread.statement
  thread.rationale = direction.rationale || thread.rationale
  thread.status = action === 'CLOSE' ? 'ABANDONED' : 'ACTIVE'
  thread.lastTouchedTurnId = context.turnId
  thread.touchCount = Number(thread.touchCount || 0) + 1
  thread.consultedPolicyIds = uniqueStrings([...thread.consultedPolicyIds, ...direction.consultedPolicyIds])
  thread.hypothesisIds = uniqueStrings([...thread.hypothesisIds, ...hypotheses.map((item) => item.hypothesisId)])
  thread.updatedAt = now()
}

function addCoveredCues(state, result, context, direction, hypotheses, acceptedEvidence, now) {
  const teacherTurn = String(context.teacherTurn || '')
  if (!teacherTurn) return 0
  const understanding = normalizeUnderstanding(result.understanding || {})
  const proposals = []
  if (understanding.teacherQuote && teacherTurn.includes(understanding.teacherQuote)) {
    proposals.push({
      span: understanding.teacherQuote,
      meaning: understanding.meaning,
      confidence: understanding.confidence,
      sourceKind: 'UNDERSTANDING'
    })
  }
  for (const candidate of Array.isArray(result.evidenceCandidates) ? result.evidenceCandidates : []) {
    for (const span of Array.isArray(candidate?.spans) ? candidate.spans : []) {
      const exact = String(span || '').trim()
      if (exact && teacherTurn.includes(exact)) {
        proposals.push({
          span: exact,
          meaning: String(candidate.rationale || '').trim(),
          confidence: Number.isFinite(Number(candidate.confidence)) ? Number(candidate.confidence) : null,
          sourceKind: 'EVIDENCE_CANDIDATE'
        })
      }
    }
  }

  let added = 0
  for (const proposal of proposals) {
    const duplicate = state.coveredCues.some((cue) => (
      cue.sourceTurnId === context.turnId
      && cue.span === proposal.span
      && cue.sourceKind === proposal.sourceKind
    ))
    if (duplicate) continue
    const evidenceIds = (Array.isArray(acceptedEvidence) ? acceptedEvidence : [])
      .filter((commit) => (commit.evidenceIds || []).length && (result.evidenceCandidates?.[commit.index]?.spans || []).includes(proposal.span))
      .flatMap((commit) => commit.evidenceIds)
    state.coveredCues.push({
      cueId: nextId('cue', state.coveredCues),
      sourceTurnId: context.turnId,
      span: proposal.span,
      meaning: proposal.meaning,
      confidence: proposal.confidence,
      sourceKind: proposal.sourceKind,
      openThreadId: direction.openThreadId,
      hypothesisIds: hypotheses.map((item) => item.hypothesisId),
      formalEvidenceIds: uniqueStrings(evidenceIds),
      createdAt: now()
    })
    added += 1
  }
  return added
}

export function initializeDialogueProgressState(runtimeCard) {
  return {
    schemaVersion: DIALOGUE_PROGRESS_SCHEMA,
    itemId: runtimeCard.itemId,
    version: 0,
    phase: 'OPENING',
    questionLedger: [],
    openThreads: [],
    coveredCues: [],
    stagnation: clone(EMPTY_PROGRESS)
  }
}

/** 在请求模型之前，先把教师回答链接到上一条可回答问题。 */
export function archiveTeacherTurn(progressState, context = {}, options = {}) {
  const state = clone(progressState)
  const now = options.now || (() => Date.now())
  const text = String(context.teacherTurn || '').trim()
  if (!text) return state
  const pending = [...state.questionLedger].reverse().find((entry) => entry.action === 'ASK' && entry.answerStatus === 'PENDING')
  if (pending) {
    pending.answerStatus = context.declined ? 'DECLINED' : 'RECEIVED'
    pending.answerTurnId = context.turnId || ''
    pending.answerExcerpt = text.slice(0, 160)
    pending.answeredAt = now()
  }
  const active = [...state.openThreads].reverse().find((thread) => thread.status === 'ACTIVE')
  if (active) {
    active.lastTeacherTurnId = context.turnId || ''
    active.updatedAt = now()
  }
  state.version += 1
  return state
}

/** 归档已通过契约与硬边界校验的 Agent 结果；不改变 Agent 选择的方向。 */
export function archiveAgentResult(progressState, result, context = {}, options = {}) {
  const state = clone(progressState)
  const now = options.now || (() => Date.now())
  const direction = directionOf(result)
  const hypotheses = normalizeHypotheses(result.workingHypotheses ?? result.working_hypotheses)
  const phase = phaseFor(result, context, direction)
  const addedCueCount = addCoveredCues(
    state,
    result,
    context,
    direction,
    hypotheses,
    context.acceptedEvidence,
    now
  )
  upsertThread(state, direction, context, hypotheses, result.action, now)

  const entry = {
    questionId: nextId('question', state.questionLedger),
    turnId: String(context.turnId || ''),
    action: result.action,
    questionText: String(result.visibleText || '').trim(),
    goalLabel: direction.label,
    rationale: direction.rationale,
    openThreadId: direction.openThreadId,
    consultedPolicyIds: direction.consultedPolicyIds,
    phase,
    semanticKey: questionSemanticKey(result.visibleText, direction),
    answerStatus: result.action === 'ASK' ? 'PENDING' : 'NOT_APPLICABLE',
    answerTurnId: '',
    answerExcerpt: '',
    understanding: normalizeUnderstanding(result.understanding || {}),
    workingHypotheses: hypotheses,
    createdAt: now()
  }
  if (result.action === 'ASK') updateStagnation(state, entry, addedCueCount)
  state.questionLedger.push(entry)
  state.phase = phase
  state.version += 1
  return state
}

export function closeDialogueProgress(progressState, context = {}, options = {}) {
  const state = clone(progressState)
  const now = options.now || (() => Date.now())
  for (const thread of state.openThreads) {
    if (thread.status === 'ACTIVE') {
      thread.status = context.explicitExit ? 'ABANDONED' : 'DEFERRED'
      thread.updatedAt = now()
    }
  }
  state.phase = 'CLOSING'
  state.version += 1
  return state
}

export function validateDialogueProgressState(state, expected = {}) {
  const errors = []
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, errors: ['dialogue_progress_state_not_object'] }
  }
  if (state.schemaVersion !== DIALOGUE_PROGRESS_SCHEMA) errors.push('dialogue_progress_schema_mismatch')
  if (expected.itemId && state.itemId !== expected.itemId) errors.push('dialogue_progress_item_mismatch')
  if (!DIALOGUE_PHASES.includes(state.phase)) errors.push('dialogue_progress_phase_invalid')
  if (!Array.isArray(state.questionLedger)) errors.push('dialogue_progress_question_ledger_missing')
  if (!Array.isArray(state.openThreads)) errors.push('dialogue_progress_open_threads_missing')
  if (!Array.isArray(state.coveredCues)) errors.push('dialogue_progress_covered_cues_missing')
  if (!state.stagnation || typeof state.stagnation !== 'object' || !Number.isFinite(Number(state.stagnation.score))) {
    errors.push('dialogue_progress_stagnation_invalid')
  }

  const questionIds = []
  for (const entry of Array.isArray(state.questionLedger) ? state.questionLedger : []) {
    if (!nonEmpty(entry?.questionId) || !nonEmpty(entry?.turnId) || !nonEmpty(entry?.questionText)) {
      errors.push('dialogue_progress_question_invalid')
      continue
    }
    if (!['ASK', 'CLOSE'].includes(entry.action)) errors.push('dialogue_progress_question_action_invalid')
    if (!ANSWER_STATUSES.includes(entry.answerStatus)) errors.push('dialogue_progress_answer_status_invalid')
    questionIds.push(entry.questionId)
  }
  if (new Set(questionIds).size !== questionIds.length) errors.push('dialogue_progress_question_id_duplicate')

  const threadIds = []
  for (const thread of Array.isArray(state.openThreads) ? state.openThreads : []) {
    if (!nonEmpty(thread?.openThreadId) || !THREAD_STATUSES.includes(thread?.status)) {
      errors.push('dialogue_progress_thread_invalid')
      continue
    }
    threadIds.push(thread.openThreadId)
  }
  if (new Set(threadIds).size !== threadIds.length) errors.push('dialogue_progress_thread_id_duplicate')

  const teacherTurns = new Map((Array.isArray(expected.history) ? expected.history : [])
    .filter((turn) => turn?.role === 'teacher' && nonEmpty(turn?.turnId))
    .map((turn) => [turn.turnId, String(turn.text || '')]))
  for (const cue of Array.isArray(state.coveredCues) ? state.coveredCues : []) {
    if (!nonEmpty(cue?.cueId) || !nonEmpty(cue?.sourceTurnId) || !nonEmpty(cue?.span)) {
      errors.push('dialogue_progress_cue_invalid')
      continue
    }
    if (teacherTurns.has(cue.sourceTurnId) && !teacherTurns.get(cue.sourceTurnId).includes(cue.span)) {
      errors.push('dialogue_progress_cue_not_in_teacher_turn')
    }
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)] }
}
