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

function submit() {
  session.value.interviewFeedback = { ...form, submittedAt: Date.now() }
  session.value = saveSession(session.value)
  reportInterview(session.value)
  router.replace(`/done/${session.value.sessionId}`)
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
      <button class="button primary wide" type="submit">提交反馈</button>
    </form>
  </section>
</template>
