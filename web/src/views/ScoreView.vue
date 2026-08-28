<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getSession, saveSession } from '../services/storage.js'
import { selectFinal } from '../services/api.js'

const route = useRoute()
const router = useRouter()
let session = getSession(route.params.sid)
const loading = computed(() => false)
const isSingleTrial = computed(() => session?.studyMode === 'single_trial')

async function goInterview() {
  if (!session.selection?.final?.length) {
    const result = await selectFinal(session.sessionId)
    if (!result.ok) {
      alert('暂时无法生成访谈情境，请确认网页版 CloudBase 登录与云函数权限已配置后重试。')
      return
    }
    session.selection = result.selection
    session = saveSession(session)
  }
  router.push(`/interviews/${session.sessionId}`)
}
</script>

<template>
  <section v-if="session" class="page narrow-page">
    <div class="page-title center">
      <p class="eyebrow">提交成功</p>
      <h1>{{ isSingleTrial ? '单题作答已完成' : '本次测评已完成' }}</h1>
      <p>您的答题记录已保存，可以继续进行 AI 访谈。</p>
    </div>
    <div class="empty-card">
      <strong>答题已提交</strong>
      <p>{{ isSingleTrial ? '接下来将直接围绕“未参与小组建构”开展访谈。' : '接下来将围绕三个情境开展访谈。' }}</p>
    </div>
    <div class="stack-actions">
      <button class="button primary wide" :disabled="loading" @click="goInterview">去 AI 访谈</button>
      <button class="button secondary wide" @click="router.push(`/report/${session.sessionId}`)">查看能力画像报告</button>
      <button class="button secondary wide" @click="router.push(`/review/${session.sessionId}`)">查看答题排序</button>
      <button class="button text wide" @click="router.push('/')">返回首页</button>
    </div>
  </section>
</template>
