<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ITEMS } from '../generated/data.js'
import { getSession } from '../services/storage.js'

const route = useRoute()
const router = useRouter()
const session = getSession(route.params.sid)
const index = ref(0)
</script>

<template>
  <section v-if="session" class="page narrow-page">
    <div class="page-title">
      <button class="back-link" @click="router.back()">← 返回</button>
      <p class="eyebrow">作答回看</p>
      <h1>{{ ITEMS[index].title }}</h1>
      <p>情境 {{ index + 1 }} / {{ ITEMS.length }}</p>
    </div>
    <article class="review-card">
      <p class="scenario-stem">{{ ITEMS[index].stem }}</p>
      <ol class="review-order">
        <li v-for="(letter, pos) in session.answers?.[ITEMS[index].item_id]?.final_ranking" :key="letter">
          <span>{{ pos + 1 }}</span><strong>{{ letter }}</strong><p>{{ ITEMS[index].options[letter] }}</p>
        </li>
      </ol>
      <div class="review-score">本题得分 <strong>{{ session.scores?.perItem?.[ITEMS[index].item_id] }}</strong></div>
    </article>
    <div class="exam-actions">
      <button class="button secondary" :disabled="index === 0" @click="index--">上一题</button>
      <button class="button primary" :disabled="index === ITEMS.length - 1" @click="index++">下一题</button>
    </div>
  </section>
</template>
