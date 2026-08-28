<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ITEMS } from '../generated/data.js'
import { getSession } from '../services/storage.js'

const route = useRoute()
const router = useRouter()
const session = getSession(route.params.sid)
const index = ref(0)
const reviewItems = session?.studyMode === 'single_trial'
  ? ITEMS.filter((item) => item.item_id === session.targetItemId)
  : ITEMS
</script>

<template>
  <section v-if="session" class="page narrow-page">
    <div class="page-title">
      <button class="back-link" @click="router.back()">← 返回</button>
      <p class="eyebrow">作答回看</p>
      <h1>{{ reviewItems[index].title }}</h1>
      <p>情境 {{ index + 1 }} / {{ reviewItems.length }}</p>
    </div>
    <article class="review-card">
      <p class="scenario-stem">{{ reviewItems[index].stem }}</p>
      <ol class="review-order">
        <li v-for="(letter, pos) in session.answers?.[reviewItems[index].item_id]?.final_ranking" :key="letter">
          <span>{{ pos + 1 }}</span><strong>{{ letter }}</strong><p>{{ reviewItems[index].options[letter] }}</p>
        </li>
      </ol>
    </article>
    <div class="exam-actions">
      <button class="button secondary" :disabled="index === 0" @click="index--">上一题</button>
      <button class="button primary" :disabled="index === reviewItems.length - 1" @click="index++">下一题</button>
    </div>
  </section>
</template>
