<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ITEMS } from '../generated/data.js'
import { buildScriptQueue, kbSlice, stopScript } from '../core/interview.js'
import { computeProcess } from '../core/process.js'
import { getSession, saveSession } from '../services/storage.js'
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
const startedAt = ref(existing?.startedAt || Date.now())
const remaining = ref(10 * 60)
const chatEnd = ref(null)
const scriptQueue = buildScriptQueue(route.params.itemId, answer?.final_ranking)
let timer = null

const isReview = computed(() => existing?.status === 'done')
const timeText = computed(() => `${String(Math.floor(remaining.value / 60)).padStart(2, '0')}:${String(remaining.value % 60).padStart(2, '0')}`)

function historyForApi() {
  return messages.value.map((message) => ({
    role: message.role === 'teacher' ? 'teacher' : 'ai',
    text: message.text
  }))
}

function fallbackNext() {
  const answered = messages.value.filter((message) => message.role === 'teacher').length
  const script = scriptQueue[answered]
  if (!script || answered >= 6 || remaining.value < 60) {
    return { question: stopScript(item.item_id), done: true, evidenceHint: [] }
  }
  return { question: script.q, done: false, evidenceHint: script.E || [] }
}

async function requestNext() {
  const process = computeProcess(answer)
  const context = {
    sessionId: session.value.sessionId,
    itemId: item.item_id,
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
    kbSlice: kbSlice(item.item_id)
  }
  const cloudResult = await interviewNext(context)
  const next = cloudResult.ok ? cloudResult : fallbackNext()
  messages.value.push({ role: 'ai', text: next.question, ts: Date.now() })
  if (next.done) {
    done.value = true
    persist(true)
  } else {
    persist(false)
  }
  await nextTick()
  chatEnd.value?.scrollIntoView({ behavior: 'smooth' })
}

async function send() {
  const text = input.value.trim()
  if (!text || sending.value || done.value) return
  messages.value.push({ role: 'teacher', text, ts: Date.now() })
  input.value = ''
  sending.value = true
  persist(false)
  await requestNext()
  sending.value = false
}

function persist(isDone) {
  session.value.interview ||= {}
  session.value.interview[item.item_id] = {
    itemId: item.item_id,
    status: isDone ? 'done' : 'in_progress',
    startedAt: startedAt.value,
    finishedAt: isDone ? Date.now() : null,
    messages: messages.value.slice(),
    teacherRanking: answer.final_ranking
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
    await requestNext()
    sending.value = false
  }
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <section v-if="session && item" class="interview-live">
    <header class="interview-header">
      <button class="icon-button" @click="leave">←</button>
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

    <div v-if="!done && !isReview" class="chat-input">
      <textarea v-model="input" rows="2" maxlength="2000" placeholder="请输入您的回答…" @keydown.ctrl.enter="send"></textarea>
      <button class="button primary" :disabled="!input.trim() || sending" @click="send">发送</button>
    </div>
    <div v-else class="chat-complete">
      <span>本情境访谈已完成</span>
      <button class="button primary" @click="leave">返回情境列表</button>
    </div>
  </section>
</template>
