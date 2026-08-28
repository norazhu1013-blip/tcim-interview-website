<script setup>
import { computed, ref, onActivated, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ITEMS, QUESTIONS_VERSION } from '../generated/data.js'
import { createSession, deleteSession, formatDate, getProfile, isProfileComplete, listSessions } from '../services/storage.js'
import { requireWebLogin } from '../services/web-auth.js'

const router = useRouter()
const records = ref([])
const profile = ref(null)

function refresh() {
  profile.value = getProfile()
  // 临时单题试访已下线；历史数据仍保留在本地和后端，仅不再作为教师端模块展示。
  records.value = listSessions().filter((session) => session.studyMode !== 'single_trial')
}
onMounted(refresh)
onActivated(refresh)

const blockStart = computed(() => records.value.some((session) => {
  if (session.status === 'in_progress') return false
  const planned = session.selection?.final?.length || 3
  const done = Object.values(session.interview || {}).filter((item) => item?.status === 'done').length
  return done < planned
}))

async function start() {
  if (!isProfileComplete(profile.value)) {
    router.push('/profile?next=start')
    return
  }
  if (blockStart.value) return
  if (!await requireWebLogin()) return
  const session = createSession(QUESTIONS_VERSION)
  router.push(`/exam/${session.sessionId}`)
}

function remove(session) {
  if (session.status !== 'in_progress') return
  if (confirm('确定删除这条未完成的答题记录？')) {
    deleteSession(session.sessionId)
    refresh()
  }
}

function interviewProgress(session) {
  const planned = session.selection?.final?.length || 3
  const done = Object.values(session.interview || {}).filter((item) => item?.status === 'done').length
  return `${done}/${planned}`
}
</script>

<template>
  <section class="page home-page">
    <div class="hero">
      <div>
        <p class="eyebrow">幼儿园教师专业能力发展</p>
        <h1>{{ profile?.name ? `${profile.name}老师，您好` : '游戏支持与引导能力测评' }}</h1>
        <p>通过 10 个真实教育情境，记录您的专业判断过程，并围绕三个情境开展 AI 证据访谈。</p>
        <button class="button primary" :disabled="blockStart" @click="start">
          {{ blockStart ? '请先完成尚未结束的 AI 访谈' : `开始测评 · ${ITEMS.length} 题` }}
        </button>
      </div>
      <div class="hero-visual" aria-hidden="true">
        <span>20</span><small>分钟</small>
      </div>
    </div>
    <div class="section-heading">
      <div>
        <p class="eyebrow">历史记录</p>
        <h2>历次答题</h2>
      </div>
      <span>{{ records.length }} 次</span>
    </div>

    <div v-if="!records.length" class="empty-card">
      <strong>还没有测评记录</strong>
      <p>完成个人资料后即可开始第一次测评。</p>
    </div>

    <div v-else class="record-grid">
      <article v-for="session in records" :key="session.sessionId" class="record-card">
        <div class="record-top">
          <span class="status" :class="{ complete: session.status !== 'in_progress' }">
            {{ session.status === 'in_progress' ? '未完成' : `访谈 ${interviewProgress(session)}` }}
          </span>
          <time>{{ formatDate(session.createdAt) }}</time>
        </div>
        <h3>{{ session.status === 'in_progress' ? '情境判断测验' : '测评与访谈记录' }}</h3>
        <p v-if="session.status === 'in_progress'">
          已完成 {{ Object.keys(session.answers || {}).length }}/{{ ITEMS.length }} 题
        </p>
        <p v-else>{{ ITEMS.length }} 题 · 已提交</p>
        <div class="actions">
          <template v-if="session.status === 'in_progress'">
            <button class="button secondary" @click="router.push(`/exam/${session.sessionId}`)">继续答题</button>
            <button class="button text danger" @click="remove(session)">删除</button>
          </template>
          <template v-else>
            <button class="button text" @click="router.push(`/review/${session.sessionId}`)">看答题</button>
            <button class="button secondary" @click="router.push(`/interviews/${session.sessionId}`)">
              {{ session.selection?.final?.length && interviewProgress(session) === `${session.selection.final.length}/${session.selection.final.length}` ? '回看访谈' : '去访谈' }}
            </button>
          </template>
        </div>
      </article>
    </div>
  </section>
</template>
