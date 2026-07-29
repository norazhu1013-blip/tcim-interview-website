<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ITEMS } from '../generated/data.js'
import { getSession, saveSession } from '../services/storage.js'
import { selectFinal } from '../services/api.js'

const route = useRoute()
const router = useRouter()
let session = getSession(route.params.sid)
const loading = computed(() => false)

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
      <p class="eyebrow">确定性查表结果</p>
      <h1>本次测评评分</h1>
      <p>评分仅来自既定赋分表与算术计算，AI 不参与评分。</p>
    </div>
    <div class="score-hero">
      <span>总分</span>
      <strong>{{ session.scores?.total }}</strong>
      <small>/ {{ ITEMS.length * 4 }}</small>
      <p>{{ session.scores?.level }}</p>
    </div>
    <div class="score-list">
      <div v-for="(item, i) in ITEMS" :key="item.item_id">
        <span>{{ i + 1 }}. {{ item.title }}</span>
        <strong>{{ session.scores?.perItem?.[item.item_id] ?? '-' }} 分</strong>
      </div>
    </div>
    <div class="stack-actions">
      <button class="button primary wide" :disabled="loading" @click="goInterview">去 AI 访谈</button>
      <button class="button secondary wide" @click="router.push(`/review/${session.sessionId}`)">查看答题排序</button>
      <button class="button text wide" @click="router.push('/')">返回首页</button>
    </div>
  </section>
</template>
