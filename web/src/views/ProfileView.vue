<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { QUESTIONS_VERSION } from '../generated/data.js'
import { createSession, getProfile, saveProfile } from '../services/storage.js'
import { reportProfile } from '../services/api.js'
import { requireWebLogin } from '../services/web-auth.js'

const route = useRoute()
const router = useRouter()
const saved = getProfile() || {}
const form = reactive({
  name: saved.name || '',
  kindergarten: saved.kindergarten || '',
  className: saved.className || '',
  teachingYears: saved.teachingYears || '',
  paperCode: saved.paperCode || ''
})
const message = ref('')

async function submit() {
  if (!form.name.trim() || !form.kindergarten.trim() || !String(form.teachingYears).trim()) {
    message.value = '请填写姓名、园所和教龄。'
    return
  }
  if (!await requireWebLogin(window.location.hash || '#/profile')) return
  const profile = saveProfile({ ...form, updatedAt: Date.now() })
  message.value = '资料已保存。'
  reportProfile(profile)
  if (route.query.next === 'start') {
    const session = createSession(QUESTIONS_VERSION)
    router.replace(`/exam/${session.sessionId}`)
  }
}
</script>

<template>
  <section class="page narrow-page">
    <div class="page-title">
      <p class="eyebrow">个人资料</p>
      <h1>我的</h1>
      <p>信息将用于绑定您的测评、访谈记录及后续研究分析。</p>
    </div>
    <form class="form-card" @submit.prevent="submit">
      <label>姓名<span>*</span><input v-model="form.name" autocomplete="name" placeholder="请输入真实姓名" /></label>
      <label>园所<span>*</span><input v-model="form.kindergarten" placeholder="请输入幼儿园名称" /></label>
      <div class="form-row">
        <label>班级<input v-model="form.className" placeholder="如：中一班" /></label>
        <label>教龄<span>*</span><input v-model="form.teachingYears" inputmode="decimal" placeholder="如：5年" /></label>
      </div>
      <label>试卷码<input v-model="form.paperCode" placeholder="如有请填写" /></label>
      <p v-if="message" class="form-message">{{ message }}</p>
      <button class="button primary wide" type="submit">保存资料</button>
    </form>
  </section>
</template>
