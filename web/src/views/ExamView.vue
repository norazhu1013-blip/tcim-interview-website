<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ITEMS } from '../generated/data.js'
import { computeScores } from '../core/scoring.js'
import { getProfile, getSession, saveSession } from '../services/storage.js'
import { reportExam } from '../services/api.js'
import { requireWebLogin } from '../services/web-auth.js'

const route = useRoute()
const router = useRouter()
const session = ref(getSession(route.params.sid))
const index = ref(0)
const order = ref(['A', 'B', 'C', 'D'])
const firstOrder = ref(['A', 'B', 'C', 'D'])
const moveLog = ref([])
const questionEnter = ref(Date.now())
const dragIndex = ref(null)
const remaining = ref(20 * 60)
let timer = null

const examItems = computed(() => session.value?.studyMode === 'single_trial'
  ? ITEMS.filter((entry) => entry.item_id === session.value.targetItemId)
  : ITEMS)
const item = computed(() => examItems.value[index.value])
const progress = computed(() => ((index.value + 1) / examItems.value.length) * 100)
const timeText = computed(() => `${String(Math.floor(remaining.value / 60)).padStart(2, '0')}:${String(remaining.value % 60).padStart(2, '0')}`)

function loadQuestion(nextIndex) {
  index.value = nextIndex
  const answer = session.value?.answers?.[examItems.value[nextIndex].item_id]
  order.value = answer?.final_ranking?.slice() || ['A', 'B', 'C', 'D']
  firstOrder.value = answer?.first_ranking?.slice() || order.value.slice()
  moveLog.value = answer?.move_log?.slice() || []
  questionEnter.value = answer?.enter_ts || Date.now()
}

function move(from, to) {
  if (from === to || from == null || to < 0 || to >= order.value.length) return
  const next = order.value.slice()
  const [letter] = next.splice(from, 1)
  next.splice(to, 0, letter)
  order.value = next
  moveLog.value.push({ option: letter, from_pos: from + 1, to_pos: to + 1, ts: Date.now() })
}

function persist() {
  if (!session.value) return
  const now = Date.now()
  session.value.answers[item.value.item_id] = {
    first_ranking: firstOrder.value.slice(),
    // 页面打开时的 A/B/C/D 是系统展示顺序，不代表教师已经作出的选择。
    first_ranking_source: 'system_default',
    final_ranking: order.value.slice(),
    move_log: moveLog.value.slice(),
    enter_ts: questionEnter.value,
    submit_ts: now,
    duration_ms: Math.max(0, now - questionEnter.value)
  }
  session.value = saveSession(session.value)
}

function navigate(delta) {
  persist()
  loadQuestion(index.value + delta)
}

async function submit(timeout = false) {
  persist()
  const itemIds = examItems.value.map((entry) => entry.item_id)
  for (const entry of examItems.value) {
    if (!session.value.answers[entry.item_id]) {
      session.value.answers[entry.item_id] = {
        first_ranking: ['A', 'B', 'C', 'D'],
        first_ranking_source: 'system_default',
        final_ranking: ['A', 'B', 'C', 'D'],
        move_log: [],
        enter_ts: Date.now(),
        submit_ts: Date.now(),
        duration_ms: 0
      }
    }
  }
  session.value.scores = computeScores(session.value.answers, itemIds)
  session.value.status = 'submitted'
  session.value.submitStatus = timeout ? 'timeout_auto_submit' : 'submitted'
  session.value.examSubmitTs = Date.now()
  session.value.totalExamMs = session.value.examSubmitTs - session.value.examStartTs
  session.value = saveSession(session.value)
  let reportResult = await reportExam(session.value, getProfile())
  // 新注册账号完成 CloudBase 登录后，网关的 HttpOnly 会话偶尔尚未建立或已失效。
  // 只在明确的身份错误时重新同步一次登录态并重试，避免重复写入其他失败请求。
  if (session.value.studyMode === 'single_trial' && ['not_authenticated', 'cloudbase_token_invalid'].includes(reportResult?.error)) {
    if (await requireWebLogin()) reportResult = await reportExam(session.value, getProfile())
  }
  if (session.value.studyMode === 'single_trial' && !reportResult?.ok) {
    const reason = reportResult?.error ? `（${reportResult.error}）` : ''
    alert(`单题作答已保存在本机，但暂时未能上传${reason}。请稍后重新提交。`)
    session.value.status = 'in_progress'
    session.value = saveSession(session.value)
    return
  }
  router.replace(`/score/${session.value.sessionId}?submitted=1`)
}

onMounted(() => {
  if (!session.value || session.value.status !== 'in_progress') {
    router.replace('/')
    return
  }
  if (!session.value.examStartTs) {
    session.value.examStartTs = Date.now()
    session.value = saveSession(session.value)
  }
  if (!examItems.value.length) {
    router.replace('/')
    return
  }
  const firstUnanswered = examItems.value.findIndex((entry) => !session.value.answers[entry.item_id])
  loadQuestion(firstUnanswered >= 0 ? firstUnanswered : 0)
  const elapsed = Math.floor((Date.now() - session.value.examStartTs) / 1000)
  remaining.value = Math.max(0, 20 * 60 - elapsed)
  timer = setInterval(() => {
    remaining.value = Math.max(0, remaining.value - 1)
    if (remaining.value === 0) submit(true)
  }, 1000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <section v-if="session" class="exam-page">
    <div class="exam-bar">
      <button class="icon-button" aria-label="退出" @click="persist(); router.push('/')">×</button>
      <div class="progress-track"><span :style="{ width: `${progress}%` }"></span></div>
      <strong :class="{ urgent: remaining < 60 }">{{ timeText }}</strong>
    </div>

    <article class="question-card">
      <div class="question-meta">
        <span>情境 {{ index + 1 }} / {{ examItems.length }}</span>
        <strong>{{ item.title }}</strong>
      </div>
      <img class="scenario-image" :src="`./scenarios/${item.item_id}.jpg`" :alt="item.title" />
      <p class="scenario-stem">{{ item.stem }}</p>
    </article>

    <section class="ranking-panel">
      <div class="ranking-title">
        <div><h2>请按适宜程度排序</h2><p>从最适宜到最不适宜，可拖动或使用上下按钮调整。</p></div>
        <span>最适宜 → 最不适宜</span>
      </div>
      <ol class="ranking-list">
        <li v-for="(letter, pos) in order" :key="letter"
          draggable="true"
          @dragstart="dragIndex = pos"
          @dragover.prevent
          @drop="move(dragIndex, pos); dragIndex = null">
          <span class="rank-number">{{ pos + 1 }}</span>
          <span class="option-letter">{{ letter }}</span>
          <p>{{ item.options[letter] }}</p>
          <div class="move-buttons">
            <button :disabled="pos === 0" aria-label="上移" @click="move(pos, pos - 1)">↑</button>
            <button :disabled="pos === order.length - 1" aria-label="下移" @click="move(pos, pos + 1)">↓</button>
          </div>
        </li>
      </ol>
    </section>

    <div class="exam-actions">
      <button class="button secondary" :disabled="index === 0" @click="navigate(-1)">上一题</button>
      <button v-if="index < examItems.length - 1" class="button primary" @click="navigate(1)">下一题</button>
      <button v-else class="button primary" @click="submit(false)">提交答卷</button>
    </div>
  </section>
</template>
