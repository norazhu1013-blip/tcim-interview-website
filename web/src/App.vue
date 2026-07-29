<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  beginWeChatLogin,
  completeWeChatLoginFromCallback,
  getWebLoginState,
  signOutWebUser,
  webAuthConfigured
} from './services/web-auth.js'

const route = useRoute()
const showTabs = computed(() => route.path === '/' || route.path === '/profile')
const authState = ref('checking')
const authError = ref('')

async function refreshLoginState() {
  const session = await getWebLoginState()
  authState.value = session.ok ? 'signed_in' : 'signed_out'
  return session
}

async function login() {
  authError.value = ''
  try {
    await beginWeChatLogin(window.location.hash || '#/')
  } catch (error) {
    authError.value = error?.message === 'cloudbase_auth_not_configured'
      ? '网页登录尚未配置，请联系管理员。'
      : '暂时无法打开微信扫码登录，请稍后重试。'
  }
}

async function logout() {
  await signOutWebUser()
  authState.value = 'signed_out'
}

onMounted(async () => {
  const callback = await completeWeChatLoginFromCallback()
  if (callback.handled) {
    if (callback.ok) {
      authState.value = 'signed_in'
      if (callback.returnTo) window.location.replace(callback.returnTo)
      return
    }
    authError.value = callback.error === 'wechat_first_login_binding_required'
      ? '这是首次扫码登录。请联系管理员开启首次账号绑定后再试。'
      : '微信扫码登录未完成，请重新扫码。'
  }
  await refreshLoginState()
})
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
        <button v-if="authState === 'signed_in'" class="button text auth-button" type="button" @click="logout">退出登录</button>
        <button v-else class="button secondary auth-button" type="button" :disabled="authState === 'checking' || !webAuthConfigured()" @click="login">
          {{ authState === 'checking' ? '正在检查登录' : '微信扫码登录' }}
        </button>
      </div>
    </header>

    <p v-if="authError" class="auth-notice">{{ authError }}</p>

    <main class="page-shell">
      <router-view />
    </main>

    <nav v-if="showTabs" class="bottom-tabs" aria-label="主导航">
      <router-link to="/" exact-active-class="active">答题</router-link>
      <router-link to="/profile" active-class="active">我的</router-link>
    </nav>
  </div>
</template>
