<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getSession, saveSession } from '../services/storage.js'
import { reportInterview } from '../services/api.js'

const route = useRoute()
const router = useRouter()
const session = ref(getSession(route.params.sid))
const form = reactive({
  q1: session.value?.interviewFeedback?.q1 || '',
  q2: session.value?.interviewFeedback?.q2 || '',
  q3: session.value?.interviewFeedback?.q3 || ''
})
const submitting = ref(false)
const submitError = ref('')

async function submit() {
  if (submitting.value) return
  submitting.value = true
  submitError.value = ''
  session.value.interviewFeedback = { ...form, submittedAt: Date.now() }
  session.value = saveSession(session.value)
  let err = ''
  try {
    const res = await reportInterview(session.value)
    if (res && res.ok && res.serverRecordId) {
      session.value.reportReceipt = { serverRecordId: res.serverRecordId, serverUpdatedAt: res.serverUpdatedAt, payloadHash: res.payloadHash }
      session.value.reportError = ''
    } else {
      err = (res && res.error) || 'report_failed'
      session.value.reportError = err
    }
  } catch (e) {
    err = e?.message || 'report_failed'
    session.value.reportError = err
  }
  session.value = saveSession(session.value)
  submitting.value = false
  if (!err) router.replace(`/done/${session.value.sessionId}`)
}
</script>

<template>
  <section v-if="session" class="page narrow-page">
    <div class="page-title">
      <p class="eyebrow">访谈反馈</p>
      <h1>感谢您的参与</h1>
      <p>以下问题均可留空，您的感受会帮助我们持续改进 AI 访谈体验。</p>
    </div>
    <form class="form-card" @submit.prevent="submit">
      <label>1. 您对此次 AI 访谈的整体感受如何？<textarea v-model="form.q1" rows="4"></textarea></label>
      <label>2. 哪些问题或交流内容给您留下了较深印象？<textarea v-model="form.q2" rows="4"></textarea></label>
      <label>3. 您觉得哪些地方还可以进一步改进？<textarea v-model="form.q3" rows="4"></textarea></label>
      <p v-if="submitError" class="submit-error">提交未成功：{{ submitError }}。您的数据仍保存在本机，请检查网络后重试，不会重复建档。</p>
      <button class="button primary wide" type="submit" :disabled="submitting">{{ submitting ? '提交中…' : '提交反馈' }}</button>
    </form>
  </section>
</template>

<style scoped>
.submit-error {
  margin-top: 12rpx;
  padding: 12rpx 16rpx;
  background: #fdecea;
  color: #b42318;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.5;
}
</style>
