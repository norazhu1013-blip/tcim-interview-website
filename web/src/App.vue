<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ensureWebLogin } from './services/web-auth.js'

const route = useRoute()
const showTabs = computed(() => route.path === '/' || route.path === '/profile')
const authState = ref('checking')
const authError = ref('')

async function login() {
  authState.value = 'checking'
  authError.value = ''
  const session = await ensureWebLogin()
  if (session.ok) {
    authState.value = 'signed_in'
    return
  }
  authState.value = 'error'
  authError.value = '暂时无法登录，请稍后重试。'
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
  authState.value = 'error'
  authError.value = session.error === 'cloudbase_auth_not_configured'
    ? '网页登录尚未配置，请联系管理员。'
    : '暂时无法确认登录状态，请刷新页面后重试。'
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
        <button
          v-else-if="authState === 'signed_out' || authState === 'error'"
          class="button text auth-button"
          type="button"
          @click="login"
        >重新登录</button>
        <span v-else class="auth-status">正在确认登录…</span>
      </div>
    </header>

    <p v-if="authError" class="auth-notice">{{ authError }}</p>

    <main class="page-shell">
      <section v-if="authState === 'signed_out'" class="signed-out-page">
        <p class="eyebrow">已退出登录</p>
        <h1>欢迎使用游戏支持与引导能力测评</h1>
        <p>当前没有登录账号。重新登录后可填写新的个人资料并开始测评。</p>
        <button class="button primary" type="button" @click="login">重新登录</button>
      </section>
      <router-view v-else-if="authState === 'signed_in'" />
      <section v-else-if="authState === 'checking'" class="signed-out-page">
        <p>正在确认登录…</p>
      </section>
    </main>

    <nav v-if="showTabs && authState === 'signed_in'" class="bottom-tabs" aria-label="主导航">
      <router-link to="/" exact-active-class="active">答题</router-link>
      <router-link to="/profile" active-class="active">我的</router-link>
    </nav>
  </div>
</template>
