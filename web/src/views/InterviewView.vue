<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ITEMS } from '../generated/data.js'
import fiveTableRuntime from '../generated/tcim-new-five-tables.runtime.v0.1.json'
import { computeProcess } from '../core/process.js'
import {
  createDialogueSession,
  createRuntimeCardFromRuntimeData,
  retryDialogue,
  startDialogue,
  submitTeacherTurn,
  validateDialogueSessionForResume
} from '../core/dialogue-agent/index.js'
import {
  COMPARISON_INTERVIEW_MODE as INTERVIEW_MODE,
  isFormalComparisonInterviewRecord,
  isSimulationInterviewRecord
} from '../core/dialogue-agent/records.js'
import { getProfile, getSession, saveSession } from '../services/storage.js'
import { reportInterview, reportDraft } from '../services/api.js'
import { getDialogueAgentHealth, runDialogueAgent } from '../services/dialogueAgent.js'

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
const deadlineAt = ref(formalExisting?.deadlineAt || startedAt.value + 10 * 60 * 1000)
const remaining = ref(10 * 60)
const chatEnd = ref(null)
const lastLLMProfile = ref(formalExisting?.llmProfile || '')
const lastLLMModel = ref(formalExisting?.llmModel || '')
const generationFailures = ref(Array.isArray(formalExisting?.generationFailures) ? formalExisting.generationFailures.slice() : [])
const dialogueSession = ref(formalExisting?.dialogueSession || null)
const agentHealth = ref({ checked: false, ok: false, provider: '', model: '', error: '' })
const simulationOnly = ref(false)
const demoAuthorized = ref(false)
const demoRequired = ref(false)
let _lastDraftSignature = ''
let _draftQueue = Promise.resolve()
let _timeUpClosed = false
let _activeGeneration = null
let timer = null

const isReview = computed(() => activeExisting.value?.status === 'done')
const timeText = computed(() => `${String(Math.floor(remaining.value / 60)).padStart(2, '0')}:${String(remaining.value % 60).padStart(2, '0')}`)

function loadActiveRecord(record, asSimulation) {
  activeExisting.value = record || null
  messages.value = record?.messages?.slice() || []
  done.value = record?.status === 'done'
  startedAt.value = record?.startedAt || Date.now()
  deadlineAt.value = record?.deadlineAt || startedAt.value + 10 * 60 * 1000
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
  dialogueSession.value = createDialogueSession(runtimeCard)
  return dialogueSession.value
}

function providerFor(controller) {
  return (request) => runDialogueAgent(request, {
    signal: controller.signal,
    remainingMs: Math.max(0, deadlineAt.value - Date.now())
  })
}

function recordGenerationFailure(error, requestedAt) {
  generationPaused.value = true
  generationError.value = error || 'invalid_dialogue_agent_response'
  generationFailures.value.push({
    at: Date.now(),
    durationMs: Date.now() - requestedAt,
    afterTeacherTurns: messages.value.filter((message) => message.role === 'teacher').length,
    error: generationError.value
  })
  generationFailures.value = generationFailures.value.slice(-20)
}

async function acceptAgentOutcome(outcome, requestedAt) {
  if (_timeUpClosed) {
    if (dialogueSession.value) {
      dialogueSession.value.status = 'COMPLETED'
      dialogueSession.value.pendingRequest = null
    }
    return false
  }
  if (done.value) return false
  if (!outcome?.ok || !outcome.visibleText) {
    recordGenerationFailure(outcome?.error || 'invalid_dialogue_agent_response', requestedAt)
    persist(false)
    return false
  }
  generationPaused.value = false
  generationError.value = ''
  const trace = dialogueSession.value?.lastAgentResult?.trace || {}
  lastLLMProfile.value = trace.provider || lastLLMProfile.value
  lastLLMModel.value = trace.model || lastLLMModel.value
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
  const modelSession = ensureDialogueSession()
  _activeGeneration = new AbortController()
  const pending = startDialogue(modelSession, providerFor(_activeGeneration))
  // startDialogue 在首次 await 前已写入 GENERATING + pendingRequest；立即落盘，
  // 刷新页面后可以恢复为 PAUSED 并重试同一请求。
  persist(false)
  const outcome = await pending
  return acceptAgentOutcome(outcome, requestedAt)
}

async function generateAfterTeacher(teacherText) {
  const requestedAt = Date.now()
  const modelSession = ensureDialogueSession()
  _activeGeneration = new AbortController()
  const pending = submitTeacherTurn(modelSession, teacherText, providerFor(_activeGeneration))
  // 教师原话、turnSeq 和 pendingRequest 已同步写入领域会话，先持久化再等网络。
  persist(false)
  const outcome = await pending
  return acceptAgentOutcome(outcome, requestedAt)
}

async function send() {
  const text = input.value.trim()
  if (!text || sending.value || done.value || generationPaused.value) return
  messages.value.push({ role: 'teacher', text, ts: Date.now() })
  input.value = ''
  sending.value = true
  try {
    await generateAfterTeacher(text)
  } finally {
    sending.value = false
    _activeGeneration = null
  }
}

async function retryQuestion() {
  if (sending.value || done.value) return
  sending.value = true
  try {
    const requestedAt = Date.now()
    _activeGeneration = new AbortController()
    const pending = retryDialogue(ensureDialogueSession(), providerFor(_activeGeneration))
    persist(false)
    const outcome = await pending
    await acceptAgentOutcome(outcome, requestedAt)
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
  if (remaining.value <= 0) timeUpOnce()
}

function startDeadlineTimer() {
  clearInterval(timer)
  if (isReview.value || done.value || demoRequired.value) return
  refreshRemaining()
  if (remaining.value > 0) timer = setInterval(refreshRemaining, 1000)
}

async function startDemo() {
  if (sending.value || !demoRequired.value || agentHealth.value.provider !== 'mock') return
  loadActiveRecord(null, true)
  demoRequired.value = false
  demoAuthorized.value = true
  _timeUpClosed = false
  startedAt.value = Date.now()
  deadlineAt.value = startedAt.value + 10 * 60 * 1000
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

function persist(isDone) {
  const collection = simulationOnly.value ? 'simulationInterview' : 'comparisonInterview'
  session.value[collection] ||= {}
  session.value[collection][item.item_id] = {
    itemId: item.item_id,
    status: isDone ? 'done' : 'in_progress',
    startedAt: startedAt.value,
    deadlineAt: deadlineAt.value,
    finishedAt: isDone ? Date.now() : null,
    messages: messages.value.slice(),
    teacherRanking: answer.final_ranking,
    stage: 'OPEN_DIALOGUE',
    llmProfile: lastLLMProfile.value,
    llmModel: lastLLMModel.value,
    generationFailures: generationFailures.value.slice(),
    generationError: generationPaused.value ? generationError.value : '',
    simulationOnly: simulationOnly.value,
    mode: INTERVIEW_MODE,
    architecture: 'Dialogue Agent主导＋新五表＋Evidence State',
    runtimeDatasetId: fiveTableRuntime.datasetId,
    runtimeConfigFingerprint: fiveTableRuntime.configFingerprint,
    dialogueSession: dialogueSession.value
  }
  session.value = saveSession(session.value)
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
  session.value = saveSession(session.value)
}

function leave() {
  if ((!demoRequired.value || demoAuthorized.value) && (messages.value.length || dialogueSession.value)) persist(done.value)
  router.push(`/interviews/${session.value.sessionId}`)
}

onMounted(async () => {
  if (!session.value || !item || !answer) {
    router.replace('/')
    return
  }
  try {
    const health = await getDialogueAgentHealth()
    agentHealth.value = {
      checked: true,
      ok: Boolean(health?.ok && health?.ready),
      provider: health?.provider || '',
      model: health?.model || '',
      error: health?.ready === false ? 'API 密钥尚未配置' : ''
    }
  } catch (error) {
    agentHealth.value = { checked: true, ok: false, provider: '', model: '', error: error?.code || '本机服务未启动' }
  }

  if (agentHealth.value.provider === 'mock') {
    loadActiveRecord(simulationExisting, true)
    demoAuthorized.value = Boolean(simulationExisting)
    demoRequired.value = !simulationExisting
  } else {
    loadActiveRecord(formalExisting, false)
  }

  if (!agentHealth.value.ok) {
    generationPaused.value = true
    generationError.value = agentHealth.value.error || 'dialogue_agent_unavailable'
    return
  }
  if (demoRequired.value) return

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
})
</script>

<template>
  <section v-if="session && item" class="interview-live">
    <header class="interview-header">
      <button v-if="isReview || done" class="icon-button" @click="leave">←</button>
      <div><strong>{{ item.title }}</strong><small>Dialogue Agent 主导 · 新五表提供专业视野 · Evidence State 留存依据</small></div>
      <span :class="{ urgent: remaining < 60 }">{{ isReview ? (simulationOnly ? '演示回看' : '回看') : timeText }}</span>
    </header>

    <div class="cloud-health" :class="agentHealth.provider === 'mock' ? 'demo' : (agentHealth.ok ? 'ok' : (agentHealth.checked ? 'down' : 'checking'))">
      <span v-if="!agentHealth.checked">正在连接本机 Dialogue Agent…</span>
      <span v-else-if="agentHealth.provider === 'mock'">
        当前没有真实模型密钥，仅提供演示模式；演示记录不会进入正式比较统计或报告。
      </span>
      <span v-else-if="agentHealth.ok">
        Dialogue Agent 已就绪 · {{ agentHealth.provider }}<template v-if="agentHealth.model"> / {{ agentHealth.model }}</template>
      </span>
      <span v-else>Dialogue Agent 暂不可用（{{ agentHealth.error || '本机服务未启动' }}）· 已输入内容仍会保存在本机</span>
    </div>

    <article class="interview-context">
      <details open>
        <summary>查看案例、四个做法与本人排序</summary>
        <p>{{ item.stem }}</p>
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

    <div v-if="demoRequired && !done && !isReview" class="chat-recovery demo-consent">
      <div>
        <strong>是否进入本机演示？</strong>
        <span>演示使用固定测试响应，只用于检查界面与保存流程，不代表真实 Dialogue Agent，也不会计入正式研究结果。</span>
      </div>
      <div class="chat-recovery-actions">
        <button class="button secondary" :disabled="sending" @click="startDemo">进入演示</button>
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
        <strong>刚才的问题暂时没有生成成功</strong>
        <span>您的回答已经保存，可以重新生成；如果不想继续，也可以结束本情境。</span>
      </div>
      <div class="chat-recovery-actions">
        <button class="button secondary" :disabled="sending" @click="retryQuestion">重新生成</button>
        <button class="button text" :disabled="sending" @click="endAfterError">结束本情境</button>
      </div>
    </div>
    <div v-else-if="!done && !isReview && agentHealth.ok" class="chat-input">
      <textarea v-model="input" rows="2" maxlength="2000" placeholder="请输入您的回答…" @keydown.ctrl.enter="send"></textarea>
      <button class="button primary" :disabled="!input.trim() || sending" @click="send">发送</button>
    </div>
    <div v-else class="chat-complete">
      <span>{{ simulationOnly ? '本情境演示已完成（不计入正式结果）' : '本情境访谈已完成' }}</span>
      <button class="button primary" @click="leave">返回情境列表</button>
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
.demo-consent { border-color: #f2c078; background: #fffaf0; }
</style>
