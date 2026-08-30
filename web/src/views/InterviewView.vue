<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ITEMS } from '../generated/data.js'
import fiveTableRuntime from '../generated/tcim-new-five-tables.runtime.v0.2.json'
import { computeProcess } from '../core/process.js'
import {
  createDialogueSession,
  createRuntimeCardFromRuntimeData,
  applyBackgroundEvidenceAnalysis,
  completeFinalTeacherTurn,
  retryDialogue,
  startDialogue,
  submitTeacherTurn,
  validateDialogueSessionForResume
} from '../core/dialogue-agent/index.js'
import {
  INTERVIEW_DURATION_MS,
  INTEGRATIVE_QUESTION_TRIGGER_MS,
  WRAP_UP_NOTICE,
  WRAP_UP_RESERVE_MS,
  interviewTimePhase,
  mayStartForegroundGeneration,
  shouldRequestIntegrativeQuestion
} from '../core/interview-timing.js'
import {
  COMPARISON_INTERVIEW_MODE as INTERVIEW_MODE,
  isFormalComparisonInterviewRecord,
  isSimulationInterviewRecord
} from '../core/dialogue-agent/records.js'
import { getProfile, getSession, saveSession } from '../services/storage.js'
import { reportInterview, reportDraft } from '../services/api.js'
import { analyzeDialogueEvidence, getDialogueAgentHealth, runDialogueAgent } from '../services/dialogueAgent.js'
import { configureDialogueModel, getDialogueModelConfig } from '../services/modelConfig.js'

const route = useRoute()
const router = useRouter()
const session = ref(getSession(route.params.sid))
const item = ITEMS.find((entry) => entry.item_id === route.params.itemId)
const answer = session.value?.answers?.[route.params.itemId]
const storedInterview = session.value?.interview?.[route.params.itemId]
// 正式 comparison、演示和旧访谈分区保存，任何一种都不会覆盖另外两种。
const storedComparison = session.value?.comparisonInterview?.[route.params.itemId]
const migratedComparison = isFormalComparisonInterviewRecord(storedInterview) ? storedInterview : null
const formalExisting = isFormalComparisonInterviewRecord(storedComparison) ? storedComparison : migratedComparison
const simulationExisting = session.value?.simulationInterview?.[route.params.itemId]
  || (isSimulationInterviewRecord(storedComparison) ? storedComparison : null)
  || (storedInterview?.mode === INTERVIEW_MODE && isSimulationInterviewRecord(storedInterview) ? storedInterview : null)
const activeExisting = ref(formalExisting)
const messages = ref(formalExisting?.messages?.slice() || [])
const input = ref('')
const sending = ref(false)
const done = ref(formalExisting?.status === 'done')
const generationPaused = ref(Boolean(formalExisting?.generationError || formalExisting?.dialogueSession?.pendingRequest))
const generationError = ref(formalExisting?.generationError || (formalExisting?.dialogueSession?.pendingRequest ? 'generation_interrupted' : ''))
const startedAt = ref(formalExisting?.startedAt || Date.now())
const deadlineAt = ref(formalExisting?.deadlineAt || startedAt.value + INTERVIEW_DURATION_MS)
const remaining = ref(Math.ceil(INTERVIEW_DURATION_MS / 1000))
const wrapUpStartedAt = ref(formalExisting?.wrapUpStartedAt || null)
const chatEnd = ref(null)
const lastLLMProfile = ref(formalExisting?.llmProfile || '')
const lastLLMModel = ref(formalExisting?.llmModel || '')
const generationFailures = ref(Array.isArray(formalExisting?.generationFailures) ? formalExisting.generationFailures.slice() : [])
const performanceMetrics = ref(Array.isArray(formalExisting?.performanceMetrics) ? formalExisting.performanceMetrics.slice() : [])
const dialogueSession = ref(formalExisting?.dialogueSession || null)
const agentHealth = ref({ checked: false, ok: false, provider: '', model: '', error: '' })
const simulationOnly = ref(false)
const demoAuthorized = ref(false)
const demoRequired = ref(false)
const modelSelectionRequired = ref(false)
const modelConfig = ref({ checked: false, provider: 'mock', model: '', ready: false, configured: { kimi: false, openai: false } })
const selectedModelProvider = ref('kimi')
const modelApiKey = ref('')
const configuringModel = ref(false)
const modelConfigError = ref('')
const concurrentTabBlocked = ref(false)
let _lastDraftSignature = ''
let _draftQueue = Promise.resolve()
let _timeUpClosed = false
let _activeGeneration = null
let _releaseInterviewExecutionLock = null
let _interviewExecutionLockTask = null
let timer = null

const latencyTargetMs = 7000
const latencySummary = computed(() => {
  const rows = performanceMetrics.value.filter((row) => Number(row.visibleLatencyMs) > 0)
  const latest = rows.at(-1) || null
  const averageMs = rows.length ? Math.round(rows.reduce((sum, row) => sum + Number(row.visibleLatencyMs || 0), 0) / rows.length) : 0
  const withinTarget = rows.filter((row) => Number(row.visibleLatencyMs) <= latencyTargetMs).length
  return { rows, latest, averageMs, withinTarget, total: rows.length }
})
function seconds(value) { return `${(Number(value || 0) / 1000).toFixed(1)}秒` }

const isReview = computed(() => activeExisting.value?.status === 'done')
const timeText = computed(() => `${String(Math.floor(remaining.value / 60)).padStart(2, '0')}:${String(remaining.value % 60).padStart(2, '0')}`)
const inWrapUp = computed(() => interviewTimePhase(remaining.value * 1000) === 'WRAP_UP')
const teacherStageLabel = computed(() => {
  if (isReview.value || done.value) return '访谈已完成'
  return inWrapUp.value ? '完成最后补充' : '自由讲述与追问'
})
const selectedProviderConfigured = computed(() => Boolean(modelConfig.value.configured?.[selectedModelProvider.value]))
const selectedProviderName = computed(() => selectedModelProvider.value === 'openai' ? 'OpenAI' : 'Kimi K3')
const lockedModelSelection = computed(() => session.value?.dialogueModelSelection || null)
const activeProviderMismatch = computed(() => Boolean(
  !simulationOnly.value
  && !done.value
  && lockedModelSelection.value?.provider
  && agentHealth.value.provider
  && (
    lockedModelSelection.value.provider !== agentHealth.value.provider
    || (
      lockedModelSelection.value.model
      && agentHealth.value.model
      && lockedModelSelection.value.model !== agentHealth.value.model
    )
  )
))
const pausedForModelMismatch = computed(() => /provider_mismatch|model_mismatch/i.test(String(generationError.value || '')))
const pausedForConcurrentTab = computed(() => generationError.value === 'concurrent_interview_tab')
const pausedForSessionUpgrade = computed(() => [
  'dialogue_session_upgrade_required',
  'dialogue_model_provenance_missing'
].includes(generationError.value))

function loadActiveRecord(record, asSimulation) {
  activeExisting.value = record || null
  messages.value = record?.messages?.slice() || []
  done.value = record?.status === 'done'
  startedAt.value = record?.startedAt || Date.now()
  deadlineAt.value = record?.deadlineAt || startedAt.value + INTERVIEW_DURATION_MS
  wrapUpStartedAt.value = record?.wrapUpStartedAt || null
  performanceMetrics.value = Array.isArray(record?.performanceMetrics) ? record.performanceMetrics.slice() : []
  lastLLMProfile.value = record?.llmProfile || ''
  lastLLMModel.value = record?.llmModel || ''
  generationFailures.value = Array.isArray(record?.generationFailures) ? record.generationFailures.slice() : []
  dialogueSession.value = record?.dialogueSession || null
  simulationOnly.value = Boolean(asSimulation)
  const interrupted = Boolean(dialogueSession.value?.pendingRequest && dialogueSession.value?.status === 'GENERATING')
  if (interrupted) dialogueSession.value.status = 'PAUSED'
  generationPaused.value = Boolean(record?.generationError || interrupted || dialogueSession.value?.status === 'PAUSED')
  generationError.value = record?.generationError || (generationPaused.value ? 'generation_interrupted' : '')
}

/** 同一 sessionId+itemId 只允许一个标签页执行，避免相同 turnSeq 互相覆盖。 */
function claimInterviewExecutionLock() {
  if (!globalThis.navigator?.locks?.request) return Promise.resolve(false)
  return new Promise((resolve) => {
    let resolved = false
    _interviewExecutionLockTask = navigator.locks.request(
      `tcim-interview:${session.value.sessionId}:${item.item_id}`,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (!lock) {
          resolved = true
          resolve(false)
          return
        }
        resolved = true
        resolve(true)
        await new Promise((release) => { _releaseInterviewExecutionLock = release })
      }
    ).catch(() => {
      if (!resolved) resolve(false)
    })
  })
}

/** 新五表只提供专业地图和证据合同；它们不提供固定问句，也不决定路线。 */
function ensureDialogueSession() {
  const process = computeProcess(answer)
  const profile = getProfile() || {}
  const runtimeCard = createRuntimeCardFromRuntimeData(fiveTableRuntime, {
    sessionId: session.value.sessionId,
    itemId: item.item_id,
    teacherContext: {
      finalRanking: answer.final_ranking || [],
      firstRanking: answer.first_ranking || [],
      scoreSummary: {
        mean: session.value?.scores?.mean ?? null,
        total: session.value?.scores?.total ?? null
      },
      processPrior: {
        teachingYears: profile.teachingYears || '',
        modificationCount: process.modificationCount,
        durationMs: process.durationMs,
        firstSwing: process.firstSwing,
        lastSwing: process.lastSwing,
        oscillation: process.oscillation
      }
    }
  })
  const restored = validateDialogueSessionForResume(dialogueSession.value, {
    sessionId: session.value.sessionId,
    itemId: runtimeCard.itemId,
    datasetId: fiveTableRuntime.datasetId,
    configFingerprint: fiveTableRuntime.configFingerprint,
    runtimeSchemaVersion: fiveTableRuntime.schemaVersion
  })
  if (restored.ok) return dialogueSession.value
  const hasPriorDialogue = Boolean(
    messages.value.length
    || dialogueSession.value?.history?.length
    || dialogueSession.value?.evidenceState?.records?.length
    || dialogueSession.value?.version > 0
  )
  if (hasPriorDialogue) {
    const error = new Error('dialogue_session_upgrade_required')
    error.code = 'dialogue_session_upgrade_required'
    error.details = restored.errors
    throw error
  }
  dialogueSession.value = createDialogueSession(runtimeCard)
  return dialogueSession.value
}

function providerFor(controller, options = {}) {
  const locked = session.value?.dialogueModelSelection || {}
  const expectedProvider = simulationOnly.value ? 'mock' : (locked.provider || lastLLMProfile.value || agentHealth.value.provider)
  const expectedModel = simulationOnly.value ? 'mock-dialogue-v1' : (locked.model || lastLLMModel.value || agentHealth.value.model)
  return (request) => runDialogueAgent(request, {
    signal: controller.signal,
    remainingMs: Math.max(0, deadlineAt.value - Date.now()),
    questionMode: request.runtimeDirectives?.questionMode || options.questionMode || 'NORMAL',
    expectedProvider,
    expectedModel
  })
}

function integrativeQuestionAlreadyAsked(modelSession = dialogueSession.value) {
  return ['ASKED', 'ANSWERED'].includes(modelSession?.integrativeQuestion?.status)
}

function markIntegrativeQuestionAsked(modelSession, outcome, remainingMs) {
  modelSession.integrativeQuestion = {
    status: 'ASKED',
    questionTurnId: `turn-${modelSession.turnSeq}`,
    questionText: outcome.visibleText,
    askedAt: Date.now(),
    remainingMs: Number(remainingMs || 0)
  }
  modelSession.version += 1
  modelSession.auditLog.push({
    eventId: `dialogue-log-${modelSession.auditLog.length + 1}`,
    type: 'IntegrativeQuestionAsked',
    at: modelSession.integrativeQuestion.askedAt,
    sessionVersion: modelSession.version,
    remainingMs: modelSession.integrativeQuestion.remainingMs,
    triggerMs: INTEGRATIVE_QUESTION_TRIGGER_MS,
    questionText: outcome.visibleText
  })
}

function recordGenerationFailure(error, requestedAt, details = '') {
  generationPaused.value = true
  generationError.value = error || 'invalid_dialogue_agent_response'
  generationFailures.value.push({
    at: Date.now(),
    durationMs: Date.now() - requestedAt,
    afterTeacherTurns: messages.value.filter((message) => message.role === 'teacher').length,
    error: generationError.value,
    details: String(details || '').slice(0, 600)
  })
  generationFailures.value = generationFailures.value.slice(-20)
}

function pauseForLocalSessionError(error, requestedAt) {
  recordGenerationFailure(
    error?.code || error?.message || 'dialogue_session_invalid',
    requestedAt,
    error?.message || error?.details || ''
  )
  persist(false)
  return false
}

function addVisiblePerformanceMetric(requestedAt, phase) {
  const trace = dialogueSession.value?.lastAgentResult?.trace || {}
  const metric = {
    metricId: `${dialogueSession.value?.itemId || item.item_id}:${phase}:${Date.now()}`,
    turnId: phase === 'first' ? 'turn-0' : `turn-${dialogueSession.value?.turnSeq || 0}`,
    phase,
    provider: trace.provider || lastLLMProfile.value || '',
    model: trace.model || lastLLMModel.value || '',
    visibleLatencyMs: Date.now() - requestedAt,
    providerLatencyMs: Number(trace.latencyMs || 0),
    inputTokens: Number(trace.usage?.input_tokens || 0),
    outputTokens: Number(trace.usage?.output_tokens || 0),
    totalTokens: Number(trace.usage?.total_tokens || 0),
    questionQuality: trace.questionQuality || null,
    questionMode: trace.questionMode || 'NORMAL',
    relationshipMoveRequested: trace.relationshipMoveRequested || 'NONE',
    relationalMicrocueObserved: Boolean(trace.relationalMicrocueObserved),
    relationalCuePrefix: trace.relationalCuePrefix || '',
    generationAttempts: Number(trace.generationAttempts || 1),
    visibleStyleAdjusted: Boolean(trace.visibleStyleAdjusted),
    remainingMsAtRequest: Math.max(0, deadlineAt.value - requestedAt),
    targetMs: latencyTargetMs,
    withinTarget: Date.now() - requestedAt <= latencyTargetMs,
    evidenceStatus: phase === 'first' ? 'not_applicable' : 'pending',
    evidenceLatencyMs: 0,
    evidenceInputTokens: 0,
    evidenceOutputTokens: 0,
    at: Date.now()
  }
  performanceMetrics.value.push(metric)
  performanceMetrics.value = performanceMetrics.value.slice(-60)
  return metric
}

function updatePerformanceMetric(metricId, updates) {
  const index = performanceMetrics.value.findIndex((row) => row.metricId === metricId)
  if (index < 0) return
  performanceMetrics.value[index] = { ...performanceMetrics.value[index], ...updates }
  performanceMetrics.value = performanceMetrics.value.slice()
}

async function runBackgroundEvidenceAnalysis({ teacherText, turnId, elicitingQuestion, metricId }) {
  const startedAt = Date.now()
  try {
    const locked = session.value?.dialogueModelSelection || {}
    const analysis = await analyzeDialogueEvidence({
      runtimeCard: dialogueSession.value.runtimeCard,
      teacherTurn: teacherText,
      elicitingQuestion,
      evidenceState: dialogueSession.value.evidenceState,
      history: dialogueSession.value.history.filter((turn) => !(turn.role === 'agent' && turn.turnId === turnId))
    }, {
      expectedProvider: locked.provider || lastLLMProfile.value || agentHealth.value.provider,
      expectedModel: locked.model || lastLLMModel.value || agentHealth.value.model
    })
    const committed = applyBackgroundEvidenceAnalysis(dialogueSession.value, analysis, { turnId, teacherTurn: teacherText })
    updatePerformanceMetric(metricId, {
      evidenceStatus: 'completed',
      evidenceLatencyMs: Date.now() - startedAt,
      evidenceAccepted: committed.accepted.length,
      evidenceRejected: committed.rejected.length,
      evidenceInputTokens: Number(analysis.trace?.usage?.input_tokens || 0),
      evidenceOutputTokens: Number(analysis.trace?.usage?.output_tokens || 0)
    })
  } catch (error) {
    updatePerformanceMetric(metricId, {
      evidenceStatus: 'failed',
      evidenceLatencyMs: Date.now() - startedAt,
      evidenceError: error?.code || error?.message || 'background_evidence_failed'
    })
  }
  persist(done.value)
}

async function acceptAgentOutcome(outcome, requestedAt, phase = 'next', recordPerformance = true) {
  if (_timeUpClosed) {
    if (dialogueSession.value) {
      dialogueSession.value.status = 'COMPLETED'
      dialogueSession.value.pendingRequest = null
    }
    return false
  }
  if (done.value) return false
  if (!outcome?.ok || !outcome.visibleText) {
    recordGenerationFailure(
      outcome?.error || 'invalid_dialogue_agent_response',
      requestedAt,
      outcome?.errorDetails || ''
    )
    persist(false)
    return false
  }
  generationPaused.value = false
  generationError.value = ''
  const trace = dialogueSession.value?.lastAgentResult?.trace || {}
  lastLLMProfile.value = trace.provider || lastLLMProfile.value
  lastLLMModel.value = trace.model || lastLLMModel.value
  if (recordPerformance) addVisiblePerformanceMetric(requestedAt, phase)
  messages.value.push({
    role: 'ai',
    text: outcome.visibleText,
    ts: Date.now(),
    generationSource: 'dialogue_agent',
    direction: outcome.direction || null,
    model: trace.model || ''
  })
  if (outcome.action === 'CLOSE' || outcome.status === 'completed') {
    done.value = true
    clearInterval(timer)
  }
  persist(done.value)
  await nextTick()
  chatEnd.value?.scrollIntoView({ behavior: 'smooth' })
  return true
}

async function generateFirstQuestion() {
  const requestedAt = Date.now()
  let modelSession
  try {
    modelSession = ensureDialogueSession()
  } catch (error) {
    return pauseForLocalSessionError(error, requestedAt)
  }
  _activeGeneration = new AbortController()
  const pending = startDialogue(modelSession, providerFor(_activeGeneration))
  // startDialogue 在首次 await 前已写入 GENERATING + pendingRequest；立即落盘，
  // 刷新页面后可以恢复为 PAUSED 并重试同一请求。
  persist(false)
  const outcome = await pending
  return acceptAgentOutcome(outcome, requestedAt, 'first')
}

async function generateAfterTeacher(teacherText, preparedSession = null, options = {}) {
  const requestedAt = Date.now()
  let modelSession = preparedSession
  if (!modelSession) {
    try {
      modelSession = ensureDialogueSession()
    } catch (error) {
      return pauseForLocalSessionError(error, requestedAt)
    }
  }
  _activeGeneration = new AbortController()
  const previousResultId = modelSession.lastAgentResult?.resultId || ''
  const pending = submitTeacherTurn(
    modelSession,
    teacherText,
    providerFor(_activeGeneration, options),
    { runtimeDirectives: { questionMode: options.questionMode || 'NORMAL' } }
  )
  // 教师原话、turnSeq 和 pendingRequest 已同步写入领域会话，先持久化再等网络。
  persist(false)
  const outcome = await pending
  const modelGenerated = Boolean(modelSession.lastAgentResult?.resultId && modelSession.lastAgentResult.resultId !== previousResultId)
  const accepted = await acceptAgentOutcome(outcome, requestedAt, 'next', modelGenerated)
  if (accepted && modelGenerated && options.questionMode === 'INTEGRATIVE_SYNTHESIS' && outcome.action === 'ASK') {
    markIntegrativeQuestionAsked(modelSession, outcome, options.remainingMs)
    persist(false)
  }
  if (accepted && modelGenerated && dialogueSession.value?.lastAgentResult?.trace?.requestId) {
    const metric = performanceMetrics.value.at(-1)
    const turnId = `turn-${modelSession.turnSeq}`
    const elicitingQuestion = [...messages.value].reverse().find((message) => message.role === 'ai' && message.text !== outcome.visibleText)?.text || ''
    void runBackgroundEvidenceAnalysis({ teacherText, turnId, elicitingQuestion, metricId: metric?.metricId })
  }
  return accepted
}

async function send() {
  const text = input.value.trim()
  if (!text || sending.value || done.value || generationPaused.value) return
  const requestedAt = Date.now()
  let modelSession
  try {
    // 先确认旧会话能安全恢复，再把教师原话加入可见记录；避免出现“页面已保存、
    // 领域会话却没有接住”的悬空教师回答。
    modelSession = ensureDialogueSession()
  } catch (error) {
    pauseForLocalSessionError(error, requestedAt)
    return
  }
  messages.value.push({ role: 'teacher', text, ts: Date.now() })
  input.value = ''
  sending.value = true
  try {
    const remainingMs = Math.max(0, deadlineAt.value - Date.now())
    const answeringIntegrativeQuestion = modelSession.integrativeQuestion?.status === 'ASKED'
    if (answeringIntegrativeQuestion || !mayStartForegroundGeneration(remainingMs)) {
      enterWrapUpWindow('FINAL_TEACHER_SUBMISSION')
      const elicitingQuestion = [...messages.value].reverse().find((message) => message.role === 'ai')?.text || ''
      const outcome = completeFinalTeacherTurn(modelSession, text, {
        reason: answeringIntegrativeQuestion ? 'INTEGRATIVE_QUESTION_ANSWERED' : 'TIME_RESERVED_WRAP_UP',
        reservedMs: WRAP_UP_RESERVE_MS
      })
      if (answeringIntegrativeQuestion) {
        modelSession.integrativeQuestion.status = 'ANSWERED'
        modelSession.integrativeQuestion.answerTurnId = outcome.turnId
        modelSession.integrativeQuestion.answeredAt = Date.now()
      }
      messages.value.push({
        role: 'ai',
        text: outcome.visibleText,
        ts: Date.now(),
        generationSource: 'time_controller'
      })
      done.value = true
      clearInterval(timer)
      persist(true)
      await nextTick()
      chatEnd.value?.scrollIntoView({ behavior: 'smooth' })
      void runBackgroundEvidenceAnalysis({
        teacherText: text,
        turnId: outcome.turnId,
        elicitingQuestion,
        metricId: null
      })
    } else {
      const askIntegrative = shouldRequestIntegrativeQuestion(
        remainingMs,
        integrativeQuestionAlreadyAsked(modelSession)
      )
      await generateAfterTeacher(text, modelSession, {
        questionMode: askIntegrative ? 'INTEGRATIVE_SYNTHESIS' : 'NORMAL',
        remainingMs
      })
    }
  } finally {
    sending.value = false
    _activeGeneration = null
  }
}

function enterWrapUpWindow(reason = 'CLOCK_THRESHOLD') {
  if (wrapUpStartedAt.value || done.value || isReview.value) return
  wrapUpStartedAt.value = Date.now()
  if (dialogueSession.value) {
    dialogueSession.value.version += 1
    dialogueSession.value.auditLog.push({
      eventId: `dialogue-log-${dialogueSession.value.auditLog.length + 1}`,
      type: 'WrapUpWindowEntered',
      at: wrapUpStartedAt.value,
      sessionVersion: dialogueSession.value.version,
      reason,
      reservedMs: WRAP_UP_RESERVE_MS
    })
  }
  persist(false)
}

async function retryQuestion() {
  if (sending.value || done.value) return
  sending.value = true
  try {
    const requestedAt = Date.now()
    let modelSession
    try {
      modelSession = ensureDialogueSession()
    } catch (error) {
      pauseForLocalSessionError(error, requestedAt)
      return
    }
    _activeGeneration = new AbortController()
    const pending = retryDialogue(modelSession, providerFor(_activeGeneration))
    persist(false)
    const outcome = await pending
    await acceptAgentOutcome(outcome, requestedAt, dialogueSession.value?.turnSeq ? 'next' : 'first')
  } finally {
    sending.value = false
    _activeGeneration = null
  }
}

function buildLocalClosing() {
  const teacherTurns = messages.value.filter((message) => message.role === 'teacher' && message.text)
  const last = teacherTurns.length ? String(teacherTurns[teacherTurns.length - 1].text).replace(/\s+/g, ' ').trim() : ''
  if (!last) return '谢谢您的参与。本情境访谈先到这里。'
  const excerpt = last.length > 42 ? `${last.slice(0, 42)}……` : last
  return `谢谢您的分享。我记下了您刚才强调的“${excerpt}”。本情境访谈先到这里。`
}

// 1.5：倒计时归零只触发一次的受控收束——写收束语、标 done、保存并上报、停输入。
function timeUpOnce() {
  if (_timeUpClosed || done.value || isReview.value) return
  _timeUpClosed = true
  clearInterval(timer)
  _activeGeneration?.abort()
  remaining.value = 0
  const closing = '本情境的访谈时间已到，感谢您的认真分享。我们先到这里。'
  if (!messages.value.some((m) => m.role === 'ai' && m.text === closing)) {
    messages.value.push({ role: 'ai', text: closing, ts: Date.now(), generationSource: 'timeout' })
  }
  if (dialogueSession.value) {
    dialogueSession.value.status = 'COMPLETED'
    dialogueSession.value.pendingRequest = null
    dialogueSession.value.version += 1
    dialogueSession.value.auditLog.push({
      eventId: `dialogue-log-${dialogueSession.value.auditLog.length + 1}`,
      type: 'TimeLimitReached',
      at: Date.now(),
      sessionVersion: dialogueSession.value.version
    })
  }
  done.value = true
  clearInterval(timer)
  persist(true)
}

function refreshRemaining() {
  remaining.value = Math.max(0, Math.ceil((deadlineAt.value - Date.now()) / 1000))
  const phase = interviewTimePhase(remaining.value * 1000)
  if (phase === 'EXPIRED') timeUpOnce()
  else if (phase === 'WRAP_UP') enterWrapUpWindow()
}

function startDeadlineTimer() {
  clearInterval(timer)
  if (isReview.value || done.value || demoRequired.value) return
  refreshRemaining()
  if (remaining.value > 0) timer = setInterval(refreshRemaining, 1000)
}

function applyModelConfig(payload = {}) {
  const configured = {
    kimi: Boolean(payload.configured?.kimi),
    openai: Boolean(payload.configured?.openai)
  }
  modelConfig.value = {
    checked: true,
    provider: payload.provider || 'mock',
    model: payload.model || '',
    ready: Boolean(payload.ready),
    configured
  }
  if (payload.provider === 'kimi' || payload.provider === 'openai') {
    selectedModelProvider.value = payload.provider
  } else if (configured.kimi) {
    selectedModelProvider.value = 'kimi'
  } else if (configured.openai) {
    selectedModelProvider.value = 'openai'
  }
}

function openRealModelSelection() {
  modelConfigError.value = ''
  if (['kimi', 'openai'].includes(lockedModelSelection.value?.provider)) {
    selectedModelProvider.value = lockedModelSelection.value.provider
  }
  modelSelectionRequired.value = true
}

function refreshAssessmentLockFromStorage() {
  const latest = getSession(session.value?.sessionId)
  const latestLock = latest?.dialogueModelSelection
  if (latestLock?.provider) {
    session.value = { ...session.value, dialogueModelSelection: latestLock }
    return latestLock
  }
  return lockedModelSelection.value
}

async function withAssessmentConfigLock(task) {
  if (!globalThis.navigator?.locks?.request) {
    throw new Error('当前浏览器不支持安全的测评会话锁。请只保留一个本机比较版页面，或使用最新版 Microsoft Edge。')
  }
  return navigator.locks.request(`tcim-dialogue-model:${session.value.sessionId}`, { mode: 'exclusive' }, task)
}

function preflightLoadedDialogue() {
  if (done.value || isReview.value || (!messages.value.length && !dialogueSession.value)) return true
  try {
    ensureDialogueSession()
    return true
  } catch (error) {
    pauseForLocalSessionError(error, Date.now())
    return false
  }
}

async function resumeFormalAfterModelConfiguration() {
  if (!preflightLoadedDialogue()) return
  startDeadlineTimer()
  if (done.value || remaining.value <= 0 || isReview.value) return

  if (generationPaused.value && pausedForModelMismatch.value) {
    if (dialogueSession.value?.pendingRequest) {
      await retryQuestion()
      return
    }
    generationPaused.value = false
    generationError.value = ''
    persist(false)
  }

  if (!messages.value.length && !generationPaused.value) {
    sending.value = true
    try {
      await generateFirstQuestion()
    } finally {
      sending.value = false
      _activeGeneration = null
    }
  }
}

async function configureRealModel() {
  if (configuringModel.value || sending.value) return
  const provider = selectedModelProvider.value
  const apiKey = modelApiKey.value.trim()

  configuringModel.value = true
  modelConfigError.value = ''
  try {
    await withAssessmentConfigLock(async () => {
      const sessionLock = refreshAssessmentLockFromStorage()
      const preserveActiveFormal = Boolean(!simulationOnly.value && messages.value.length)
      if (sessionLock?.provider && !sessionLock.model) {
        throw new Error('这次旧测评只记录了模型服务商，没有记录具体模型，不能作为可比较数据继续；请返回并开始一次新测评。')
      }
      if (sessionLock?.provider && provider !== sessionLock.provider) {
        throw new Error(`本次测评已锁定 ${sessionLock.provider}，三道正式访谈不能中途换模型；如需比较另一模型，请新建一次测评。`)
      }
      if (!apiKey && !modelConfig.value.configured?.[provider]) {
        throw new Error(`请先填写 ${selectedProviderName.value} API 密钥。`)
      }

      const configured = await configureDialogueModel({ provider, apiKey })
      applyModelConfig(configured)
      if (!configured.ready || configured.provider !== provider) throw new Error('模型没有成功启用')
      agentHealth.value = {
        checked: true,
        ok: true,
        provider: configured.provider,
        model: configured.model || '',
        error: ''
      }
      if (sessionLock?.model && configured.model !== sessionLock.model) {
        throw new Error(`本次测评已锁定模型 ${sessionLock.model}，本机当前模型为 ${configured.model || '未知'}，不能中途替换。`)
      }

      if (!sessionLock?.provider) {
        const modelSelection = {
          provider: configured.provider,
          model: configured.model || '',
          selectedAt: Date.now(),
          scope: 'assessment_session'
        }
        session.value.dialogueModelSelection = modelSelection
        session.value = saveMergedSession({ dialogueModelSelection: modelSelection })
      }

      demoRequired.value = false
      demoAuthorized.value = false
      modelSelectionRequired.value = false

      if (preserveActiveFormal) {
        await resumeFormalAfterModelConfiguration()
        return
      }

      clearInterval(timer)
      _activeGeneration?.abort()
      loadActiveRecord(formalExisting, false)
      _timeUpClosed = false
      if (!formalExisting) {
        startedAt.value = Date.now()
        deadlineAt.value = startedAt.value + INTERVIEW_DURATION_MS
        generationPaused.value = false
        generationError.value = ''
      }
      await resumeFormalAfterModelConfiguration()
    })
  } catch (error) {
    modelConfigError.value = error?.message || '模型设置没有保存成功，请检查密钥后重试。'
  } finally {
    // 密钥不在浏览器里保留；服务端也不会把它返回给页面。
    modelApiKey.value = ''
    configuringModel.value = false
  }
}

async function startDemo() {
  if (sending.value || !demoRequired.value || agentHealth.value.provider !== 'mock') return
  loadActiveRecord(null, true)
  demoRequired.value = false
  demoAuthorized.value = true
  modelSelectionRequired.value = false
  _timeUpClosed = false
  startedAt.value = Date.now()
  deadlineAt.value = startedAt.value + INTERVIEW_DURATION_MS
  startDeadlineTimer()
  sending.value = true
  try {
    await generateFirstQuestion()
  } finally {
    sending.value = false
    _activeGeneration = null
  }
}

function endAfterError() {
  if (done.value || sending.value) return
  messages.value.push({ role: 'ai', text: buildLocalClosing(), ts: Date.now() })
  generationPaused.value = false
  generationError.value = ''
  if (dialogueSession.value) {
    dialogueSession.value.status = 'COMPLETED'
    dialogueSession.value.pendingRequest = null
  }
  done.value = true
  persist(true)
}

/**
 * 保存当前题时先合并本机最新会话：另一标签页刚写入的模型锁和其他题记录优先保留，
 * 当前题的这一条记录最后覆盖。模型选择本身只在 Web Locks 独占区内创建。
 */
function saveMergedSession(overrides = {}) {
  const latest = getSession(session.value.sessionId) || {}
  const merged = { ...session.value, ...latest, ...overrides }
  for (const key of ['answers', 'interview', 'comparisonInterview', 'simulationInterview']) {
    merged[key] = {
      ...(session.value?.[key] || {}),
      ...(latest?.[key] || {}),
      ...(overrides?.[key] || {})
    }
  }
  merged.dialogueModelSelection = latest.dialogueModelSelection
    || overrides.dialogueModelSelection
    || session.value.dialogueModelSelection
  return saveSession(merged)
}

function persist(isDone) {
  const collection = simulationOnly.value ? 'simulationInterview' : 'comparisonInterview'
  const record = {
    itemId: item.item_id,
    status: isDone ? 'done' : 'in_progress',
    startedAt: startedAt.value,
    deadlineAt: deadlineAt.value,
    wrapUpStartedAt: wrapUpStartedAt.value,
    finishedAt: isDone ? Date.now() : null,
    messages: messages.value.slice(),
    teacherRanking: answer.final_ranking,
    stage: 'OPEN_DIALOGUE',
    llmProfile: lastLLMProfile.value,
    llmModel: lastLLMModel.value,
    generationFailures: generationFailures.value.slice(),
    performanceMetrics: performanceMetrics.value.slice(),
    generationError: generationPaused.value ? generationError.value : '',
    simulationOnly: simulationOnly.value,
    mode: INTERVIEW_MODE,
    architecture: 'Dialogue Agent主导＋新五表＋Evidence State',
    runtimeDatasetId: fiveTableRuntime.datasetId,
    runtimeConfigFingerprint: fiveTableRuntime.configFingerprint,
    dialogueSession: dialogueSession.value
  }
  session.value[collection] ||= {}
  session.value[collection][item.item_id] = record
  session.value = saveMergedSession({ [collection]: { [item.item_id]: record } })
  if (!simulationOnly.value) {
    syncDraft(isDone)
    if (isDone) reportCompletion()
  }
}

// 逐轮云端草稿（1.3）：教师每发一轮回答就按 sessionId+itemId+turnSeq 幂等 upsert，
// 让服务端知道进行中的访谈；浏览器本地保存只作离线副本。失败不阻断访谈，仅记录。
function syncDraft(isDone) {
  const teacherTurns = messages.value.filter((m) => m.role === 'teacher').length
  const evidenceVersion = dialogueSession.value?.evidenceState?.version || 0
  const signature = `${teacherTurns}:${messages.value.length}:${evidenceVersion}:${isDone ? 'done' : 'active'}`
  const payload = {
      sessionId: session.value.sessionId,
      itemId: item.item_id,
      turnSeq: teacherTurns,
      status: isDone ? 'done' : 'in_progress',
      messages: messages.value.map((m) => ({ role: m.role, text: m.text })),
      architecture: INTERVIEW_MODE,
      evidenceVersion,
      runtimeConfigFingerprint: fiveTableRuntime.configFingerprint
  }
  _draftQueue = _draftQueue.catch(() => {}).then(async () => {
    if (signature === _lastDraftSignature) return
    try {
      const result = await reportDraft(payload)
      if (result?.ok) _lastDraftSignature = signature
    } catch (e) {
      console.warn('[interview] draft sync failed', e?.message || e)
    }
  })
  return _draftQueue
}

// 向云端上报整次访谈：await 校验服务端回执，把成功回执或失败原因写回会话，
// 供 DoneView/回看显示「云端已保存 / 待同步」。失败不弹错、不阻断页面（最终保存由 Feedback 门卫把关）。
async function reportCompletion() {
  try {
    session.value.reportRevision = (session.value.reportRevision || 0) + 1
    const res = await reportInterview(session.value)
    session.value.reportPayloadBytes = res?.requestPayloadBytes || 0
    if (res && res.ok && res.serverRecordId) {
      session.value.reportReceipt = { serverRecordId: res.serverRecordId, serverUpdatedAt: res.serverUpdatedAt, payloadHash: res.payloadHash }
      session.value.reportError = ''
    } else {
      session.value.reportError = (res && res.error) || 'report_failed'
    }
  } catch (e) {
    session.value.reportError = e?.message || 'report_failed'
  }
  session.value = saveMergedSession({
    reportRevision: session.value.reportRevision,
    reportPayloadBytes: session.value.reportPayloadBytes,
    reportReceipt: session.value.reportReceipt,
    reportError: session.value.reportError
  })
}

function leave() {
  if (!concurrentTabBlocked.value && (!demoRequired.value || demoAuthorized.value) && (messages.value.length || dialogueSession.value)) persist(done.value)
  router.push(`/interviews/${session.value.sessionId}`)
}

onMounted(async () => {
  if (!session.value || !item || !answer) {
    router.replace('/')
    return
  }
  if (!(await claimInterviewExecutionLock())) {
    concurrentTabBlocked.value = true
    generationPaused.value = true
    generationError.value = 'concurrent_interview_tab'
    agentHealth.value = { checked: true, ok: false, provider: '', model: '', error: '本情境已在另一个页面打开' }
    return
  }
  const [healthResult, configResult] = await Promise.allSettled([
    getDialogueAgentHealth(),
    getDialogueModelConfig()
  ])
  if (healthResult.status === 'fulfilled') {
    const health = healthResult.value
    agentHealth.value = {
      checked: true,
      ok: Boolean(health?.ok && health?.ready),
      provider: health?.provider || '',
      model: health?.model || '',
      error: health?.ready === false ? 'API 密钥尚未配置' : ''
    }
  } else {
    const error = healthResult.reason
    agentHealth.value = { checked: true, ok: false, provider: '', model: '', error: error?.code || '本机服务未启动' }
  }

  if (configResult.status === 'fulfilled') {
    applyModelConfig(configResult.value)
  } else {
    const activeProvider = agentHealth.value.provider
    applyModelConfig({
      provider: activeProvider || 'mock',
      model: agentHealth.value.model,
      ready: agentHealth.value.ok,
      configured: {
        kimi: activeProvider === 'kimi' && agentHealth.value.ok,
        openai: activeProvider === 'openai' && agentHealth.value.ok
      }
    })
  }
  let lockedProvider = String(session.value?.dialogueModelSelection?.provider || '')
  if (!lockedProvider && ['kimi', 'openai'].includes(formalExisting?.llmProfile)) {
    const migratedModelSelection = {
      provider: formalExisting.llmProfile,
      model: formalExisting.llmModel || '',
      selectedAt: formalExisting.startedAt || Date.now(),
      scope: 'assessment_session',
      migratedFromFormalRecord: true
    }
    session.value.dialogueModelSelection = migratedModelSelection
    session.value = saveMergedSession({ dialogueModelSelection: migratedModelSelection })
    lockedProvider = formalExisting.llmProfile
  }
  if (lockedProvider === 'kimi' || lockedProvider === 'openai') selectedModelProvider.value = lockedProvider

  if (agentHealth.value.provider === 'mock') {
    loadActiveRecord(simulationExisting, true)
    demoAuthorized.value = Boolean(simulationExisting)
    demoRequired.value = !simulationExisting
    modelSelectionRequired.value = !simulationExisting
  } else {
    loadActiveRecord(formalExisting, false)
    demoRequired.value = false
    const modelSelectionMatches = lockedProvider === agentHealth.value.provider && agentHealth.value.ok
    modelSelectionRequired.value = !formalExisting && !modelSelectionMatches
  }

  if (!agentHealth.value.ok) {
    generationPaused.value = true
    generationError.value = agentHealth.value.error || 'dialogue_agent_unavailable'
    return
  }
  if (!simulationOnly.value && !done.value && !isReview.value && lockedProvider && !lockedModelSelection.value?.model) {
    modelSelectionRequired.value = false
    generationPaused.value = true
    generationError.value = 'dialogue_model_provenance_missing'
    return
  }
  if (demoRequired.value || modelSelectionRequired.value) return

  if (!done.value && !isReview.value && (messages.value.length || dialogueSession.value)) {
    try {
      ensureDialogueSession()
    } catch (error) {
      pauseForLocalSessionError(error, Date.now())
      return
    }
  }

  if (activeProviderMismatch.value) {
    generationPaused.value = true
    generationError.value = lockedModelSelection.value?.model !== agentHealth.value.model
      ? 'model_mismatch'
      : 'provider_mismatch'
    persist(false)
    return
  }

  startDeadlineTimer()
  if (remaining.value <= 0 || done.value || isReview.value) return

  if (!messages.value.length && !generationPaused.value) {
    sending.value = true
    try {
      await generateFirstQuestion()
    } finally {
      sending.value = false
      _activeGeneration = null
    }
  } else if (generationPaused.value) persist(false)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  _activeGeneration?.abort()
  _releaseInterviewExecutionLock?.()
  _releaseInterviewExecutionLock = null
  _interviewExecutionLockTask = null
})
</script>

<template>
  <section v-if="session && item" class="interview-live">
    <header class="interview-header">
      <button v-if="isReview || done" class="icon-button" @click="leave">←</button>
      <div><strong>{{ item.title }}</strong><small>围绕这个情境，聊聊您当时会怎样判断</small></div>
      <em class="teacher-stage">{{ teacherStageLabel }}</em>
      <span :class="{ urgent: remaining <= WRAP_UP_RESERVE_MS / 1000 }">{{ isReview ? (simulationOnly ? '演示回看' : '回看') : timeText }}</span>
    </header>

    <div v-if="inWrapUp && !done && !isReview" class="wrap-up-notice" role="status">
      <strong>收尾时间</strong>
      <span>{{ WRAP_UP_NOTICE }}</span>
    </div>

    <div class="cloud-health" :class="agentHealth.provider === 'mock' ? 'demo' : (agentHealth.ok ? 'ok' : (agentHealth.checked ? 'down' : 'checking'))">
      <span v-if="pausedForConcurrentTab">本情境已在另一个页面打开；当前页面不会读写访谈记录。</span>
      <span v-else-if="!agentHealth.checked">正在连接本机 Dialogue Agent…</span>
      <span v-else-if="agentHealth.provider === 'mock'">
        当前运行的是固定工程演示，不是真实 AI；它只能检查页面与保存流程，不能用来评价提问质量。
      </span>
      <span v-else-if="activeProviderMismatch">
        本次测评已锁定 {{ lockedModelSelection.provider }}<template v-if="lockedModelSelection.model"> / {{ lockedModelSelection.model }}</template>，但本机当前是 {{ agentHealth.provider }}<template v-if="agentHealth.model"> / {{ agentHealth.model }}</template>；系统不会混用模型。
      </span>
      <span v-else-if="agentHealth.ok">
        AI已连接<template v-if="agentHealth.model"> · {{ agentHealth.model }}</template>
      </span>
      <span v-else>Dialogue Agent 暂不可用（{{ agentHealth.error || '本机服务未启动' }}）· 已输入内容仍会保存在本机</span>
      <button
        v-if="agentHealth.checked && (activeProviderMismatch || agentHealth.provider === 'mock' || simulationOnly || (!messages.length && !sending))"
        class="health-action"
        type="button"
        @click="openRealModelSelection"
      >{{ activeProviderMismatch ? '恢复本次访谈模型' : '选择真实模型' }}</button>
    </div>

    <details v-if="latencySummary.total" class="latency-board">
      <summary>
        <span>本轮耗时</span>
        <strong :class="latencySummary.latest?.withinTarget ? 'met' : 'missed'">{{ seconds(latencySummary.latest?.visibleLatencyMs) }}</strong>
        <small>目标≤7秒 · 点击查看</small>
      </summary>
      <div class="latency-overview">
        <span>平均可见 {{ seconds(latencySummary.averageMs) }}</span>
        <span>达标 {{ latencySummary.withinTarget }}/{{ latencySummary.total }}</span>
        <span>{{ latencySummary.latest?.model || latencySummary.latest?.provider }}</span>
      </div>
      <div class="latency-rows">
        <div v-for="row in latencySummary.rows.slice(-6).reverse()" :key="row.metricId">
          <span>{{ row.phase === 'first' ? '首问' : row.turnId }}</span>
          <strong :class="row.withinTarget ? 'met' : 'missed'">{{ seconds(row.visibleLatencyMs) }}</strong>
          <small>输入{{ row.inputTokens || 0 }} · 输出{{ row.outputTokens || 0 }}</small>
          <small v-if="row.questionQuality" :class="row.questionQuality.passed ? 'met' : 'missed'">问话{{ row.questionQuality.passed ? '质检通过' : '需复核' }}</small>
          <small v-if="row.evidenceStatus === 'pending'">Evidence后台分析中</small>
          <small v-else-if="row.evidenceStatus === 'completed'">Evidence {{ seconds(row.evidenceLatencyMs) }}（不阻塞）</small>
          <small v-else-if="row.evidenceStatus === 'failed'" class="missed">Evidence待重试</small>
        </div>
      </div>
    </details>

    <article class="interview-context">
      <p class="scenario-text">{{ item.stem }}</p>
      <details>
        <summary>查看四个做法与我的排序</summary>
        <div class="context-options">
          <p v-for="letter in answer.final_ranking" :key="letter">
            <strong>{{ letter }}</strong><span>{{ item.options[letter] }}</span>
          </p>
        </div>
        <p class="ranking-summary">本人排序：{{ answer.final_ranking.join(' ＞ ') }}</p>
      </details>
    </article>

    <div class="chat-list">
      <div v-for="(message, i) in messages" :key="`${message.ts}-${i}`" class="chat-row" :class="message.role">
        <span>{{ message.role === 'teacher' ? '我' : 'AI' }}</span>
        <div><p>{{ message.text }}</p><time>{{ new Date(message.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</time></div>
      </div>
      <div v-if="sending" class="chat-row ai"><span>AI</span><div><p class="typing">正在整理下一问…</p></div></div>
      <div ref="chatEnd"></div>
    </div>

    <div v-if="modelSelectionRequired" class="chat-recovery model-setup">
      <div class="model-setup-heading">
        <strong>先选择真正参与访谈的 AI</strong>
        <span>为了保证研究结果可比较，本次测评的三道正式访谈将统一使用本次选定的模型。</span>
      </div>
      <div class="provider-choices" role="group" aria-label="选择AI模型">
        <button
          type="button"
          :class="{ selected: selectedModelProvider === 'kimi' }"
          :disabled="lockedModelSelection?.provider && lockedModelSelection.provider !== 'kimi'"
          :aria-pressed="selectedModelProvider === 'kimi'"
          @click="selectedModelProvider = 'kimi'; modelConfigError = ''"
        >
          <strong>Kimi K3</strong>
          <small>{{ modelConfig.configured?.kimi ? '本机已保存' : '需要 API 密钥' }}</small>
        </button>
        <button
          type="button"
          :class="{ selected: selectedModelProvider === 'openai' }"
          :disabled="lockedModelSelection?.provider && lockedModelSelection.provider !== 'openai'"
          :aria-pressed="selectedModelProvider === 'openai'"
          @click="selectedModelProvider = 'openai'; modelConfigError = ''"
        >
          <strong>OpenAI</strong>
          <small>{{ modelConfig.configured?.openai ? '本机已保存' : '需要 API 密钥' }}</small>
        </button>
      </div>
      <label class="model-key-field">
        <span>{{ selectedProviderConfigured ? 'API 密钥（已配置；留空可直接使用，填写则替换）' : `${selectedProviderName} API 密钥` }}</span>
        <input
          v-model="modelApiKey"
          type="password"
          autocomplete="new-password"
          spellcheck="false"
          :placeholder="selectedProviderConfigured ? '本机已有密钥' : '仅发送到本机服务，不保存到浏览器本地存储或 Git'"
          @keydown.enter.prevent="configureRealModel"
        />
      </label>
      <p class="model-key-note">密钥不会保存在浏览器本地存储、测评业务数据或 Git 中；密钥是否有效会在生成第一问时由模型服务验证。</p>
      <p v-if="modelConfigError" class="model-config-error">{{ modelConfigError }}</p>
      <div class="chat-recovery-actions">
        <button class="button primary" :disabled="configuringModel || sending" @click="configureRealModel">
          {{ configuringModel ? '正在启用…' : `使用 ${selectedProviderName} 开始正式访谈` }}
        </button>
        <button
          v-if="agentHealth.provider === 'mock' && demoRequired"
          class="button secondary"
          :disabled="configuringModel || sending"
          @click="startDemo"
        >仅进入固定演示</button>
        <button class="button text" :disabled="configuringModel" @click="leave">返回情境列表</button>
      </div>
    </div>
    <div v-else-if="demoRequired && !done && !isReview" class="chat-recovery demo-consent">
      <div>
        <strong>是否进入本机演示？</strong>
        <span>演示使用固定测试响应，只用于检查界面与保存流程，不代表真实 Dialogue Agent，也不会计入正式研究结果。</span>
      </div>
      <div class="chat-recovery-actions">
        <button class="button secondary" :disabled="sending" @click="startDemo">进入演示</button>
        <button class="button text" @click="leave">返回情境列表</button>
      </div>
    </div>
    <div v-else-if="pausedForConcurrentTab && !done && !isReview" class="chat-recovery">
      <div>
        <strong>请回到已经打开的那个页面继续</strong>
        <span>同一情境不能在两个页面同时访谈，否则两边的回答会互相覆盖。本页已自动进入只读保护。</span>
      </div>
      <div class="chat-recovery-actions">
        <button class="button text" @click="leave">返回情境列表</button>
      </div>
    </div>
    <div v-else-if="agentHealth.checked && !agentHealth.ok && !done && !isReview" class="chat-recovery">
      <div>
        <strong>Dialogue Agent 暂不可用</strong>
        <span>尚未开始正式访谈，也不会生成本地替代问题。请启动服务后重新进入本情境。</span>
      </div>
      <div class="chat-recovery-actions">
        <button class="button text" @click="leave">返回情境列表</button>
      </div>
    </div>
    <div v-else-if="generationPaused && !done && !isReview" class="chat-recovery">
      <div>
        <strong>{{ pausedForSessionUpgrade ? '这是旧版测试会话，不能安全续接' : (pausedForModelMismatch ? '本次访谈的模型被其他页面切换了' : '刚才的问题暂时没有生成成功') }}</strong>
        <span>{{ pausedForSessionUpgrade ? '旧对话仍保留供查看。为避免丢失历史和证据，本版不会把它接到一个新会话；请返回情境列表，并用一次新的测评开始正式比较。' : (pausedForModelMismatch ? '您的回答已经保存。请恢复本次测评锁定的模型后继续，系统不会混用两个模型。' : '您的回答已经保存，可以重新生成；如果不想继续，也可以结束本情境。') }}</span>
      </div>
      <div class="chat-recovery-actions">
        <button v-if="pausedForSessionUpgrade" class="button secondary" :disabled="sending" @click="leave">返回情境列表</button>
        <button v-else-if="pausedForModelMismatch" class="button secondary" :disabled="sending" @click="openRealModelSelection">恢复锁定模型</button>
        <button v-else class="button secondary" :disabled="sending" @click="retryQuestion">重新生成</button>
        <button v-if="!pausedForSessionUpgrade" class="button text" :disabled="sending" @click="endAfterError">结束本情境</button>
      </div>
    </div>
    <div v-else-if="!done && !isReview && agentHealth.ok" class="chat-input">
      <textarea
        v-model="input"
        rows="2"
        maxlength="2000"
        :placeholder="inWrapUp ? '请完成最后的补充…' : '请输入您的回答…'"
        @keydown.ctrl.enter="send"
      ></textarea>
      <button class="button primary" :disabled="!input.trim() || sending" @click="send">{{ inWrapUp ? '完成并保存' : '发送' }}</button>
    </div>
    <div v-else class="chat-complete">
      <span>{{ simulationOnly ? '本情境演示已完成（不计入正式结果）' : '本情境访谈已完成' }}</span>
      <div class="chat-recovery-actions">
        <button v-if="simulationOnly" class="button primary" @click="openRealModelSelection">使用真实模型重新访谈</button>
        <button :class="['button', simulationOnly ? 'secondary' : 'primary']" @click="leave">返回情境列表</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cloud-health {
  padding: 6px 14px;
  font-size: 13px;
  line-height: 1.4;
  border-bottom: 1px solid #eef0f4;
}
.cloud-health.ok { color: #067647; background: #f1fbf4; }
.cloud-health.demo { color: #8a4b08; background: #fff7e8; }
.cloud-health.down { color: #b42318; background: #fdecea; }
.cloud-health.checking { color: #475467; background: #f8fafc; }
.teacher-stage { flex: none; border: 1px solid #d7e0f4; border-radius: 999px; padding: 4px 9px; color: #425b91; background: #f6f8ff; font-size: 12px; font-style: normal; white-space: nowrap; }
.scenario-text { margin: 0; color: #344054; font-size: 14px; line-height: 1.7; }
.interview-context details { margin-top: 8px; }
.wrap-up-notice { display: flex; gap: 8px; align-items: center; padding: 9px 14px; border-bottom: 1px solid #f1d59b; color: #7a4d00; background: #fff8e8; font-size: 13px; }
.wrap-up-notice strong { flex: none; }
.health-action {
  margin-left: 10px;
  border: 0;
  border-bottom: 1px solid currentColor;
  padding: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
  font: inherit;
}
.latency-board { margin: 8px 0 0; border: 1px solid #e5e9f2; border-radius: 12px; background: #fff; color: #475467; font-size: 12px; }
.latency-board summary { display: flex; align-items: center; gap: 8px; padding: 9px 12px; cursor: pointer; list-style: none; }
.latency-board summary::-webkit-details-marker { display: none; }
.latency-board summary span { font-weight: 700; color: #344054; }
.latency-board summary small { margin-left: auto; color: #98a2b3; }
.latency-board .met { color: #067647; }
.latency-board .missed { color: #b54708; }
.latency-overview { display: flex; gap: 14px; flex-wrap: wrap; padding: 0 12px 9px; border-bottom: 1px solid #eef0f4; }
.latency-rows { padding: 5px 12px 9px; }
.latency-rows > div { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 5px 0; border-bottom: 1px dashed #eef0f4; }
.latency-rows > div > small:last-child { margin-left: auto; }
.latency-rows > div:last-child { border-bottom: 0; }
.demo-consent { border-color: #f2c078; background: #fffaf0; }
.model-setup {
  align-items: stretch;
  flex-direction: column;
  border-color: #b7c5f6;
  background: rgba(250, 252, 255, .98);
}
.model-setup-heading strong, .model-setup-heading span { display: block; }
.model-setup-heading span { margin-top: 3px; color: #667085; font-size: 13px; }
.provider-choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.provider-choices button {
  border: 1px solid #d7dce7;
  border-radius: 12px;
  padding: 10px 12px;
  color: #344054;
  background: #fff;
  text-align: left;
  cursor: pointer;
}
.provider-choices button.selected { border-color: #3f63d6; box-shadow: 0 0 0 2px rgba(63, 99, 214, .12); color: #243f9d; }
.provider-choices button:disabled { opacity: .48; cursor: not-allowed; }
.provider-choices strong, .provider-choices small { display: block; }
.provider-choices small { margin-top: 2px; color: #667085; }
.model-key-field span { display: block; margin-bottom: 5px; color: #475467; font-size: 13px; }
.model-key-field input { width: 100%; border: 1px solid #d7dce7; border-radius: 10px; padding: 10px 12px; outline: none; }
.model-key-field input:focus { border-color: #3f63d6; box-shadow: 0 0 0 3px rgba(63, 99, 214, .1); }
.model-key-note { margin: -2px 0 0; color: #667085; font-size: 12px; }
.model-config-error { margin: 0; color: #b42318; font-size: 13px; }
@media (max-width: 620px) {
  .teacher-stage { display: none; }
  .provider-choices { grid-template-columns: 1fr; }
  .model-setup .chat-recovery-actions { flex-direction: column; }
}
</style>
