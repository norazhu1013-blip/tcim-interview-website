<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getSession, saveSession } from '../services/storage.js'
import { reportInterview } from '../services/api.js'

const route = useRoute()
const router = useRouter()
const session = ref(getSession(route.params.sid))
const retrying = ref(false)
const retryError = ref('')

function receiptOk() {
  const r = session.value?.reportReceipt
  return Boolean(r && r.serverRecordId && r.serverUpdatedAt && r.payloadHash)
}

async function retry() {
  if (!session.value || retrying.value) return
  retrying.value = true
  retryError.value = ''
  try {
    session.value.reportRevision = (session.value.reportRevision || 0) + 1
    const res = await reportInterview(session.value)
    if (res && res.ok && res.serverRecordId) {
      session.value.reportReceipt = { serverRecordId: res.serverRecordId, serverUpdatedAt: res.serverUpdatedAt, payloadHash: res.payloadHash }
      session.value.reportError = ''
    } else {
      session.value.reportError = (res && res.error) || 'report_failed'
      retryError.value = session.value.reportError
    }
  } catch (e) {
    session.value.reportError = e?.message || 'report_failed'
    retryError.value = session.value.reportError
  }
  session.value = saveSession(session.value)
  retrying.value = false
}
</script>

<template>
  <section v-if="session" class="page narrow-page done-page">
    <div class="done-mark">✓</div>
    <p class="eyebrow">访谈完成</p>
    <h1>感谢您的认真分享</h1>
    <p>{{ session.studyMode === 'single_trial' ? '本次单题作答与深度访谈均已完成，您可以返回首页回看记录。' : '本次测评与三个情境访谈均已完成，您可以返回首页回看答题和访谈记录。' }}</p>
    <p v-if="receiptOk()" class="save-state saved">✓ 云端已保存</p>
    <p v-else class="save-state pending">待同步：{{ session.reportError || '尚未确认云端保存' }}</p>
    <button v-if="!receiptOk()" class="button primary retry" :disabled="retrying" @click="retry">{{ retrying ? '重试中…' : '重试保存' }}</button>
    <button class="button primary" @click="router.push('/')">返回首页</button>
  </section>
</template>

<style scoped>
.save-state {
  margin-top: 8rpx;
  font-size: 14px;
}
.save-state.saved { color: #067647; }
.save-state.pending { color: #b42318; }
button.retry { margin-top: 12rpx; }
</style>
