<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getSession, listSessions } from '../services/storage.js'
import { buildReport, compareReports, buildReportText } from '../core/report.js'

const route = useRoute()
const router = useRouter()
const sessionId = route.params.sid
const session = getSession(sessionId)
const report = computed(() => buildReport(session || {}))

// 跨次成长对比：取当前会话之前最近一份已完成报告作对比。
const prevReport = computed(() => {
  const curCreated = (session && session.createdAt) || 0
  const prior = listSessions()
    .filter((s) => s.sessionId !== sessionId && s.scores && s.scores.mean != null && (s.createdAt || 0) < curCreated)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0]
  return prior ? buildReport(prior) : null
})
const comparison = computed(() => (prevReport.value ? compareReports(report.value, prevReport.value) : { rows: [], summary: '暂无上一次报告可供对比。' }))

function exportReport() {
  const text = buildReportText(report.value, { mean: report.value.overview.mean, ssid: sessionId })
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `能力画像报告-${sessionId}.md`
  a.click()
  URL.revokeObjectURL(url)
}

// P15（历史报告）：当前教师的其它已完成报告,便于顺着记录查看成长轨迹。
const history = computed(() => {
  const cur = sessionId
  return listSessions()
    .filter((s) => s.sessionId !== cur && s.scores && s.scores.mean != null && (s.selection?.final?.length || Object.keys(s.interview || {}).length))
    .slice(0, 6)
    .map((s) => ({
      sessionId: s.sessionId,
      mean: Number(s.scores.mean || 0),
      items: (s.selection && s.selection.final && s.selection.final.length) || Object.keys(s.interview || {}).length
    }))
})

// 7 轴雷达图(纯 SVG,无依赖):score/4 → 半径比例;外圈=理想(100%)
const radar = computed(() => {
  const items = report.value.tertiary
  if (!items.length) return { points: '', outer: '', cx: 0, cy: 0, r: 0 }
  const cx = 100, cy = 100, r = 80
  const pt = (ratio, i) => {
    const ang = (-90 + i * (360 / items.length)) * Math.PI / 180
    return `${cx + r * ratio * Math.cos(ang)},${cy + r * ratio * Math.sin(ang)}`
  }
  return {
    cx, cy, r,
    outer: items.map((_, i) => pt(1, i)).join(' '),
    points: items.map((t, i) => pt(t.score / 4, i)).join(' ')
  }
})

function secScoreBar(s) { return Math.max(0, Math.min(100, s.ratio)) + '%' }
function terScoreBar(t) { return Math.max(0, Math.min(100, t.ratio)) + '%' }
function back() { router.back() }
</script>

<template>
  <section class="report">
    <header class="report-header">
      <button class="icon-button" @click="back">←</button>
      <div><strong>能力画像报告</strong><small>结果来自本次测评与 AI 访谈，不暴露评分规则</small></div>
      <button class="button text" @click="exportReport">导出</button>
    </header>

    <!-- 概览 -->
    <div class="card">
      <h3>测评概览</h3>
      <div class="report-metrics">
        <div class="metric"><strong>{{ report.overview.items }}</strong><span>作答题目</span></div>
        <div class="metric"><strong>{{ report.overview.mean }}</strong><span>均分(0-4)</span></div>
        <div class="metric"><strong>{{ report.overview.level || '—' }}</strong><span>整体定位</span></div>
        <div class="metric"><strong>{{ report.overview.total }}</strong><span>总分</span></div>
      </div>
      <p class="report-note">{{ report.process.text }}</p>
    </div>

    <!-- 能力画像 -->
    <div class="card">
      <h3>能力画像（七个三级指标）</h3>
      <div class="radar-wrap">
        <svg viewBox="0 0 200 200" class="radar" role="img" aria-label="能力画像雷达图">
          <polygon :points="radar.outer" fill="none" stroke="#d7dbe5" stroke-width="1" />
          <polygon :points="radar.points" fill="rgba(63,99,214,0.18)" stroke="#3f63d6" stroke-width="2" />
          <g v-for="(t, i) in report.tertiary" :key="t.code">
            <line :x1="radar.cx" :y1="radar.cy"
              :x2="radar.cx + radar.r * Math.cos((-90 + i * (360 / report.tertiary.length)) * Math.PI / 180)"
              :y2="radar.cy + radar.r * Math.sin((-90 + i * (360 / report.tertiary.length)) * Math.PI / 180)"
              stroke="#e3e6ec" stroke-width="1" />
          </g>
        </svg>
      </div>
      <div class="tertiary-list">
        <div v-for="t in report.tertiary" :key="t.code" class="ter-row">
          <span class="ter-code">{{ t.code }}</span>
          <div class="ter-bar"><i :style="{ width: terScoreBar(t) }"></i></div>
          <span class="ter-val">{{ t.score.toFixed(1) }}</span>
        </div>
      </div>
      <p class="tip">三级指标标注为独立观测维度，非好坏评价；分数越高代表该维度证据越充分。</p>
    </div>

    <!-- 二级指标解读 -->
    <div class="card">
      <h3>二级指标解读</h3>
      <div class="sec-grid">
        <div v-for="s in report.secondary" :key="s.code" class="sec-card">
          <strong>{{ s.code }} · {{ s.label }}</strong>
          <div class="sec-bar"><i :style="{ width: secScoreBar(s) }"></i></div>
          <p>{{ s.score.toFixed(1) }}（0-4）</p>
          <small>{{ s.indicators.map(t => t.label).join('、') }}</small>
        </div>
      </div>
      <p class="report-note">
        相对而言，<strong>{{ report.secondaryInsight.strongest?.code }}</strong> 证据较充分，
        <strong>{{ report.secondaryInsight.weakest?.code }}</strong> 可作为后续观察与支持的切入点。
      </p>
    </div>

    <!-- 三级指标展开 -->
    <div class="card">
      <h3>三级指标展开</h3>
      <div v-for="t in report.tertiary" :key="'x' + t.code" class="exp-row">
        <strong>{{ t.code }} {{ t.label }}</strong>
        <span class="exp-level">{{ t.level }}</span>
        <small>对应题目：{{ t.questions.join('、') || '—' }}</small>
      </div>
    </div>

    <!-- 访谈证据回填 -->
    <div class="card">
      <h3>访谈证据回填</h3>
      <p class="tip">以下出自教师真实访谈原话，用于佐证画像；每条可回溯到具体情境。</p>
      <div v-for="e in report.evidence" :key="'ev' + e.itemId" class="ev-row">
        <strong>{{ e.itemId }}</strong>
        <span v-if="e.indicator" class="pill">{{ e.indicator }}</span>
        <p v-if="e.focus">{{ e.focus }}</p>
        <blockquote v-if="e.quote">「{{ e.quote }}」</blockquote>
      </div>
      <p v-if="!report.evidence.length" class="tip">暂无已完成的访谈证据。</p>
    </div>

    <!-- 学习建议 -->
    <div class="card">
      <h3>学习建议</h3>
      <ul class="sugg-list">
        <li v-for="(s, i) in report.suggestions" :key="'sg' + i">{{ s.direction }}</li>
      </ul>
    </div>

    <div v-if="comparison.rows.some((r) => r.diff !== null)" class="card">
      <h3>与上次对比</h3>
      <p class="tip">{{ comparison.summary }}</p>
      <div v-for="r in comparison.rows" :key="'c' + r.code" class="cmp-row">
        <span class="cmp-code">{{ r.code }}</span>
        <span class="cmp-label">{{ r.label }}</span>
        <span :class="r.diff > 0 ? 'up' : (r.diff < 0 ? 'down' : 'flat')">
          {{ r.diff > 0 ? '+' : '' }}{{ r.diff.toFixed(1) }}（{{ r.a.toFixed(1) }} vs {{ r.b.toFixed(1) }}）
        </span>
      </div>
    </div>

    <div v-if="history.length" class="card">
      <h3>历史报告</h3>
      <p class="tip">以下为其它测评记录的报告，可点击查看，观察成长轨迹。</p>
      <div
        v-for="(h, i) in history"
        :key="'h' + h.sessionId"
        class="his-row"
        role="button"
        @click="router.push(`/report/${h.sessionId}`)"
      >
        <span class="his-idx">{{ i + 1 }}</span>
        <span>均分 {{ h.mean.toFixed(1) }}</span>
        <small>{{ h.items }} 个访谈情境</small>
        <span class="his-arrow">查看 ›</span>
      </div>
    </div>

    <footer class="report-footer">
      <button class="button primary" @click="back">返回</button>
    </footer>
  </section>
</template>

<style scoped>
.report { max-width: 720px; margin: 0 auto; padding: 16px; }
.report-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.report-header small { display: block; color: #8a93a6; }
.card { background: #fff; border: 1px solid #eef0f4; border-radius: 14px; padding: 16px 18px; margin-bottom: 14px; }
.card h3 { margin: 0 0 12px; font-size: 16px; color: #2c3345; }
.report-metrics { display: flex; gap: 14px; flex-wrap: wrap; }
.metric { flex: 1; min-width: 110px; background: #f7f8fb; border-radius: 12px; padding: 12px; text-align: center; }
.metric strong { display: block; font-size: 20px; color: #3f63d6; }
.metric span { font-size: 12px; color: #8a93a6; }
.report-note { font-size: 13px; color: #4b5563; line-height: 1.6; margin: 12px 0 0; }
.radar-wrap { display: flex; justify-content: center; }
.radar { width: 200px; height: 200px; }
.tertiary-list { margin-top: 12px; }
.ter-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
.ter-code { width: 34px; font-weight: 600; color: #3f63d6; font-size: 13px; }
.ter-bar { flex: 1; height: 12px; background: #eef0f4; border-radius: 6px; overflow: hidden; }
.ter-bar i { display: block; height: 100%; background: #3f63d6; border-radius: 6px; }
.ter-val { width: 40px; text-align: right; font-size: 13px; color: #4b5563; }
.sec-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.sec-card { background: #f7f8fb; border-radius: 12px; padding: 14px; }
.sec-card strong { font-size: 14px; color: #2c3345; display: block; margin-bottom: 8px; }
.sec-bar { height: 8px; background: #e6e9f0; border-radius: 5px; overflow: hidden; margin-bottom: 8px; }
.sec-bar i { display: block; height: 100%; background: #3f63d6; }
.sec-card p { margin: 4px 0; font-size: 13px; color: #3f63d6; }
.sec-card small { color: #8a93a6; font-size: 12px; }
.exp-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f0f2f6; flex-wrap: wrap; }
.exp-row strong { font-size: 14px; color: #2c3345; flex: 1 1 220px; }
.exp-level { font-size: 12px; color: #3f63d6; background: #eef2fb; padding: 2px 8px; border-radius: 10px; }
.exp-row small { color: #8a93a6; width: 100%; }
.ev-row { padding: 10px 0; border-bottom: 1px solid #f0f2f6; }
.ev-row strong { color: #3f63d6; }
.pill { display: inline-block; font-size: 11px; background: #eef2fb; color: #3f63d6; padding: 2px 8px; border-radius: 10px; margin-left: 8px; }
.ev-row p { font-size: 13px; color: #4b5563; margin: 6px 0 0; }
.ev-row blockquote { margin: 8px 0 0; padding-left: 10px; border-left: 3px solid #3f63d6; color: #374151; font-size: 13px; }
.sugg-list { margin: 0; padding-left: 18px; }
.sugg-list li { margin: 8px 0; line-height: 1.6; color: #374151; }
.tip { font-size: 12px; color: #98a1b3; margin: 8px 0 0; }
.his-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f0f2f6; cursor: pointer; }
.his-row:hover { background: #fafbff; }
.his-idx { width: 22px; height: 22px; border-radius: 50%; background: #eef2fb; color: #3f63d6; font-size: 12px; display: flex; align-items: center; justify-content: center; flex: none; }
.his-row small { color: #98a1b3; flex: 1; }
.his-arrow { color: #3f63d6; font-size: 13px; }
.cmp-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f0f2f6; }
.cmp-code { width: 34px; font-weight: 600; color: #3f63d6; font-size: 13px; }
.cmp-label { flex: 1; color: #4b5563; font-size: 13px; }
.cmp-row span.up { color: #067647; font-weight: 600; }
.cmp-row span.down { color: #b42318; font-weight: 600; }
.cmp-row span.flat { color: #98a1b3; }
.report-footer { text-align: center; margin-top: 8px; }
</style>
