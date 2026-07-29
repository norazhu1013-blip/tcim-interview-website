<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ensureWebLogin, signOutWebUser } from './services/web-auth.js'

const route = useRoute()
const showTabs = computed(() => route.path === '/' || route.path === '/profile')
const authState = ref('checking')
const authError = ref('')

async function logout() {
  await signOutWebUser()
  // 退出后按产品要求立即回到 CloudBase 默认登录页，而不是显示手动登录按钮。
  await ensureWebLogin()
}

onMounted(async () => {
  const session = await ensureWebLogin()
  if (session.ok) {
    authState.value = 'signed_in'
    return
  }
  if (session.redirecting) {
    authState.value = 'redirecting'
    return
  }
  authState.value = 'error'
  authError.value = session.error === 'cloudbase_auth_not_configured'
    ? '网页登录尚未配置，请联系管理员。'
    : '暂时无法确认登录状态，请刷新页面后重试。'
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
        <span v-else class="auth-status">{{ authState === 'redirecting' ? '正在跳转登录…' : '正在确认登录…' }}</span>
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
