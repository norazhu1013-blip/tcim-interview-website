<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { QUESTIONS_VERSION } from '../generated/data.js'
import {
  archiveLocalDataForLogout,
  clearAllLocalDataForLogout,
  createSession,
  getProfile,
  saveProfile
} from '../services/storage.js'
import { exportData, reportProfile, whoami } from '../services/api.js'
import { requireWebLogin, signOutWebUser } from '../services/web-auth.js'

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
const isAdmin = ref(false)
const exporting = ref('')
const exportMessage = ref('')
const download = ref(null)
const showLogout = ref(false)
const clearLocalData = ref(false)
const loggingOut = ref(false)
const logoutError = ref('')

onMounted(async () => {
  if (!await requireWebLogin()) return
  // 恢复上一版约定：Nora 保存过资料后，进入“我的”即由后端确认管理员身份。
  if (String(saved.name || '').trim().toLowerCase() === 'nora') await reportProfile(saved)
  const identity = await whoami()
  isAdmin.value = Boolean(identity?.ok && identity.isAdmin)
})

function openLogout() {
  clearLocalData.value = false
  logoutError.value = ''
  showLogout.value = true
}

async function logout() {
  loggingOut.value = true
  logoutError.value = ''
  const result = await signOutWebUser()
  loggingOut.value = false
  if (!result.ok) {
    logoutError.value = '退出失败，请检查网络后重试。'
    return
  }
  if (clearLocalData.value) clearAllLocalDataForLogout()
  else archiveLocalDataForLogout()
  showLogout.value = false
  await router.push('/')
}

async function runExport(format) {
  if (!isAdmin.value || exporting.value) return
  exporting.value = format
  exportMessage.value = format === 'xlsx' ? '正在整理 Excel…' : '正在生成原始数据…'
  download.value = null
  const result = await exportData(format)
  exporting.value = ''
  if (!result?.ok || !result.downloadURL) {
    exportMessage.value = result?.error === 'forbidden'
      ? '当前账号没有管理员导出权限。'
      : `导出失败（${result?.error || '返回结果不完整'}），请稍后重试。`
    return
  }
  const label = result.format === 'json' ? '原始 JSON' : '整理版 Excel'
  download.value = {
    url: result.downloadURL,
    name: `gsyg-web-data-${new Date().toISOString().slice(0, 10)}.${result.format === 'json' ? 'json' : 'xlsx'}`
  }
  exportMessage.value = `${label} 已生成：教师 ${result.count?.teachers || 0} 条，测验 ${result.count?.sessions || 0} 条，访谈 ${result.count?.interviews || 0} 条。浏览器将自动开始下载。`
  triggerDownload()
}

function triggerDownload(file = download.value) {
  if (!file?.url) return
  const link = document.createElement('a')
  link.href = file.url
  link.download = file.name
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

async function submit() {
  if (!form.name.trim() || !form.kindergarten.trim() || !String(form.teachingYears).trim()) {
    message.value = '请填写姓名、园所和教龄。'
    return
  }
  if (!await requireWebLogin()) return
  const profile = saveProfile({ ...form, updatedAt: Date.now() })
  message.value = '资料已保存。'
  await reportProfile(profile)
  const identity = await whoami()
  isAdmin.value = Boolean(identity?.ok && identity.isAdmin)
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

    <section v-if="isAdmin" class="admin-export-card">
      <p class="eyebrow">管理员</p>
      <h2>导出网站研究数据</h2>
      <p>仅导出网站参与者的教师资料、测验与过程记录、情境筛选、访谈逐字稿、编码、任务卡和反馈，不包含小程序数据。</p>
      <div class="admin-export-actions">
        <button class="button primary" type="button" :disabled="Boolean(exporting)" @click="runExport('xlsx')">
          {{ exporting === 'xlsx' ? '正在导出…' : '导出整理版 Excel' }}
        </button>
        <button class="button secondary" type="button" :disabled="Boolean(exporting)" @click="runExport('json')">
          {{ exporting === 'json' ? '正在导出…' : '导出原始 JSON' }}
        </button>
      </div>
      <p v-if="exportMessage" class="admin-export-message">{{ exportMessage }}</p>
      <button v-if="download" class="button text admin-download-link" type="button" @click="triggerDownload()">
        未自动下载？再次下载
      </button>
    </section>

    <section class="account-settings-card">
      <div>
        <p class="eyebrow">账号</p>
        <h2>登录设置</h2>
        <p>退出后可以使用新的账号进入，是否清除本机记录由您自行选择。</p>
      </div>
      <button class="button secondary" type="button" @click="openLogout">退出登录</button>
    </section>

    <div v-if="showLogout" class="modal-backdrop" @click.self="showLogout = false">
      <section class="logout-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-title">
        <h2 id="logout-title">退出登录</h2>
        <p>默认会保留本机历史数据，但退出后不再显示在新账号页面中。</p>
        <label class="logout-clear-option">
          <input v-model="clearLocalData" type="checkbox" />
          <span>
            <strong>同时清除本机个人资料和测评记录</strong>
            <small>仅在您希望将这台设备交给其他人使用时选择。</small>
          </span>
        </label>
        <p v-if="logoutError" class="dialog-error">{{ logoutError }}</p>
        <div class="dialog-actions">
          <button class="button secondary" type="button" :disabled="loggingOut" @click="showLogout = false">取消</button>
          <button class="button primary" type="button" :disabled="loggingOut" @click="logout">
            {{ loggingOut ? '正在退出…' : '确认退出' }}
          </button>
        </div>
      </section>
    </div>
  </section>
</template>
