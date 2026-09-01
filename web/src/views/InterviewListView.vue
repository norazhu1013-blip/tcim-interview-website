<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ITEMS } from '../generated/data.js'
import { getProfile, getSession, saveSession } from '../services/storage.js'
import { reportExam, selectFinal } from '../services/api.js'
import { requireWebLogin } from '../services/web-auth.js'
import { isFormalComparisonInterviewRecord } from '../core/dialogue-agent/records.js'

const route = useRoute()
const router = useRouter()
const session = ref(getSession(route.params.sid))
const loading = ref(false)
const error = ref('')
const itemById = Object.fromEntries(ITEMS.map((item) => [item.item_id, item]))
const selected = computed(() => session.value?.selection?.final || [])
function comparisonRecord(itemId) {
  const record = session.value?.comparisonInterview?.[itemId]
    || session.value?.interview?.[itemId]
  return isFormalComparisonInterviewRecord(record) ? record : null
}
function isComparisonDone(itemId) {
  return comparisonRecord(itemId)?.status === 'done'
}
function isSimulationDone(itemId) {
  return session.value?.simulationInterview?.[itemId]?.status === 'done'
}
function wasTechnicallyInterrupted(itemId) {
  return ['opening_generation_failed', 'opening_timed_out', 'technical_interruption']
    .includes(comparisonRecord(itemId)?.completionOutcome)
}
const doneCount = computed(() => selected.value.filter((item) => isComparisonDone(item.id)).length)
const plannedCount = computed(() => selected.value.length)
const allDone = computed(() => plannedCount.value > 0 && doneCount.value === plannedCount.value)
const isSingleTrial = computed(() => session.value?.studyMode === 'single_trial')

async function loadSelection() {
  loading.value = true
  error.value = ''
  let result = await selectFinal(session.value.sessionId)
  if (['not_authenticated', 'cloudbase_token_invalid'].includes(result?.error)) {
    if (await requireWebLogin()) result = await selectFinal(session.value.sessionId)
  }
  // 若提交阶段的响应已返回、但服务器会话记录未真正落库，使用本机完整答卷
  // 幂等补报一次，再重试确定性情境生成。避免要求参与者重新作答。
  if (result?.error === 'session_not_found') {
    const reportResult = await reportExam(session.value, getProfile())
    if (reportResult?.ok) result = await selectFinal(session.value.sessionId)
    else result = reportResult || result
  }
  loading.value = false
  if (!result.ok) {
    const reason = result?.error ? `（${result.error}）` : ''
    error.value = `访谈情境生成失败${reason}，请稍后重试。`
    return
  }
  session.value.selection = result.selection
  session.value = saveSession(session.value)
}

function open(item) {
  router.push(`/interview/${session.value.sessionId}/${item.id}`)
}
</script>

<template>
  <section v-if="session" class="page">
    <div class="page-title">
      <button class="back-link" @click="router.push('/')">← 返回首页</button>
      <p class="eyebrow">幼教慧谈</p>
      <h1>{{ isSingleTrial ? '单题 AI 深度访谈' : 'AI 访谈情境' }}</h1>
      <p>{{ isSingleTrial ? '本次将围绕“未参与小组建构”及您的真实排序开展深度访谈。访谈内容由 AI 生成，仅供专业反思与研究参考。' : '系统会结合本次排序与过程记录遴选三个情境。访谈内容由 AI 生成，仅供专业反思与研究参考。' }}</p>
    </div>

    <div v-if="!selected.length" class="empty-card">
      <strong>尚未生成访谈情境</strong>
      <p>{{ error || '需要联网调用确定性遴选服务，AI 不参与筛题。' }}</p>
      <button class="button primary" :disabled="loading" @click="loadSelection">{{ loading ? '正在生成…' : '生成访谈情境' }}</button>
    </div>

    <div v-else class="interview-grid">
      <article v-for="(selectedItem, i) in selected" :key="selectedItem.id" class="interview-card">
        <img :src="`./scenarios/${selectedItem.id}.jpg`" :alt="itemById[selectedItem.id]?.title" />
        <div>
          <span class="status" :class="{ complete: isComparisonDone(selectedItem.id) }">
            {{ isComparisonDone(selectedItem.id) ? '已完成' : (isSimulationDone(selectedItem.id) ? '演示完成 · 不计入' : (wasTechnicallyInterrupted(selectedItem.id) ? '技术中断 · 未完成' : '待访谈')) }}
          </span>
          <p class="eyebrow">情境 {{ i + 1 }}</p>
          <h2>{{ itemById[selectedItem.id]?.title }}</h2>
          <p>{{ itemById[selectedItem.id]?.stem || '情境原文暂不可用。' }}</p>
          <button class="button secondary" @click="open(selectedItem)">
            {{ isComparisonDone(selectedItem.id) ? '回看访谈' : (isSimulationDone(selectedItem.id) ? '查看演示 / 开始正式访谈' : (wasTechnicallyInterrupted(selectedItem.id) ? '重新进入访谈' : '开始访谈')) }}
          </button>
        </div>
      </article>
    </div>

    <div v-if="selected.length" class="completion-strip">
      <div><strong>{{ doneCount }}/{{ plannedCount }}</strong><span>已完成情境</span></div>
      <button v-if="allDone && !session.interviewFeedback" class="button primary" @click="router.push(`/feedback/${session.sessionId}`)">填写访谈反馈</button>
      <button v-else-if="allDone" class="button primary" @click="router.push(`/done/${session.sessionId}`)">完成</button>
    </div>
  </section>
</template>
