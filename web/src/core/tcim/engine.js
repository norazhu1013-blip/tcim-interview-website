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

/** 当前语义提供者句柄（可注入；缺省离线，行为与未接入完全一致）。 */
let semanticProvider = null

/**
 * 注入一个语义预筛提供者（A01 调用点）。`provider(teacherTurn, ctx)` 返回
 * EvidenceAnalysisProposal（{ candidate_spans/conflict_candidates/no_change_reasons/... }）。
 * 传 null 回到离线默认。只做 Proposal，从不直接改 level。
 */
export function setSemanticProvider(provider) {
  semanticProvider = typeof provider === 'function' ? provider : null
}

const JUDGE_RE = /能力|人格|动机|心理|性格|智力水平|属于.{0,3}(高|中|低)能力/

/** 离线默认：什么都不提供，返回空 Proposal（与未接入等价）。 */
function offlineSemantic(teacherTurn) {
  return { candidate_spans: [], candidate_slots: [], conflict_candidates: [], false_evidence_flags: [], no_change_reasons: [], source_turn: teacherTurn || '', provider_version: 'offline-v0.1' }
}

/** 规范化 Proposal：缺失的数组字段补空数组（LLM 输出天然不完整），保证下游拿到合格形状。 */
function normalizeSemanticProposal(raw) {
  const p = raw && typeof raw === 'object' ? raw : {}
  return {
    proposal_type: p.proposal_type || 'EvidenceAnalysisProposal',
    candidate_spans: Array.isArray(p.candidate_spans) ? p.candidate_spans : [],
    candidate_slots: Array.isArray(p.candidate_slots) ? p.candidate_slots : [],
    conflict_candidates: Array.isArray(p.conflict_candidates) ? p.conflict_candidates : [],
    false_evidence_flags: Array.isArray(p.false_evidence_flags) ? p.false_evidence_flags : [],
    uncertainty: typeof p.uncertainty === 'number' ? p.uncertainty : 0,
    no_change_reasons: Array.isArray(p.no_change_reasons) ? p.no_change_reasons : [],
    source_turn: p.source_turn || null,
    provider_version: p.provider_version || 'custom'
  }
}

/** A01 语义预筛：调用 provider（若注入），校验 Schema，绝不改 level。返回 { proposal, ok, errors, provider }。 */
async function analyzeSemantic(teacherTurn, ctx) {
  const turn = String(teacherTurn || '').trim()
  if (!semanticProvider) {
    return { proposal: offlineSemantic(turn), ok: true, errors: [], provider: 'offline' }
  }
  let raw
  try {
    raw = await semanticProvider(turn, ctx || {})
  } catch (e) {
    return { proposal: offlineSemantic(turn), ok: false, errors: [`semantic_provider_error:${e && e.message}`], provider: 'error' }
  }
  const errors = []
  const normalized = normalizeSemanticProposal(raw)
  for (const s of normalized.candidate_spans) {
    const text = s && s.text
    if (!text) errors.push('candidate_spans 某条缺少 text')
    else if (turn && !turn.includes(text)) errors.push(`span「${text}」未出现在教师原话中`)
  }
  if (JUDGE_RE.test(JSON.stringify(normalized))) errors.push('proposal 出现能力/人格/动机直接判定词（G05）')
  if (errors.length) return { proposal: offlineSemantic(turn), ok: false, errors, provider: 'invalid' }
  return { proposal: { ...normalized, source_turn: normalized.source_turn || turn }, ok: true, errors: [], provider: 'custom' }
}

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

function createEvidence(itemId, prior, pretest) {
  const item = TCIM_DATA.items[itemId]
  const slots = (item.ontology && item.ontology.slots) || []
  const ev = {}
  // 前测分数/常模位：低分 → 整体不确定性略升（只作 prior，不直接填等级）
  const lowScoreBoost = pretest && typeof pretest.mean === 'number' && pretest.mean < 2 ? 0.15 : 0
  const highScoreBoost = pretest && typeof pretest.mean === 'number' && pretest.mean >= 3 ? 0.1 : 0
  // 教龄：新人教师判断可能不稳（低把握），仅影响 uncertainty 起点
  const noviceBoost = pretest && /^[0-5]\s*年/.test(String(pretest.teachingYears || '')) ? 0.1 : 0
  for (const s of slots) {
    const p = prior[s.slot_id] || {}
    ev[s.slot_id] = {
      slot_id: s.slot_id,
      level: 0,
      status: 'UNKNOWN',
      confidence: 0,
      uncertainty: Math.min(1, (p.uncertainty || 0) + lowScoreBoost + highScoreBoost + noviceBoost),
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

  // 全局已问句集合（含 PRDM 措辞后的最终文本）。由于 PRDM 会给模板加前缀
  // （如「能不能举个例子，…」），判断"模板是否问过"用「原模板作为子串出现」，
  // 而不要求逐字相等。
  const askedTexts = (history || [])
    .filter((h) => h.role === 'ai' && h.text)
    .map((h) => String(h.text).trim())
  const templateAsked = (t) => {
    if (!t) return true
    const norm = String(t).trim().replace(/[，。！？？]/g, '')
    return askedTexts.some((x) => {
      const xn = String(x).replace(/[，。！？？]/g, '')
      return xn === norm || xn.includes(norm) || norm.includes(xn)
    })
  }

  // 候选槽：按缺口排序，跳过「模板已全部问过」的槽
  const candidates = ranked.filter((r) => {
    const p = probeForSlot(itemId, r.slot.slot_id)
    const freshTemplates = [p && p.typical_question, p && p.followup_question]
      .filter((t) => t && !templateAsked(t))
    return freshTemplates.length > 0
  })
  const top = candidates[0] || ranked[0]
  const slotId = top.slot.slot_id
  const p = probeForSlot(itemId, slotId)
  const st = ev[slotId]
  if (!st.asked_questions) st.asked_questions = []
  const askedCount = st.asked_questions.length

  // 模板：第一问用「典型非诱导问法」；后续用「可接受跟进」；都问过则无模板
  let template = ''
  if (askedCount === 0) template = (p && p.typical_question) || ''
  else if (askedCount === 1) template = (p && p.followup_question) || (p && p.typical_question) || ''
  else template = (p && p.followup_question) || ''
  // 若模板全局已问过（含被 PRDM 前缀包裹的情况），放弃模板走通用问
  if (template && templateAsked(template)) template = ''

  // 记录本轮问了哪个槽，避免下一轮同槽
  st.probe_count = (st.probe_count || 0) + 1

  if (template) {
    st.asked_questions.push(template)
    return { question: template, done: false, target_slot: slotId, probe_strategy: (p && p.preferred_action) || '澄清' }
  }
  // 无模板兜底：用未全局用过的通用追问（结合教师排序，非诱导、不泄露答案）
  const genericBank = [
    '面对这个情境，您最想先判断什么？',
    '您为什么会特别看重这一点？',
    '什么情况下您的处理会有所不同？',
    '您希望这样的处理给孩子带来什么？',
    '如果换一个孩子，您的做法会一样吗？',
    '如果时间和条件都允许，您还会做哪些不同的事？'
  ]
  let generic = ''
  for (const g of genericBank) {
    if (!templateAsked(g) && !st.asked_questions.includes(g)) { generic = g; break }
  }
  // 全部通用问都用过 → 该题已无新的可问内容，正常收束（避免无限循环）
  if (!generic) {
    return { question: '感谢您的分享，本情境的访谈先到这里。', done: true, target_slot: slotId, probe_strategy: 'CLOSE' }
  }
  st.asked_questions.push(generic)
  return { question: generic, done: false, target_slot: slotId, probe_strategy: '通用追问' }
}

/** PRDM 措辞适配：按 DialoguePlan 调整教师可见问句（不改变专业目标/证据判断）。 */
function prdmWording(question, prdm) {
  let q = String(question || '').trim()
  if (!q) return q
  const move = prdm.dialogue_move
  const progressStatus = prdm.local_progress && prdm.local_progress.status
  // REPAIR：先承接修正，再问
  if (move === 'REPAIR') {
    q = '我重新理解一下您的意思：' + q
  }
  // SLOW / 低确信：加一个具体化前缀，缩小问题
  if (progressStatus === 'SLOW' && !q.startsWith('我重新理解') && !q.startsWith('能不能举个例子')) {
    q = '能不能举个例子，' + q
  }
  // GENTLE_CHALLENGE：温和对比
  if (move === 'GENTLE_CHALLENGE') {
    q = '如果换个角度看，' + q
  }
  // LOW dose / frustration：尽量短（去掉前缀只留核心问句）
  if (prdm.response_dose === 'LOW') {
    const m = q.match(/[^，。；]*[？?]/)
    if (m) q = m[0]
  }
  return q
}

/* ---------------- RAG V0.1（04-1 架构，按需知识，默认 R0 不调用） ---------------- */

// RAG 默认关闭。开启需 VITE_TCIM_RAG=1，且仅当 Orchestrator knowledge_need=true 时触发。
const RAG_ENABLED = String(typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_TCIM_RAG || '').trim() === '1'

function buildRagCapsules() {
  const capsules = {}
  for (const qid of Object.keys(TCIM_DATA.items)) {
    const item = TCIM_DATA.items[qid]
    const notes = []
    for (const slot of (item.ontology && item.ontology.slots) || []) notes.push(`${slot.slot_id} ${slot.name}：${slot.definition}`)
    for (const a of (item.anchors && item.anchors.anchors) || []) notes.push(`${a.slot_id} 高质量证据：${a.level_3}`)
    capsules[qid] = notes
  }
  return capsules
}

const RAG_CAPSULES = buildRagCapsules()

/** 关键词检索（R2 降级），来源可追溯。 */
function ragRetrieve(query, questionId) {
  const notes = RAG_CAPSULES[questionId] || []
  if (!notes.length) return { refs: [], route: 'R0' }
  const terms = String(query || '').split(/[\s,，、]+/).filter((t) => t.length >= 2)
  if (!terms.length) return { refs: notes.slice(0, 2).map((t, i) => ({ source: `${questionId}-capsule-${i}`, text: t })), route: 'R1' }
  const hits = notes.map((text, i) => ({ text, i, score: terms.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0) }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
  const refs = hits.slice(0, 3).map((x) => ({ source: `${questionId}-capsule-${x.i}`, text: x.text }))
  return { refs, route: refs.length ? 'R2' : 'R0' }
}

/**
 * 按需 RAG 决策（Orchestrator Stage A 之后的 knowledge_need 判断）。
 * V0.1：仅当明确开启且当前 evidence 缺口大时触发；默认 R0 不调用。
 */
function ragDecision(session, evidence) {
  if (!RAG_ENABLED) return { knowledge_need: false, route: 'R0' }
  // 简单判断：核心槽多数 level 0 且已谈了几轮仍无进展 → 需要知识支持
  const item = TCIM_DATA.items[session.itemId]
  const core = ((item.ontology && item.ontology.slots) || []).filter((s) => s.core)
  const zeroLevel = core.filter((s) => evidence[s.slot_id] && evidence[s.slot_id].level === 0).length
  const knowledgeNeed = zeroLevel >= 3 && session.turnNo >= 3
  if (!knowledgeNeed) return { knowledge_need: false, route: 'R0' }
  const { refs, route } = ragRetrieve(item.ontology.diagnostic_focus || '判断', session.itemId)
  return { knowledge_need: true, route, refs }
}

/* ---------------- PRDM V0.1（03-1 架构，确定性对话策略） ---------------- */

function prdmInteractionRead(teacherTurn, recentTurns) {
  const s = String(teacherTurn || '').trim()
  const depth = (s.match(/[。，；、！？]/g) || []).length
  const hasDetail = /(?:因为|所以|先|然后|如果|当|看情况|根据|条件|具体|比如|例如)/.test(s)
  return {
    repair_signal: /(?:我不是这个意思|你理解错了|你误会了|不是这样|我说的是|你没听懂|我纠正一下|重新说)/.test(s),
    frustration: /(?:烦|别问了|不要再问|不想继续|不回答了|结束吧|到这里吧)/.test(s),
    low_certainty: /(?:不太确定|可能|也许|说不准|我也说不清|我不太清楚|没想好)/.test(s),
    response_depth: hasDetail && depth >= 2 ? 2 : (hasDetail ? 1 : 0)
  }
}

function prdmLocalProgress(updates, signals) {
  if (updates && updates.some((u) => /anchor_level_2|anchor_level_3/.test(u.reason))) return { status: 'ADVANCING' }
  if (updates && updates.length) return { status: 'ADVANCING' }
  if (signals.frustration) return { status: 'STUCK' }
  if (signals.repair_signal) return { status: 'ADVANCING' }
  if (signals.response_depth === 0) return { status: 'SLOW' }
  return { status: 'ADVANCING' }
}

function prdmStanceMove(progress, signals) {
  if (signals.repair_signal) return { stance: 'LISTEN', move: 'REPAIR', challenge: 0 }
  if (signals.frustration) return { stance: 'LISTEN', move: 'BRIEF_UPTAKE_PROBE', challenge: 0 }
  if (progress.status === 'STUCK') return { stance: 'CO_INQUIRE', move: 'NOTICE_AND_PROBE', challenge: 0 }
  if (progress.status === 'SLOW') return { stance: 'CO_INQUIRE', move: 'BRIEF_UPTAKE_PROBE', challenge: 0 }
  if (signals.low_certainty) return { stance: 'CO_INQUIRE', move: 'DIRECT_PROBE', challenge: 0 }
  return { stance: 'CO_INQUIRE', move: 'DIRECT_PROBE', challenge: 1 }
}

/** PRDM 决策（确定性，不写 Evidence）。 */
function prdmPlan(teacherTurn, recentTurns, evidenceUpdates) {
  const signals = prdmInteractionRead(teacherTurn, recentTurns)
  const progress = prdmLocalProgress(evidenceUpdates, signals)
  const sm = prdmStanceMove(progress, signals)
  return {
    dialogue_move: sm.move,
    stance: sm.stance,
    local_progress: progress,
    challenge_level: sm.challenge,
    question_load: signals.frustration || signals.response_depth === 0 ? 'LIGHT' : 'STANDARD',
    response_dose: signals.frustration ? 'LOW' : 'STANDARD',
    max_questions: 1,
    max_chars: signals.frustration ? 40 : 80
  }
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
 * @param {string} itemId Q1..Q10
 * @param {string[]} ranking 前测排序
 * @param {string[]} tags 过程标签
 * @param {object} [pretest] 前测完整资料 { mean, total, teachingYears, modificationCount, durationMs, firstSwing, lastSwing, oscillation }
 * @returns {object} { itemId, evidence, turnNo, history, done, replay }
 */
export function initTcisSession(itemId, ranking, tags, pretest) {
  const prior = initPrior(itemId, ranking, tags)
  return {
    itemId,
    evidence: createEvidence(itemId, prior, pretest),
    turnNo: 0,
    history: [],
    done: false,
    replay: [],   // 结构化 Replay：每轮决策记录
    pretest: pretest || null
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
export async function processTeacherTurn(session, teacherTurn) {
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

  // ---- A01 语义预筛（Step 1：LLM 只做 Proposal，裁决权仍在确定性 updateEvidence）----
  // 只作为语义层的「观察/线索」透传，绝不改 level/confidence（G04/G05）。
  const semantic = await analyzeSemantic(trimmed, {
    itemId: session.itemId,
    turnId,
    evidenceSummary: session.evidence,
    questionTitle: (TCIM_DATA.items[session.itemId] && TCIM_DATA.items[session.itemId].metadata && TCIM_DATA.items[session.itemId].metadata.title) || ''
  })
  if (semantic.ok && semantic.proposal) {
    const p = semantic.proposal
    for (const span of p.candidate_spans || []) {
      replayEvent(session, { event: 'SemanticEvent', type: 'span', slot: span.slot_id || '?', span: span.text, span_type: span.span_type || 'supporting', provider: semantic.provider })
    }
    for (const c of p.conflict_candidates || []) {
      replayEvent(session, { event: 'SemanticEvent', type: 'conflict_candidate', slot: c.slot_id || '?', note: c.reason, provider: semantic.provider })
    }
    for (const n of p.no_change_reasons || []) {
      replayEvent(session, { event: 'SemanticEvent', type: 'no_change', slot: n.slot_id || '?', note: n.reason, provider: semantic.provider })
    }
  } else if (semantic.errors && semantic.errors.length) {
    replayEvent(session, { event: 'SemanticEvent', type: 'invalid', errors: semantic.errors, provider: semantic.provider })
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
  // RAG 按需决策（默认 R0；仅 VITE_TCIM_RAG=1 且缺口大时触发）
  const rag = ragDecision(session, evidence)
  replayEvent(session, {
    event: 'OrchestratorEvent',
    decision: 'PROBE',
    target_slot: actionPlan.target_slot,
    ranked_slots: ranked.slice(0, 5).map((r) => ({ slot: r.slot.slot_id, score: Number(r.score.toFixed(3)) })),
    knowledge_need: rag.knowledge_need,
    rag_route: rag.route,
    rag_refs: rag.refs ? rag.refs.length : 0,
    reason: 'top_evidence_gap'
  })
  // PRDM：读 observable 信号 → 输出 DialoguePlan（不写 Evidence、不改专业目标）
  const recentTurns = session.history.filter((h) => h.role === 'teacher').map((h) => h.text)
  const prdm = prdmPlan(trimmed, recentTurns, updates)
  replayEvent(session, {
    event: 'PRDMEvent',
    dialogue_plan: {
      move: prdm.dialogue_move,
      stance: prdm.stance,
      progress: prdm.local_progress.status,
      challenge_level: prdm.challenge_level,
      question_load: prdm.question_load,
      response_dose: prdm.response_dose
    }
  })
  const gen = generateQuestion(session.itemId, evidence, session.turnNo, session.history)
  // 模板与通用问全部用尽 → 正常收束（避免无限循环）
  if (gen.done) {
    session.done = true
    const closing = gen.question || '感谢您的分享，本情境的访谈先到这里。'
    session.history.push({ role: 'ai', text: closing, ts: Date.now() })
    replayEvent(session, {
      event: 'OrchestratorEvent',
      decision: 'STOP_CANDIDATE',
      target_slot: gen.target_slot || 'ALL',
      reason: 'questions_exhausted',
      knowledge_need: false
    })
    replayEvent(session, { event: 'GenerationEvent', action_type: 'CLOSE', question: closing, constraint_result: 'pass' })
    return { question: '', done: true, updates, actionPlan: { action_type: 'STOP_CANDIDATE', target_slot: gen.target_slot || 'ALL' }, replay: session.replay }
  }
  // PRDM 措辞适配：按 DialoguePlan 调整问句（不改专业目标/证据判断）。
  // 只在「未问过的模板」上做措辞；重复用通用问时不叠加前缀，避免逐字重复。
  const prdmAdapted = prdmWording(gen.question, prdm)
  // Generator → Constraint Checker：不过则用安全通用问重写（不改专业行动）。
  // 去重用「最终可见文本」；若命中也按 Constraint 拦截处理，但不陷入无限循环：
  // 此处 fallback 用「基于当前槽的通用追问」，保证每次都有新问句或正常收束。
  const priorQuestions = session.history.filter((h) => h.role === 'ai').map((h) => h.text)
  const checked = checkConstraints(prdmAdapted, actionPlan, priorQuestions)
  let finalQuestion = prdmAdapted
  let constraintResult = checked.ok ? 'pass' : 'rewritten'
  if (!checked.ok) {
    // 安全兜底：单问、非诱导、不泄露；用「当前槽未用过的通用追问」，避免固定句循环
    const safeBank = [
      '关于这一点，您能再多说一些您是怎么判断的吗？',
      '您最想先帮孩子解决的是哪一件事？',
      '如果换一个更具体的场景，您会怎么处理？'
    ]
    finalQuestion = safeBank[Math.min(session.turnNo % safeBank.length, safeBank.length - 1)]
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
    prdm_move: prdm.dialogue_move,
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
