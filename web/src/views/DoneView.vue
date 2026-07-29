<script setup>
import { useRoute, useRouter } from 'vue-router'
import { getSession } from '../services/storage.js'

const route = useRoute()
const router = useRouter()
const session = getSession(route.params.sid)
</script>

<template>
  <section v-if="session" class="page narrow-page done-page">
    <div class="done-mark">✓</div>
    <p class="eyebrow">访谈完成</p>
    <h1>感谢您的认真分享</h1>
    <p>本次测评与三个情境访谈均已完成，您可以返回首页回看答题、评分和访谈记录。</p>
    <button class="button primary" @click="router.push('/')">返回首页</button>
  </section>
</template>
