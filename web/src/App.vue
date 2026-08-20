<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  beginWebRegistration,
  completeWebRegistration,
  ensureWebLogin,
  signInWebUser
} from './services/web-auth.js'

const route = useRoute()
const showTabs = computed(() => route.path === '/' || route.path === '/profile')
const authState = ref('checking')
const authError = ref('')
const account = ref('')
const password = ref('')
const authMode = ref('login')
const registrationStep = ref('form')
const registrationAccount = ref('')
const registrationEmail = ref('')
const registrationPassword = ref('')
const registrationPasswordAgain = ref('')
const verificationCode = ref('')
const verificationTarget = ref('')

const errorMessages = {
  account_and_password_required: '请输入账号和密码。',
  invalid_account_or_password: '账号或密码不正确。',
  cloudbase_auth_not_configured: '账号登录尚未配置，请联系管理员。',
  cloudbase_token_invalid: '该登录身份不是有效的正式账号，请联系管理员。',
  account_login_failed: '登录失败，请稍后重试。',
  invalid_registration_username: '账号需为 5–24 位，以字母或数字开头，可使用英文、数字和 . _ : + @ -。',
  invalid_registration_email: '请输入有效的邮箱地址。',
  weak_registration_password: '密码至少 8 位，并同时包含字母和数字。',
  registration_account_exists: '该账号或邮箱已注册，请直接登录。',
  registration_send_failed: '验证码发送失败，请稍后重试。',
  registration_expired: '本次注册已失效，请重新注册。',
  invalid_verification_code: '验证码不正确或已过期。'
}

async function login() {
  authState.value = 'checking'
  authError.value = ''
  const session = await signInWebUser(account.value, password.value)
  password.value = ''
  if (session.ok) {
    authState.value = 'signed_in'
    return
  }
  authState.value = 'signed_out'
  authError.value = errorMessages[session.error] || '暂时无法登录，请稍后重试。'
}

function switchAuthMode(mode) {
  authMode.value = mode
  authError.value = ''
  if (mode === 'register') registrationStep.value = 'form'
}

async function beginRegistration() {
  authError.value = ''
  if (registrationPassword.value !== registrationPasswordAgain.value) {
    authError.value = '两次输入的密码不一致。'
    return
  }
  authState.value = 'checking'
  const result = await beginWebRegistration({
    username: registrationAccount.value,
    email: registrationEmail.value,
    password: registrationPassword.value
  })
  registrationPassword.value = ''
  registrationPasswordAgain.value = ''
  authState.value = 'signed_out'
  if (!result.ok) {
    authError.value = errorMessages[result.error] || '暂时无法注册，请稍后重试。'
    return
  }
  verificationTarget.value = result.email
  registrationStep.value = 'verify'
}

async function completeRegistration() {
  authState.value = 'checking'
  authError.value = ''
  const result = await completeWebRegistration(verificationCode.value)
  if (result.ok) {
    authState.value = 'signed_in'
    return
  }
  authState.value = 'signed_out'
  authError.value = errorMessages[result.error] || '暂时无法完成注册，请稍后重试。'
}

function submitAuthForm() {
  if (authMode.value === 'login') return login()
  return registrationStep.value === 'form' ? beginRegistration() : completeRegistration()
}

function handleAuthChange(event) {
  if (event.detail?.state) authState.value = event.detail.state
}

onMounted(async () => {
  window.addEventListener('gsyg:web-auth-changed', handleAuthChange)
  const session = await ensureWebLogin()
  if (session.ok) {
    authState.value = 'signed_in'
    return
  }
  authState.value = 'signed_out'
  if (session.error === 'cloudbase_auth_not_configured') authError.value = errorMessages.cloudbase_auth_not_configured
})

onBeforeUnmount(() => window.removeEventListener('gsyg:web-auth-changed', handleAuthChange))
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <router-link to="/" class="brand">
        <span class="brand-mark">幼</span>
        <span>
          <strong>幼研智库</strong>
          <small>游戏支持与引导能力测评</small>
        </span>
      </router-link>
      <div class="web-auth">
        <router-link
          v-if="authState === 'signed_in'"
          to="/profile"
          class="button text auth-button desktop-profile-link"
          active-class="active"
        >我的</router-link>
        <span v-else-if="authState === 'checking'" class="auth-status">正在确认登录…</span>
      </div>
    </header>

    <main class="page-shell">
      <section v-if="authState === 'signed_out'" class="account-login-page">
        <form class="account-login-card" @submit.prevent="submitAuthForm">
          <div class="auth-mode-tabs" role="tablist" aria-label="账号操作">
            <button type="button" :class="{ active: authMode === 'login' }" @click="switchAuthMode('login')">登录</button>
            <button type="button" :class="{ active: authMode === 'register' }" @click="switchAuthMode('register')">注册</button>
          </div>
          <h1>欢迎使用游戏支持与引导能力测评</h1>
          <template v-if="authMode === 'login'">
            <p class="login-intro">请输入账号和密码登录。</p>
            <label>
              <span>账号</span>
              <input v-model.trim="account" name="username" autocomplete="username" inputmode="text" required placeholder="请输入账号或邮箱">
            </label>
            <label>
              <span>密码</span>
              <input v-model="password" name="password" type="password" autocomplete="current-password" required placeholder="请输入密码">
            </label>
            <p v-if="authError" class="login-error" role="alert">{{ authError }}</p>
            <button class="button primary wide" type="submit">登录</button>
            <button class="button secondary wide register-cta" type="button" @click="switchAuthMode('register')">首次使用？立即注册</button>
          </template>

          <template v-else-if="registrationStep === 'form'">
            <p class="login-intro">填写信息后，验证码将发送到你的邮箱。</p>
            <label>
              <span>账号</span>
              <input v-model.trim="registrationAccount" autocomplete="username" required minlength="5" maxlength="24" placeholder="设置 5–24 位账号">
            </label>
            <label>
              <span>邮箱</span>
              <input v-model.trim="registrationEmail" type="email" autocomplete="email" required placeholder="用于接收验证码">
            </label>
            <label>
              <span>密码</span>
              <input v-model="registrationPassword" type="password" autocomplete="new-password" required minlength="8" placeholder="至少 8 位，包含字母和数字">
            </label>
            <label>
              <span>确认密码</span>
              <input v-model="registrationPasswordAgain" type="password" autocomplete="new-password" required minlength="8" placeholder="再次输入密码">
            </label>
            <p v-if="authError" class="login-error" role="alert">{{ authError }}</p>
            <button class="button primary wide" type="submit">获取验证码</button>
          </template>

          <template v-else>
            <p class="login-intro">验证码已发送至 {{ verificationTarget }}，请输入邮件中的验证码完成注册。</p>
            <label>
              <span>邮箱验证码</span>
              <input v-model.trim="verificationCode" inputmode="numeric" autocomplete="one-time-code" required placeholder="请输入验证码">
            </label>
            <p v-if="authError" class="login-error" role="alert">{{ authError }}</p>
            <button class="button primary wide" type="submit">完成注册并登录</button>
            <button class="button text wide" type="button" @click="registrationStep = 'form'; authError = ''">返回修改注册信息</button>
          </template>
        </form>
      </section>
      <router-view v-else-if="authState === 'signed_in'" />
      <section v-else class="signed-out-page">
        <p>正在确认登录…</p>
      </section>
    </main>

    <nav v-if="showTabs && authState === 'signed_in'" class="bottom-tabs" aria-label="主导航">
      <router-link to="/" exact-active-class="active">答题</router-link>
      <router-link to="/profile" active-class="active">我的</router-link>
    </nav>
  </div>
</template>
