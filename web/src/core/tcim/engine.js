/**
 * TCIM Ontology-only 确定性访谈引擎（网页端，纯前端运行，不调用 LLM）。
 *
 * 依据 5 张专业表（tcim-data.js）逐轮：
 *   1. 前测排序 → prior（表3 priority_rules）：初始 uncertainty / 优先级。
 *   2. 教师回答 → 证据更新（表2 evidence anchors，bigram 覆盖率匹配，允许不升级）。
 *   3. 候选 slot → proposals（表1 ontology + 表4 probe_rules）。
 *   4. Orchestrator ReRank → 锁定本轮 ProfessionalActionPlan（target_slot + probe_strategy）。
 *   5. Generator → 用表4 的「典型非诱导问法」/「可接受跟进」生成教师可见问题。
 *   6. 表5 stop_rules → 剪枝 / 整题停止候选。
 *
 * 边界与 legacy 一致：AI 不参与打分；不泄露标准答案；单轮一主问。
 */
import { TCIM_DATA } from '../../generated/tcim-data.js'

// 与 tcim/modules/ontology/evidence_updater.js 保持一致的中文 bigram 匹配
const SYNONYMS = {
  幼儿: '幼儿', 孩子: '幼儿', 小朋友: '幼儿', 宝贝: '幼儿',
  滑: '湿滑', 湿滑: '湿滑', 地面: '地面', 地滑: '湿滑',
  设备: '器械', 器材: '器械', 篮球架: '器械',
  风险: '风险', 危险: '风险', 安全: '风险',
  介入: '介入', 干预: '介入', 制止: '介入', 提醒: '介入',
  游戏: '游戏', 玩法: '游戏', 玩水: '用水', 接水: '用水', 灌水: '用水',
  规则: '规则', 规矩: '规则', 秩序: '规则',
  场地: '场地', 地方: '场地', 区域: '场地',
  他人: '他人', 别人: '他人', 其他: '他人',
  观察: '观察', 关注: '观察',
  转场: '转场', 迁移: '转场',
  自主: '自主', 生成: '生成', 尊重: '尊重'
}
const STOP_BIGRAMS = new Set(['我们', '你们', '他们', '这个', '那个', '可以', '应该', '就是', '还是', '如果', '但是', '因为', '所以', '什么', '怎么', '然后', '以及', '或者', '是否', '还有', '没有', '不是', '不会', '一个', '自己', '觉得', '的话', '时候', '当时', '之后', '之前', '这样', '那样', '事情', '情况', '方面'])
const RATE_MIN = 0.15
const HITS_MIN = 3

function splitBlocks(text) {
  return String(text || '').replace(/[，。！？；：、""''（）()“”‘’\s]/g, '|').split('|').filter((b) => b.length >= 2)
}
function bigramsOf(text) {
  const out = new Set()
  for (const block of splitBlocks(text)) {
    for (let i = 0; i < block.length - 1; i += 1) out.add(block.slice(i, i + 2))
  }
  return out
}
function normalizeBigrams(bigrams) {
  const out = new Set()
  for (const bg of bigrams) {
    const canon = SYNONYMS[bg]
    if (canon) out.add(canon)
    else if (!STOP_BIGRAMS.has(bg)) out.add(bg)
  }
  return out
}
function buildKeywords(anchorText) { return normalizeBigrams(bigramsOf(anchorText)) }
function overlapCount(text, keywords) {
  const teacherSet = normalizeBigrams(bigramsOf(text))
  const kwCount = keywords && typeof keywords.size === 'number' ? keywords.size : 0
  if (!teacherSet.size || !kwCount) return 0
  let hit = 0
  for (const kw of keywords) if (teacherSet.has(kw)) hit += 1
  return hit
}

function assessSlot(teacherTurn, anchor, currentLevel = 0) {
  if (!anchor) return { level: currentLevel, confidence: 0, matched: false }
  let best = currentLevel
  let bestHit = 0
  for (let lv = 1; lv <= 3; lv += 1) {
    const kws = buildKeywords(anchor[`level_${lv}`] || '')
    const hits = overlapCount(teacherTurn, kws)
    const kwCount = kws.size
    const rate = kwCount ? hits / kwCount : 0
    if (rate >= RATE_MIN && hits >= HITS_MIN && lv > best && hits > bestHit) {
      best = lv
      bestHit = hits
    }
  }
  const matched = best > currentLevel
  const confidence = matched ? Math.min(1, bestHit / 4 + 0.3) : (currentLevel > 0 ? 0.4 : 0)
  return { level: best, confidence, matched }
}

function statusFromLevel(level) {
  if (level <= 0) return 'UNKNOWN'
  if (level === 1) return 'PARTIAL'
  if (level === 2) return 'SUFFICIENT'
  return 'HIGH_QUALITY'
}

/** 前测 prior：由排序/过程特征触发表3 priority 规则。 */
function initPrior(itemId, ranking, tags) {
  const item = TCIM_DATA.items[itemId]
  const prior = {}
  const rankingStr = (ranking || []).join('')
  const first = rankingStr[0] || ''
  const last = rankingStr[rankingStr.length - 1] || ''
  for (const rule of (item.priority && item.priority.rules) || []) {
    const cond = rule.condition || ''
    let matched = false
    if (cond.includes('0—1分') || cond.includes('0-1分')) matched = last === 'D' || (tags || []).some((t) => /极快|低确信|反复修改/.test(t))
    else if (/实证4分|4分/.test(cond)) matched = first === 'A' || first === 'C'
    else if (/实证3分/.test(cond)) matched = /[ABC]/.test(first)
    else if (/实证2分/.test(cond)) matched = true
    else if (/D居末/.test(cond)) matched = last === 'D'
    else if (/D排前|D靠前/.test(cond)) matched = first === 'D'
    else if (/A居首/.test(cond)) matched = first === 'A'
    else matched = true
    if (!matched) continue
    const boost = /低确信|反复修改|不确定|0—1分/.test(cond) ? 0.4 : 0.2
    for (const slotId of rule.target_slots || []) {
      prior[slotId] = {
        uncertainty: Math.min(1, (prior[slotId]?.uncertainty || 0) + boost),
        priority: rule.priority === 'P1' ? 0.9 : rule.priority === 'P2' ? 0.6 : 0.3
      }
    }
  }
  return prior
}

function createEvidence(itemId, prior) {
  const item = TCIM_DATA.items[itemId]
  const slots = (item.ontology && item.ontology.slots) || []
  const ev = {}
  for (const s of slots) {
    const p = prior[s.slot_id] || {}
    ev[s.slot_id] = {
      slot_id: s.slot_id,
      level: 0,
      status: 'UNKNOWN',
      confidence: 0,
      uncertainty: p.uncertainty || 0,
      priorPriority: p.priority || (s.default_priority === 'P1' ? 0.9 : s.default_priority === 'P2' ? 0.6 : 0.3),
      supporting_spans: [],
      conflicting_spans: [],
      probe_status: 'OPEN',
      probe_count: 0,
      asked_questions: []
    }
  }
  return ev
}

function updateEvidence(itemId, ev, teacherTurn, turnId) {
  const item = TCIM_DATA.items[itemId]
  const anchorsBySlot = {}
  for (const a of (item.anchors && item.anchors.anchors) || []) anchorsBySlot[a.slot_id] = a
  const next = {}
  const updates = []
  for (const slotId of Object.keys(ev)) {
    const st = { ...ev[slotId], supporting_spans: ev[slotId].supporting_spans.slice(), conflicting_spans: ev[slotId].conflicting_spans.slice() }
    if (st.probe_status === 'PRUNED' || st.probe_status === 'SATURATED') { next[slotId] = st; continue }
    const anchor = anchorsBySlot[slotId]
    if (!anchor) { next[slotId] = st; continue }
    const before = { level: st.level, confidence: st.confidence }
    const { level, confidence, matched } = assessSlot(teacherTurn, anchor, st.level)
    const conflictKws = buildKeywords(anchor.conflict_evidence || '')
    const hasConflict = conflictKws.size > 0 && overlapCount(teacherTurn, conflictKws) >= 1
    if (matched) {
      st.level = level
      st.status = statusFromLevel(level)
      st.confidence = confidence
      if (!st.supporting_spans.includes(teacherTurn)) st.supporting_spans.push(teacherTurn)
    } else if (hasConflict && st.level > 0) {
      st.confidence = Math.max(0.2, st.confidence - 0.2)
      if (!st.conflicting_spans.includes(teacherTurn)) st.conflicting_spans.push(teacherTurn)
    }
    if (before.level !== st.level || before.confidence !== st.confidence) {
      updates.push({ slot_id: slotId, before, after: { level: st.level, confidence: st.confidence }, reason: matched ? `anchor_level_${level}` : (hasConflict ? 'conflict_added' : 'no_change') })
    }
    next[slotId] = st
  }
  return { evidence: next, updates }
}

function rankSlots(itemId, ev) {
  const item = TCIM_DATA.items[itemId]
  const slots = (item.ontology && item.ontology.slots) || []
  return slots
    .filter((s) => s.core && ev[s.slot_id] && ev[s.slot_id].probe_status !== 'PRUNED' && ev[s.slot_id].probe_status !== 'SATURATED')
    .map((s) => {
      const st = ev[s.slot_id]
      const score = (st.priorPriority || 0) + (st.level === 0 ? 0.5 : 0) + (st.uncertainty || 0) + (st.conflicting_spans.length ? 0.3 : 0) - Math.min(1, (st.probe_count || 0) / 4) * 0.3
      return { slot: s, score }
    })
    .sort((a, b) => b.score - a.score)
}

function itemSufficient(itemId, ev) {
  const item = TCIM_DATA.items[itemId]
  const coreSlots = ((item.ontology && item.ontology.slots) || []).filter((s) => s.core)
  const sufficient = coreSlots.filter((s) => ev[s.slot_id] && ev[s.slot_id].level >= 2).length
  return sufficient >= 4
}

function probeForSlot(itemId, slotId) {
  const item = TCIM_DATA.items[itemId]
  const list = item.probe && Array.isArray(item.probe.probes) ? item.probe.probes : (Array.isArray(item.probe) ? item.probe : [])
  return list.find((p) => p.slot_id === slotId) || null
}

/** 确定性 Generator：为选中的 target_slot 生成教师可见问题（单问、非诱导）。 */
function generateQuestion(itemId, ev, turnNo, history) {
  const ranked = rankSlots(itemId, ev)
  if (!ranked.length) return { question: '感谢您的分享，本情境的访谈先到这里。', done: true }

  // 选择：优先未问过的 top 槽；若 top 槽已问过则选下一个未问槽，避免同槽重复
  let top = ranked.find((r) => !((ev[r.slot.slot_id]?.asked_questions) || []).length)
    || ranked.find((r) => ((ev[r.slot.slot_id]?.asked_questions) || []).length < 2)
    || ranked[0]
  const slotId = top.slot.slot_id
  const probe = probeForSlot(itemId, slotId)
  const st = ev[slotId]
  if (!st.asked_questions) st.asked_questions = []
  const askedCount = st.asked_questions.length

  // 第一问用「典型非诱导问法」；后续用「可接受跟进」或换槽
  let template = ''
  if (askedCount === 0) template = (probe && probe.typical_question) || ''
  else if (askedCount === 1) template = (probe && probe.followup_question) || (probe && probe.typical_question) || ''
  else template = (probe && probe.followup_question) || ''

  // 记录本轮问了哪个槽，避免下一轮同槽
  st.probe_count = (st.probe_count || 0) + 1
  if (template && !st.asked_questions.includes(template)) st.asked_questions.push(template)

  if (template) {
    return { question: template, done: false, target_slot: slotId, probe_strategy: (probe && probe.preferred_action) || '澄清' }
  }
  // 无模板兜底：用不同阶段的通用追问（结合教师排序，非诱导、不泄露答案）
  const genericBank = [
    '面对这个情境，您最想先判断什么？',
    '您为什么会特别看重这一点？',
    '什么情况下您的处理会有所不同？',
    '您希望这样的处理给孩子带来什么？',
    '如果换一个孩子，您的做法会一样吗？',
    '如果时间和条件都允许，您还会做哪些不同的事？'
  ]
  // 选一个未用过的通用问；都用过则回到最后一个
  let generic = genericBank[0]
  for (const g of genericBank) {
    if (!st.asked_questions.includes(g)) { generic = g; break }
  }
  st.asked_questions.push(generic)
  return { question: generic, done: false, target_slot: slotId, probe_strategy: '通用追问' }
}

/* ---------------- Constraint Checker（01-2 第10节） ---------------- */

// 禁止泄露的内部概念（出现即拦截重写）
const LEAK_PATTERNS = [
  /标准答案/, /正确答案/, /专家排序/, /得分/, /分数/, /能力等级/, /评分/,
  /入选原因/, /R\/P\/G/, /IIV/, /Evidence/, /evidence/, /slot/i, /Slot/,
  /锚点/, /证据缺口/, /内部指标/
]
// 评价性语言（不得出现）
const EVALUATIVE_PATTERNS = [
  /很专业/, /非常正确/, /说得很好/, /答得很好/, /您的答案很好/, /棒/, /优秀/, /完美/
]
// 禁止的多问（多个问号 = 多问）
function countQuestionMarks(text) {
  return (String(text).match(/[？?]/g) || []).length
}

/**
 * Constraint Checker：对 Generator 产出的教师可见问题做硬约束检查。
 * 返回 { ok, issues[] }。不改变专业行动；只要求重写。
 */
export function checkConstraints(question, actionPlan, askedHistory) {
  const issues = []
  const q = String(question || '').trim()
  if (!q) issues.push('empty_question')
  if (countQuestionMarks(q) > 1) issues.push('multi_question')
  if (q.length > 120) issues.push('too_long')
  for (const p of LEAK_PATTERNS) if (p.test(q)) issues.push('leak_internal:' + p.source)
  for (const p of EVALUATIVE_PATTERNS) if (p.test(q)) issues.push('evaluative:' + p.source)
  // 重复：与已生成问题相同
  if (askedHistory && askedHistory.includes(q)) issues.push('duplicate_question')
  // 漂移：问题应指向 actionPlan.target_slot 相关的专业内容（这里用探针模板校验由调用方保证）
  return { ok: issues.length === 0, issues }
}

/* ---------------- Generator（01-2 第10节） ---------------- */

/**
 * 初始化一个 TCIM 访谈会话。
 * @returns {object} { itemId, evidence, turnNo, history, done, replay }
 */
export function initTcisSession(itemId, ranking, tags) {
  const prior = initPrior(itemId, ranking, tags)
  return {
    itemId,
    evidence: createEvidence(itemId, prior),
    turnNo: 0,
    history: [],
    done: false,
    replay: []   // 结构化 Replay：每轮决策记录
  }
}

/** 生成一条结构化 Replay 事件（01-2 第12节：TurnReceived/ModuleEvent/OrchestratorEvent/GenerationEvent）。 */
function replayEvent(session, event) {
  session.replay.push(Object.assign({
    turn_no: session.turnNo,
    ts: Date.now(),
    engine_version: ENGINE_VERSION
  }, event))
}

/**
 * 处理教师一轮回答，返回下一轮问题与状态。
 * @param {object} session 由 initTcisSession 返回（会原地更新）
 * @param {string} teacherTurn 教师本轮回答
 * @returns {{ question, done, updates, actionPlan, replay }}
 */
export function processTeacherTurn(session, teacherTurn) {
  if (session.done) return { question: '', done: true }
  session.turnNo += 1
  const turnId = `t${session.turnNo}`
  const trimmed = String(teacherTurn || '').trim()
  // 首问（无教师输入）不记录空教师消息
  if (trimmed) {
    session.history.push({ role: 'teacher', text: trimmed, ts: Date.now() })
    replayEvent(session, { event: 'TurnReceived', raw_teacher_text: trimmed })
  }
  const evidenceBefore = JSON.parse(JSON.stringify(session.evidence))
  const { evidence, updates } = updateEvidence(session.itemId, session.evidence, trimmed, turnId)
  session.evidence = evidence
  // Evidence 前后对比（ModuleEvent）
  for (const u of updates) {
    replayEvent(session, {
      event: 'EvidenceUpdate',
      slot_id: u.slot_id,
      before: u.before,
      after: u.after,
      reason: u.reason
    })
  }
  if (!updates.length) {
    replayEvent(session, { event: 'EvidenceUpdate', slot_id: null, before: null, after: null, reason: 'no_change' })
  }

  // 停止/剪枝（OrchestratorEvent）
  if (itemSufficient(session.itemId, evidence)) {
    session.done = true
    const closing = '感谢您的分享，本情境的访谈先到这里。'
    session.history.push({ role: 'ai', text: closing, ts: Date.now() })
    replayEvent(session, {
      event: 'OrchestratorEvent',
      decision: 'STOP_CANDIDATE',
      target_slot: 'ALL',
      reason: 'item_sufficient',
      knowledge_need: false
    })
    replayEvent(session, { event: 'GenerationEvent', action_type: 'CLOSE', question: closing, constraint_result: 'pass' })
    return { question: '', done: true, updates, actionPlan: { action_type: 'STOP_CANDIDATE', target_slot: 'ALL' }, replay: session.replay }
  }

  const ranked = rankSlots(session.itemId, evidence)
  const actionPlan = { target_slot: ranked[0]?.slot.slot_id || null, probe_strategy: '' }
  replayEvent(session, {
    event: 'OrchestratorEvent',
    decision: 'PROBE',
    target_slot: actionPlan.target_slot,
    ranked_slots: ranked.slice(0, 5).map((r) => ({ slot: r.slot.slot_id, score: Number(r.score.toFixed(3)) })),
    knowledge_need: false,
    reason: 'top_evidence_gap'
  })
  const gen = generateQuestion(session.itemId, evidence, session.turnNo, session.history)
  // Generator → Constraint Checker：不过则用安全通用问重写（不改专业行动）
  const priorQuestions = session.history.filter((h) => h.role === 'ai').map((h) => h.text)
  const checked = checkConstraints(gen.question, actionPlan, priorQuestions)
  let finalQuestion = gen.question
  let constraintResult = checked.ok ? 'pass' : 'rewritten'
  if (!checked.ok) {
    // 安全兜底：单问、非诱导、不泄露
    finalQuestion = '关于这一点，您能再多说一些您是怎么判断的吗？'
    replayEvent(session, {
      event: 'ConstraintEvent',
      target_slot: gen.target_slot,
      issues: checked.issues,
      rewritten_to: finalQuestion
    })
  }
  actionPlan.probe_strategy = gen.probe_strategy
  session.history.push({ role: 'ai', text: finalQuestion, ts: Date.now() })
  replayEvent(session, {
    event: 'GenerationEvent',
    action_type: 'PROBE',
    target_slot: gen.target_slot,
    probe_strategy: gen.probe_strategy,
    question: finalQuestion,
    constraint_result: constraintResult,
    constraint_issues: checked.ok ? [] : checked.issues,
    evidence_before_count: Object.keys(evidenceBefore).length
  })
  return {
    question: finalQuestion,
    done: gen.done,
    updates,
    actionPlan,
    replay: session.replay
  }
}

const ENGINE_VERSION = '2026-08-21-tcim-web-v0.2'

export const tcimData = TCIM_DATA
