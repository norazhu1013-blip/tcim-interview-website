<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ITEMS } from '../generated/data.js'
import { getSession, saveSession } from '../services/storage.js'
import { selectFinal } from '../services/api.js'

const route = useRoute()
const router = useRouter()
const session = ref(getSession(route.params.sid))
const loading = ref(false)
const error = ref('')
const itemById = Object.fromEntries(ITEMS.map((item) => [item.item_id, item]))

const selected = computed(() => session.value?.selection?.final || [])
const doneCount = computed(() => selected.value.filter((item) => session.value?.interview?.[item.id]?.status === 'done').length)
const plannedCount = computed(() => selected.value.length)
const allDone = computed(() => plannedCount.value > 0 && doneCount.value === plannedCount.value)
const isSingleTrial = computed(() => session.value?.studyMode === 'single_trial')

async function loadSelection() {
  loading.value = true
  error.value = ''
  const result = await selectFinal(session.value.sessionId)
  loading.value = false
  if (!result.ok) {
    error.value = '访谈情境生成失败。请确认 CloudBase Web 登录和云函数调用权限已开启。'
    return
  }
  session.value.selection = result.selection
  session.value = saveSession(session.value)
}

function open(item) {
  router.push(`/interview/${session.value.sessionId}/${item.id}`)
}
</script>

<template>
  <section v-if="session" class="page">
    <div class="page-title">
      <button class="back-link" @click="router.push('/')">← 返回首页</button>
      <p class="eyebrow">幼教慧谈</p>
      <h1>{{ isSingleTrial ? '单题 AI 深度访谈' : 'AI 访谈情境' }}</h1>
      <p>{{ isSingleTrial ? '本次将围绕“未参与小组建构”及您的真实排序开展深度访谈。访谈内容由 AI 生成，仅供专业反思与研究参考。' : '系统会结合本次排序与过程记录遴选三个情境。访谈内容由 AI 生成，仅供专业反思与研究参考。' }}</p>
    </div>

    <div v-if="!selected.length" class="empty-card">
      <strong>尚未生成访谈情境</strong>
      <p>{{ error || '需要联网调用确定性遴选服务，AI 不参与筛题。' }}</p>
      <button class="button primary" :disabled="loading" @click="loadSelection">{{ loading ? '正在生成…' : '生成访谈情境' }}</button>
    </div>

    <div v-else class="interview-grid">
      <article v-for="(selectedItem, i) in selected" :key="selectedItem.id" class="interview-card">
        <img :src="`./scenarios/${selectedItem.id}.jpg`" :alt="itemById[selectedItem.id]?.title" />
        <div>
          <span class="status" :class="{ complete: session.interview?.[selectedItem.id]?.status === 'done' }">
            {{ session.interview?.[selectedItem.id]?.status === 'done' ? '已完成' : '待访谈' }}
          </span>
          <p class="eyebrow">情境 {{ i + 1 }}</p>
          <h2>{{ itemById[selectedItem.id]?.title }}</h2>
          <p>{{ selectedItem.interview_focus || '围绕您的真实排序了解判断依据与教育考虑。' }}</p>
          <button class="button secondary" @click="open(selectedItem)">
            {{ session.interview?.[selectedItem.id]?.status === 'done' ? '回看访谈' : '开始访谈' }}
          </button>
        </div>
      </article>
    </div>

    <div v-if="selected.length" class="completion-strip">
      <div><strong>{{ doneCount }}/{{ plannedCount }}</strong><span>已完成情境</span></div>
      <button v-if="allDone && !session.interviewFeedback" class="button primary" @click="router.push(`/feedback/${session.sessionId}`)">填写访谈反馈</button>
      <button v-else-if="allDone" class="button primary" @click="router.push(`/done/${session.sessionId}`)">完成</button>
    </div>
  </section>
</template>
