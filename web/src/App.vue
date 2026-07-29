<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const showTabs = computed(() => route.path === '/' || route.path === '/profile')
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
    </header>

    <main class="page-shell">
      <router-view />
    </main>

    <nav v-if="showTabs" class="bottom-tabs" aria-label="主导航">
      <router-link to="/" exact-active-class="active">答题</router-link>
      <router-link to="/profile" active-class="active">我的</router-link>
    </nav>
  </div>
</template>
