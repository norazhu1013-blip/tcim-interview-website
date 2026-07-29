<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ITEMS } from '../generated/data.js'
import { computeScores } from '../core/scoring.js'
import { getProfile, getSession, saveSession } from '../services/storage.js'
import { reportExam } from '../services/api.js'

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

const item = computed(() => ITEMS[index.value])
const progress = computed(() => ((index.value + 1) / ITEMS.length) * 100)
const timeText = computed(() => `${String(Math.floor(remaining.value / 60)).padStart(2, '0')}:${String(remaining.value % 60).padStart(2, '0')}`)

function loadQuestion(nextIndex) {
  index.value = nextIndex
  const answer = session.value?.answers?.[ITEMS[nextIndex].item_id]
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
  const itemIds = ITEMS.map((entry) => entry.item_id)
  for (const entry of ITEMS) {
    if (!session.value.answers[entry.item_id]) {
      session.value.answers[entry.item_id] = {
        first_ranking: ['A', 'B', 'C', 'D'],
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
  reportExam(session.value, getProfile())
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
  const firstUnanswered = ITEMS.findIndex((entry) => !session.value.answers[entry.item_id])
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
        <span>情境 {{ index + 1 }} / {{ ITEMS.length }}</span>
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
      <button v-if="index < ITEMS.length - 1" class="button primary" @click="navigate(1)">下一题</button>
      <button v-else class="button primary" @click="submit(false)">提交答卷</button>
    </div>
  </section>
</template>
