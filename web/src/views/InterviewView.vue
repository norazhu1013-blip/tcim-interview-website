<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ITEMS } from '../generated/data.js'
import { kbSlice } from '../core/interview.js'
import { computeProcess } from '../core/process.js'
import { initTcisSession, processTeacherTurn } from '../core/tcim/engine.js'
import { isTcisMode } from '../core/tcim/mode.js'
import { getProfile, getSession, saveSession } from '../services/storage.js'
import { interviewNext, reportInterview } from '../services/api.js'

const route = useRoute()
const router = useRouter()
const session = ref(getSession(route.params.sid))
const item = ITEMS.find((entry) => entry.item_id === route.params.itemId)
const selected = session.value?.selection?.final?.find((entry) => entry.id === route.params.itemId)
const answer = session.value?.answers?.[route.params.itemId]
const existing = session.value?.interview?.[route.params.itemId]
const messages = ref(existing?.messages?.slice() || [])
const input = ref('')
const sending = ref(false)
const done = ref(existing?.status === 'done')
const generationPaused = ref(Boolean(existing?.generationError))
const generationError = ref(existing?.generationError || '')
const startedAt = ref(existing?.startedAt || Date.now())
const remaining = ref(10 * 60)
const chatEnd = ref(null)
const stage = ref(existing?.stage || 'S1_CONTEXT')
const lastLLMProfile = ref(existing?.llmProfile || '')
const lastLLMModel = ref(existing?.llmModel || '')
const webLLMProfile = String(import.meta.env.VITE_INTERVIEW_LLM_PROFILE || '').trim()
const tcimEnabled = isTcisMode()
// TCIM 确定性会话：localStorage 恢复或新初始化
const tcimSession = ref(existing?.tcimSession || null)
let timer = null

const isReview = computed(() => existing?.status === 'done')
const timeText = computed(() => `${String(Math.floor(remaining.value / 60)).padStart(2, '0')}:${String(remaining.value % 60).padStart(2, '0')}`)

function historyForApi() {
  return messages.value.map((message) => ({
    role: message.role === 'teacher' ? 'teacher' : 'ai',
    text: message.text
  }))
}

/** TCIM 确定性模式：本地引擎生成下一问（不调用云端 LLM）。 */
function tcimEnsureSession() {
  if (!tcimSession.value) {
    const proc = computeProcess(answer)
    const profile = getProfile() || {}
    // 前测完整资料进 TurnContext：分数/教龄/过程数据全量作 prior（只影响不确定性/优先级，不填等级）
    const pretest = {
      mean: session.value?.scores?.mean ?? null,
      total: session.value?.scores?.total ?? null,
      teachingYears: profile.teachingYears || '',
      modificationCount: proc.modificationCount,
      durationMs: proc.durationMs,
      firstSwing: proc.firstSwing,
      lastSwing: proc.lastSwing,
      oscillation: proc.oscillation
    }
    tcimSession.value = initTcisSession(item.item_id, answer.final_ranking || [], [
      proc.firstSwing.strong ? '首位强摇摆' : '',
      proc.lastSwing.strong ? '末位强摇摆' : '',
      proc.oscillation ? '排序路径振荡' : ''
    ].filter(Boolean), pretest)
  }
  return tcimSession.value
}

/** TCIM 首问：教师尚未输入，只初始化并生成第一个问题。 */
function tcimFirstQuestion() {
  tcimEnsureSession()
  const gen = processTeacherTurn(tcimSession.value, '')
  return { ok: true, question: gen.question, done: gen.done, stage: 'S1_CONTEXT', nextStage: 'S1_CONTEXT', evidenceHint: [] }
}

/** TCIM 后续轮：传入教师最新原话。 */
function tcimNext(teacherText) {
  tcimEnsureSession()
  const out = processTeacherTurn(tcimSession.value, teacherText)
  return {
    ok: true,
    question: out.question,
    done: out.done,
    stage: 'S1_CONTEXT',
    nextStage: 'S1_CONTEXT',
    evidenceHint: (out.updates || []).map((u) => u.slot_id)
  }
}

async function requestNext() {
  if (tcimEnabled) {
    const teacherTurns = messages.value.filter((m) => m.role === 'teacher' && m.text)
    const latestTeacher = teacherTurns.length ? String(teacherTurns[teacherTurns.length - 1].text).trim() : ''
    const next = latestTeacher ? tcimNext(latestTeacher) : tcimFirstQuestion()
    if (!next.ok || (!next.question && !next.done)) {
      generationPaused.value = true
      generationError.value = next?.error || 'invalid_interview_response'
      persist(false)
      return false
    }
    generationPaused.value = false
    generationError.value = ''
    if (next.nextStage) stage.value = next.nextStage
    if (next.question) messages.value.push({ role: 'ai', text: next.question, ts: Date.now() })
    if (next.done) {
      done.value = true
      persist(true)
    } else {
      persist(false)
    }
    await nextTick()
    chatEnd.value?.scrollIntoView({ behavior: 'smooth' })
    return true
  }
  const process = computeProcess(answer)
  const profile = getProfile() || {}
  const context = {
    sessionId: session.value.sessionId,
    itemId: item.item_id,
    teacherName: profile.name || '',
    itemContext: { title: item.title, stem: item.stem, options: item.options },
    teacherRanking: answer.final_ranking,
    taskCard: selected?.task_card || null,
    taskCardSeed: selected || null,
    processTags: [
      process.firstSwing.strong ? '首位强摇摆' : '',
      process.lastSwing.strong ? '末位强摇摆' : '',
      process.oscillation ? '排序路径振荡' : ''
    ].filter(Boolean),
    history: historyForApi(),
    remainingMs: remaining.value * 1000,
    kbSlice: kbSlice(item.item_id),
    stage: stage.value,
    llmProfile: webLLMProfile || undefined
  }
  let next
  try {
    next = await interviewNext(context)
  } catch (error) {
    next = { ok: false, error: error?.message || 'gateway_request_failed' }
  }
  if (!next?.ok || (!next.question && !next.done)) {
    generationPaused.value = true
    generationError.value = next?.error || 'invalid_interview_response'
    persist(false)
    return false
  }

  generationPaused.value = false
  generationError.value = ''
  if (next.nextStage) stage.value = next.nextStage
  if (next.llmProfile) lastLLMProfile.value = next.llmProfile
  if (next.llmModel) lastLLMModel.value = next.llmModel
  if (next.question) messages.value.push({ role: 'ai', text: next.question, ts: Date.now() })
  if (next.done) {
    done.value = true
    persist(true)
  } else {
    persist(false)
  }
  await nextTick()
  chatEnd.value?.scrollIntoView({ behavior: 'smooth' })
  return true
}

async function send() {
  const text = input.value.trim()
  if (!text || sending.value || done.value || generationPaused.value) return
  messages.value.push({ role: 'teacher', text, ts: Date.now() })
  input.value = ''
  sending.value = true
  persist(false)
  try {
    await requestNext()
  } finally {
    sending.value = false
  }
}

async function retryQuestion() {
  if (sending.value || done.value) return
  sending.value = true
  try {
    await requestNext()
  } finally {
    sending.value = false
  }
}

function buildLocalClosing() {
  const teacherTurns = messages.value.filter((message) => message.role === 'teacher' && message.text)
  const last = teacherTurns.length ? String(teacherTurns[teacherTurns.length - 1].text).replace(/\s+/g, ' ').trim() : ''
  if (!last) return '谢谢您的参与。本情境访谈先到这里。'
  const excerpt = last.length > 42 ? `${last.slice(0, 42)}……` : last
  return `谢谢您的分享。我记下了您刚才强调的“${excerpt}”。本情境访谈先到这里。`
}

function endAfterError() {
  if (done.value || sending.value) return
  messages.value.push({ role: 'ai', text: buildLocalClosing(), ts: Date.now() })
  generationPaused.value = false
  generationError.value = ''
  done.value = true
  persist(true)
}

function persist(isDone) {
  session.value.interview ||= {}
  session.value.interview[item.item_id] = {
    itemId: item.item_id,
    status: isDone ? 'done' : 'in_progress',
    startedAt: startedAt.value,
    finishedAt: isDone ? Date.now() : null,
    messages: messages.value.slice(),
    teacherRanking: answer.final_ranking,
    stage: stage.value,
    llmProfile: lastLLMProfile.value,
    llmModel: lastLLMModel.value,
    generationError: generationPaused.value ? generationError.value : '',
    mode: tcimEnabled ? 'tcim' : 'legacy',
    tcimSession: tcimEnabled ? tcimSession.value : undefined,
    tcimReplay: tcimEnabled ? tcimSession.value?.replay?.slice() : undefined
  }
  session.value = saveSession(session.value)
  if (isDone) reportInterview(session.value)
}

function leave() {
  persist(done.value)
  router.push(`/interviews/${session.value.sessionId}`)
}

onMounted(async () => {
  if (!session.value || !item || !answer) {
    router.replace('/')
    return
  }
  const elapsed = Math.floor((Date.now() - startedAt.value) / 1000)
  remaining.value = Math.max(0, 10 * 60 - elapsed)
  timer = setInterval(() => {
    remaining.value = Math.max(0, remaining.value - 1)
  }, 1000)
  if (!messages.value.length && !isReview.value) {
    sending.value = true
    try {
      await requestNext()
    } finally {
      sending.value = false
    }
  }
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <section v-if="session && item" class="interview-live">
    <header class="interview-header">
      <button v-if="isReview || done" class="icon-button" @click="leave">←</button>
      <div><strong>{{ item.title }}</strong><small>内容由 AI 生成，仅供参考</small></div>
      <span :class="{ urgent: remaining < 60 }">{{ isReview ? '回看' : timeText }}</span>
    </header>

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

    <div v-if="generationPaused && !done && !isReview" class="chat-recovery">
      <div>
        <strong>刚才的问题暂时没有生成成功</strong>
        <span>您的回答已经保存，可以重新生成；如果不想继续，也可以结束本情境。</span>
      </div>
      <div class="chat-recovery-actions">
        <button class="button secondary" :disabled="sending" @click="retryQuestion">重新生成</button>
        <button class="button text" :disabled="sending" @click="endAfterError">结束本情境</button>
      </div>
    </div>
    <div v-else-if="!done && !isReview" class="chat-input">
      <textarea v-model="input" rows="2" maxlength="2000" placeholder="请输入您的回答…" @keydown.ctrl.enter="send"></textarea>
      <button class="button primary" :disabled="!input.trim() || sending" @click="send">发送</button>
    </div>
    <div v-else class="chat-complete">
      <span>本情境访谈已完成</span>
      <button class="button primary" @click="leave">返回情境列表</button>
    </div>
  </section>
</template>
