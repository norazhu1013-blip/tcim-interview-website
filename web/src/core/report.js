/**
 * report.js —— 确定性能力画像报告（纯函数，供 ReportView 渲染/测试）。
 *
 * 报告定位：只做「分数定位 + 过程解释 + 访谈证据回填」的确定性整理，AI 不参与。
 * - 分数来自查表（computeScores）；三级指标水平由 INDICATOR_MAP 主/次指标加权聚合。
 * - 每条判断可回溯到具体题目（questions）/过程标签/访谈原话（evidence）。
 * - 不暴露标准排序、专家答案、评分规则；非评判（用「优势点 / 发展点」而非「好/坏」）。
 *
 * 说明：这是 v1 数据驱动画像；§9 的完整「三源融合 + 常模定位」属研究侧算法，不在本模块。
 */
import { INDICATOR_MAP } from '../generated/data.js'
import { buildCanonicalCapabilityProfile } from './canonical-capability-profile.js'
import { isFormalComparisonInterviewRecord } from './dialogue-agent/records.js'

export const TERTIARY_INDICATORS = ['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2']
export const SECONDARY_INDICATORS = {
  A: ['A1', 'A2', 'A3'],
  B: ['B1', 'B2'],
  C: ['C1', 'C2']
}
export const SECONDARY_LABEL = {
  A: '对游戏的特点、价值的理解',
  B: '游戏条件的保障',
  C: '游戏支持与指导'
}
export const TERTIARY_LABEL = {
  A1: '对游戏特点的理解',
  A2: '对游戏价值的理解（游戏中的学习）',
  A3: '对游戏价值实现的认识',
  B1: '游戏环境创设',
  B2: '教师在幼儿游戏中的角色',
  C1: '游戏中的观察',
  C2: '对游戏行为的分析与回应'
}
const FULL_MARKS = 4 // 10 题赋分 0-4

function levelText(score) {
  if (score >= 3.5) return '较充分'
  if (score >= 2.5) return '较清晰'
  if (score >= 1.5) return '初步形成'
  if (score >= 0.5) return '有待加强'
  return '证据不足'
}

function itemTitle(itemId) {
  const t = itemId && itemId.match(/(Q\d+)/)
  return t ? t[1] : itemId
}

function formalInterviewRecords(session) {
  const merged = { ...(session.interview || {}), ...(session.comparisonInterview || {}) }
  return Object.fromEntries(Object.entries(merged).filter(([, record]) => isFormalComparisonInterviewRecord(record)))
}

function canonicalEvidence(item) {
  const records = item?.dialogueSession?.evidenceState?.records || []
  const active = records.filter((record) => (
    record?.lifecycle === 'ACTIVE'
    && ['SUPPORT', 'REVISE'].includes(record?.relation)
    && typeof record?.span === 'string'
    && record.span.trim()
  ))
  const independent = active.filter((record) => ['RO0', 'RO1'].includes(record.responseOrigin))
  const prompted = active.filter((record) => record.responseOrigin === 'RO2')
  const aiInfluenced = active.filter((record) => ['RO3', 'RO4'].includes(record.responseOrigin))
  const spans = [...new Set(active.map((record) => record.span.trim()))]
  return {
    quote: spans.join('；'),
    independentQuote: [...new Set(independent.map((record) => record.span.trim()))].join('；'),
    promptedQuote: [...new Set(prompted.map((record) => record.span.trim()))].join('；'),
    aiInfluencedQuote: [...new Set(aiInfluenced.map((record) => record.span.trim()))].join('；'),
    evidenceIds: active.map((record) => record.evidenceId).filter(Boolean),
    evidenceClaimIds: [...new Set(active.map((record) => record.evidenceClaimId).filter(Boolean))],
    independentEvidenceIds: independent.map((record) => record.evidenceId).filter(Boolean),
    promptedEvidenceIds: prompted.map((record) => record.evidenceId).filter(Boolean),
    aiInfluencedEvidenceIds: aiInfluenced.map((record) => record.evidenceId).filter(Boolean)
  }
}

/** 二级 → 其含有的三级指标 + 主键题目。 */
function flagSecondary(session) {
  const primaryBySecondary = {}
  const secondaryByQuestion = {}
  for (const [itemId, m] of Object.entries(INDICATOR_MAP)) {
    const sec = m && m.primary && m.primary.secondary
    if (sec) {
      primaryBySecondary[sec] = primaryBySecondary[sec] || []
      primaryBySecondary[sec].push(itemTitle(itemId))
    }
  }
  return { primaryBySecondary, secondaryByQuestion }
}

/**
 * 生成报告。
 * @param {object} session 会话对象（含 scores/answers/selection/interview）
 * @returns {object} 结构化报告 data
 */
export function buildReport(session) {
  const s = session || {}
  const scores = s.scores || {}
  const perItem = scores.perItem || {}
  const total = Number(scores.total || 0)
  const mean = Number(scores.mean || 0)
  const level = scores.level || ''

  // 1) 每个三级指标 ← 主/次题目得分加权聚合（主 1.0、次 0.5）
  const acc = {}
  for (const t of TERTIARY_INDICATORS) acc[t] = { w: 0, wsum: 0, questions: [] }
  for (const [itemId, m] of Object.entries(INDICATOR_MAP || {})) {
    const sc = Number(perItem[itemId] || 0)
    const prim = m && m.primary && m.primary.tertiary
    const sec = m && m.secondary_ind && m.secondary_ind.tertiary
    if (prim && acc[prim]) { acc[prim].w += 1.0; acc[prim].wsum += sc * 1.0; acc[prim].questions.push(itemTitle(itemId) + '(主)') }
    if (sec && acc[sec]) { acc[sec].w += 0.5; acc[sec].wsum += sc * 0.5; acc[sec].questions.push(itemTitle(itemId) + '(次)') }
  }
  const tertiary = TERTIARY_INDICATORS.map((t) => {
    const a = acc[t]
    const score = a.w > 0 ? Math.round((a.wsum / a.w) * 10) / 10 : 0
    return {
      code: t,
      label: TERTIARY_LABEL[t],
      score,
      ratio: a.w > 0 ? Math.round((a.wsum / a.w / FULL_MARKS) * 100) : 0,
      questions: a.questions.slice(),
      level: levelText(score)
    }
  })

  // 2) 二级 A/B/C ← 所属三级平均
  const secondaryArr = Object.entries(SECONDARY_INDICATORS).map(([code, codes]) => {
    const inds = tertiary.filter((t) => codes.includes(t.code))
    const m = inds.length ? inds.reduce((x, t) => x + t.score, 0) / inds.length : 0
    return {
      code,
      label: SECONDARY_LABEL[code],
      score: Math.round(m * 10) / 10,
      ratio: Math.round((m / FULL_MARKS) * 100),
      indicators: inds
    }
  })
  const sortedSec = secondaryArr.slice().sort((x, y) => y.score - x.score)
  const strongest = sortedSec[0]
  const weakest = sortedSec[sortedSec.length - 1]

  // 3) 过程解释：用时/改动/摇摆（短、非评判）
  const process = processNarrative(s)

  // 4) 访谈证据回填：每个已作答情境 → 主指标 + 访谈焦点 + 教师原话引用
  const evidence = interviewEvidence(s)
  const canonicalCapabilityProfile = buildCanonicalCapabilityProfile(s)
  // 只有教师自主表达的 RO0/RO1 才能把来自测评的指标标注为“测评 + 访谈”。
  // RO2/RO3/RO4 不得把 AI 提示或诱导后的认同回写成原有能力。
  const evByIndicator = {}
  for (const e of evidence) { if (e.indicator && e.independentQuote) evByIndicator[e.indicator] = true }
  for (const t of tertiary) t.source = evByIndicator[t.code] ? '测评 + 访谈' : '测评定位为主'

  // 5) 学习建议：对三级指标里偏低的给可观察/可行动的方向（对齐 observation_points）
  const suggestions = buildSuggestions(s, tertiary)

  const answeredItems = Object.keys(perItem).length

  return {
    overview: { total, mean: Math.round(mean * 10) / 10, level, items: answeredItems },
    secondary: secondaryArr,
    secondaryInsight: {
      strongest: strongest && { code: strongest.code, score: strongest.score },
      weakest: weakest && { code: weakest.code, score: weakest.score }
    },
    tertiary,
    process,
    evidence,
    canonicalCapabilityProfile,
    suggestions
  }
}

function processNarrative(s) {
  const answers = s.answers || {}
  let totalMs = 0
  let modified = 0
  let swinging = 0
  let answered = 0
  for (const it of Object.values(answers)) {
    if (!it || !(it.final_ranking || it.duration_ms)) continue
    answered++
    totalMs += Number(it.duration_ms || 0)
    if (Array.isArray(it.move_log) && it.move_log.length > 0) modified++
    if (Array.isArray(it.move_log) && it.move_log.length >= 2) swinging++
  }
  const minutes = Math.round(totalMs / 60000 * 10) / 10
  const parts = []
  if (answered) parts.push(`本次共完成 ${answered} 题，作答用时约 ${minutes} 分钟。`)
  if (modified > 0) parts.push(`其中 ${modified} 题在提交前调整过排序，属于常见的反复斟酌。`)
  if (swinging > 0) parts.push(`有 ${swinging} 题的排序路径出现多次来回调整，仅用作了解判断形成过程，不作为能力评价。`)
  if (!parts.length) parts.push('过程数据暂不足，仅呈现已获得的结果信息。')
  return { text: parts.join(''), answered, modified, swinging }
}

function interviewEvidence(s) {
  const selection = (s.selection && s.selection.final) || []
  const interviews = formalInterviewRecords(s)
  const out = []
  for (const f of selection) {
    if (!f || !f.id) continue
    const itemId = f.id
    const tc = f.task_card || {}
    const af = tc.ability_focus || {}
    const item = interviews[itemId]
    const canonical = canonicalEvidence(item)
    const m = INDICATOR_MAP[itemId] || {}
    out.push({
      itemId: itemTitle(itemId),
      indicator: (m.primary && m.primary.tertiary) || '',
      focus: f.interview_focus || af.interview_main_focus || af.ability_focus || '',
      quote: canonical.quote,
      independentQuote: canonical.independentQuote,
      promptedQuote: canonical.promptedQuote,
      aiInfluencedQuote: canonical.aiInfluencedQuote,
      evidenceIds: canonical.evidenceIds,
      evidenceClaimIds: canonical.evidenceClaimIds,
      independentEvidenceIds: canonical.independentEvidenceIds,
      promptedEvidenceIds: canonical.promptedEvidenceIds,
      aiInfluencedEvidenceIds: canonical.aiInfluencedEvidenceIds,
      evidenceStatus: canonical.evidenceIds.length ? 'formed' : 'not_formed',
      status: (item && item.status) || ''
    })
  }
  return out
}

function buildSuggestions(s, tertiary) {
  // 取三级指标里「有待加强/证据不足」的，给 2 条发展性提示（对齐该指标的观察要点）
  const low = tertiary.filter((t) => t.score < 1.5)
  const map = {}
  for (const [itemId, m] of Object.entries(INDICATOR_MAP || {})) {
    const pts = []
    if (m && m.primary && m.primary.observation_points) pts.push(...m.primary.observation_points)
    if (m && m.secondary_ind && m.secondary_ind.observation_points) pts.push(...m.secondary_ind.observation_points)
    for (const p of pts) { if (!map[p]) map[p] = { sec: m.primary.secondary, t: m.primary.tertiary }; }
  }
  const out = low.map((t) => ({
    indicator: t.code,
    label: t.label,
    score: t.score,
    direction: `可多关注「${t.label}」：结合观察要点（${t.questions.slice(0, 2).join('、') || t.label}）回看幼儿游戏，记录并思考回应方式。`
  }))
  if (!out.length) out.push({ indicator: '', label: '整体', score: 0, direction: '当前各项证据较充分，建议继续丰富典型情境的实践与反思记录，保持经验积累。' })
  return out
}

/**
 * 跨次成长对比：比较两份报告的三级指标差异（确定性的、非评判的「提升/关注点」呈现）。
 * @param {object} a 当前报告
 * @param {object} b 上一次报告
 * @returns {{ rows: Array<{code,label,a,b,diff}>, summary: string }}
 */
export function compareReports(a, b) {
  const rows = (a && a.tertiary || []).map((cur) => {
    const prev = ((b && b.tertiary) || []).find((t) => t.code === cur.code)
    const p = prev ? prev.score : null
    return { code: cur.code, label: cur.label, a: cur.score, b: p, diff: p == null ? null : Math.round((cur.score - p) * 10) / 10 }
  })
  const changed = rows.filter((r) => r.diff !== null && r.diff !== 0)
  const up = changed.filter((r) => r.diff > 0).length
  const down = changed.filter((r) => r.diff < 0).length
  let summary = '可与上次进行对比，观察能力画像的变化。'
  if (!rows.some((r) => r.diff !== null)) summary = '暂无上一次报告可供对比。'
  else summary = `与上次相比，${up} 项提升、${down} 项有变化，其余保持稳定。`
  return { rows, summary }
}

/**
 * 把报告转成可导出/复制的纯文本（Markdown），用于「导出报告」。
 * @param {object} report buildReport 结果
 * @param {object} meta { mean, ssid } 追加信息
 * @returns {string}
 */
export function buildReportText(report, meta) {
  const o = report && report.overview || {}
  const lines = []
  lines.push('# 能力画像报告')
  lines.push('')
  lines.push(`- 作答题目：${o.items || 0}　·　均分：${o.mean || 0}（0-4）　·　整体定位：${o.level || '—'}`)
  lines.push('')
  lines.push('## 三个二级指标')
  for (const s of (report.secondary || [])) lines.push(`- ${s.code} ${s.label}：${s.score.toFixed(1)}`)
  lines.push('')
  lines.push('## 七个三级指标')
  for (const t of (report.tertiary || [])) lines.push(`- ${t.code} ${t.label}：${t.score.toFixed(1)}（${t.level}）`)
  if (report.process && report.process.text) { lines.push(''); lines.push('## 过程说明'); lines.push(report.process.text) }
  if (report.evidence && report.evidence.length) {
    lines.push(''); lines.push('## 访谈证据回填')
    for (const e of report.evidence) lines.push(`- ${e.itemId}${e.indicator ? '（' + e.indicator + '）' : ''}：${e.quote || '（尚未形成 canonical Evidence）'}`)
  }
  if (report.canonicalCapabilityProfile) {
    lines.push(''); lines.push('## Canonical Evidence 能力画像候选')
    lines.push(`- 来源边界：${report.canonicalCapabilityProfile.interpretationBoundary}`)
    for (const row of report.canonicalCapabilityProfile.dimensions.filter((item) => item.evidenceCount || item.prompted.length || item.aiInfluenced.length)) {
      lines.push(`- ${row.capabilityId} ${row.name}：${row.band.label}（独立证据${row.evidenceCount}条，情境${row.independentContexts.length}个）`)
    }
  }
  if (report.suggestions && report.suggestions.length) {
    lines.push(''); lines.push('## 学习建议')
    for (const s of report.suggestions) lines.push(`- ${s.direction}`)
  }
  lines.push(''); lines.push('> 报告呈现分数/维度/证据，不暴露标准排序、专家答案、评分规则。')
  lines.push(`> 生成时间：${new Date().toLocaleString('zh-CN')}`)
  return lines.join('\n')
}
