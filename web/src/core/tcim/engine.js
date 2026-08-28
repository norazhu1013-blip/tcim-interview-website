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
// V0.2 共享逻辑：直接从 Node 内核 tcim/modules 复用（ESM 命名空间导入 CJS）。
// 源码在 <repo>/tcim/modules/... —— 一个真源，消除 Node/网页分叉。
import * as beliefState from '../../../../tcim/modules/context/belief_state.js'
import * as teacherModel from '../../../../tcim/modules/context/teacher_model.js'
import * as agentPlanner from '../../../../tcim/modules/planner/agent_planner.js'
import * as decisionGate from '../../../../tcim/modules/gate/decision_gate.js'
import * as challengeQueue from '../../../../tcim/modules/context/challenge_queue.js'
import * as evidenceUpdater from '../../../../tcim/modules/ontology/evidence_updater.js'
const { validateProposal: v2ValidateProposal, commitProposal: v2CommitProposal } = evidenceUpdater.default || evidenceUpdater
import * as prdmV2ns from '../../../../tcim/modules/prdm/prdm_v2.js'
const prdmV2 = prdmV2ns.default || prdmV2ns
import * as knowledgeNeedNs from '../../../../tcim/modules/rag/knowledge_need.js'
const knowledgeNeed = knowledgeNeedNs.default || knowledgeNeedNs

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

// V0.2 双状态 + Planner + Gate 是否启用（网页构建变量 VITE_TCIM_V2=1；默认关，Node 下为 undefined）
const V2_ENABLED = String((typeof import.meta && typeof import.meta.env !== 'undefined' && import.meta.env.VITE_TCIM_V2) || (typeof process !== 'undefined' && process.env && process.env.VITE_TCIM_V2) || '').trim() === '1'
let _semanticMode = String((typeof import.meta && typeof import.meta.env !== 'undefined' && import.meta.env.VITE_TCIM_SEMANTIC_MODE) || (typeof process !== 'undefined' && process.env && process.env.TCIM_SEMANTIC_MODE) || (V2_ENABLED ? 'fallback_allowed' : 'disabled')).trim()
export function setSemanticMode(mode) { _semanticMode = String(mode || 'disabled').trim() }
export function getSemanticMode() { return _semanticMode }
export function isV2Enabled() { return V2_ENABLED }

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
  return { candidate_spans: [], slot_evidence_proposals: [], conflict_candidates: [], false_evidence_flags: [], no_change_reasons: [], uncertainty: [], source_turn: teacherTurn || '', provider_version: 'offline-v0.2' }
}

/** 规范化 Proposal：缺失的数组字段补空数组（LLM 输出天然不完整），保证下游拿到合格形状。 */
function normalizeSemanticProposal(raw) {
  const p = raw && typeof raw === 'object' ? raw : {}
  return {
    proposal_type: p.proposal_type || 'EvidenceAnalysisProposal',
    candidate_spans: Array.isArray(p.candidate_spans) ? p.candidate_spans : [],
    slot_evidence_proposals: Array.isArray(p.slot_evidence_proposals) ? p.slot_evidence_proposals : [],
    conflict_candidates: Array.isArray(p.conflict_candidates) ? p.conflict_candidates : [],
    false_evidence_flags: Array.isArray(p.false_evidence_flags) ? p.false_evidence_flags : [],
    uncertainty: Array.isArray(p.uncertainty) ? p.uncertainty : [],
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
  const validSlotIds = ctx && ctx.validSlotIds
  for (const s of normalized.candidate_spans) {
    const text = s && s.text
    if (!text) errors.push('candidate_spans 某条缺少 text')
    else if (turn && !turn.includes(text)) errors.push(`span「${text}」未出现在教师原话中`)
  }
  for (const sp of normalized.slot_evidence_proposals) {
    if (!sp || !sp.slot_id) errors.push('slot_evidence_proposal 缺 slot_id')
    else if (validSlotIds && !validSlotIds.has(sp.slot_id)) errors.push(`slot 「${sp.slot_id}」不存在于本题`)
    if (typeof sp.proposed_level === 'number' && (sp.proposed_level < 0 || sp.proposed_level > 3)) errors.push(`slot 「${sp.slot_id}」 proposed_level 越界: ${sp.proposed_level}`)
    if (Array.isArray(sp.supporting_spans) && sp.supporting_spans.length) {
      for (const t of sp.supporting_spans) if (turn && !turn.includes(t)) errors.push(`slot 「${sp.slot_id}」 supporting_span「${t}」未回指教师原话`)
    }
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

// 2.1：教师本轮回答是否谈到了某槽的证据锚点（任一 level 关键词命中即可）。
// 用于让后续问承接教师刚说到的那个槽，而不是机械跳到别的缺口。
function slotTouchedByTeacher(teacherTurn, anchor) {
  if (!teacherTurn || !anchor) return false
  for (let lv = 1; lv <= 3; lv += 1) {
    const kws = buildKeywords(anchor[`level_${lv}`] || '')
    if (overlapCount(teacherTurn, kws) > 0) return true
  }
  return false
}

// 教师本轮回答命中某槽锚点关键词的总命中数（用于在多个被命中的槽之间择优承接）。
function anchorHitsInTurn(teacherTurn, anchor) {
  if (!teacherTurn || !anchor) return 0
  let hits = 0
  for (let lv = 1; lv <= 3; lv += 1) {
    const kws = buildKeywords(anchor[`level_${lv}`] || '')
    hits += overlapCount(teacherTurn, kws)
  }
  return hits
}

// 取教师原话里命中锚点的一段简短引用（≤14 字），用于审计/回放，不强塞进可见文本。
function teacherAnchorSpan(teacherTurn, anchor) {
  if (!teacherTurn || !anchor) return ''
  const norm = String(teacherTurn)
  for (let lv = 1; lv <= 3; lv += 1) {
    const kws = buildKeywords(anchor[`level_${lv}`] || '')
    for (const kw of kws) {
      const short = String(kw).replace(/\s+/g, '')
      if (short && short.length >= 2 && short.length <= 14 && norm.includes(kw)) return short
    }
  }
  return ''
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

// 修复能力：教师纠正/澄清/表达没听懂时,下一轮应接住并重述,而不是照常进下一模板。
const REPAIR_RE = /(?:不是，?我的意思|我不是这个意思|我说的是|没(?:听|看)(?:懂|明白|清)|你没(?:理解|明白)|理解错(?:了)?|我(?:重新|再说)?(?:说|讲|表达)(?:不清|不对)+|换个(?:说法|角度)|意思(?:不是|是|是说)|我表达(?:错|不清))/i;
const REPAIR_LEAK = /标准答案|得分|分数|能力等级|评分|专家排序|R\/P\/G|slot|证据|锚点|内部指标/i;
function isRepairTurn(text) {
  return REPAIR_RE.test(String(text || '').replace(/\s+/g, ''))
}
function sanitizeExcerpt(text) {
  return String(text || '').replace(/[，。！？“”"''、：；]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14)
}
function repairQuestion(teacherTurn) {
  const excerpt = sanitizeExcerpt(teacherTurn)
  if (excerpt && !REPAIR_LEAK.test(excerpt)) return `我可能没理解准确，您是想说“${excerpt}”吗？`
  return '我可能没理解准确，您更想说的是哪一点呢？'
}

/** 确定性 Generator：为选中的 target_slot 生成教师可见问题（单问、非诱导）。 */
function generateQuestion(itemId, ev, turnNo, history, preferredSlot, teacherTurn) {
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

  // V0.2：若指定 preferredSlot（Planner 选中），且该槽有未问过的模板，则以它为目标；否则按缺口排序
  let top
  if (preferredSlot) {
    const pp = probeForSlot(itemId, preferredSlot)
    const freshPreferred = [pp && pp.typical_question, pp && pp.followup_question].filter((t) => t && !templateAsked(t))
    if (freshPreferred.length) top = { slot: { slot_id: preferredSlot } }
  }
  if (!top) {
    // 候选槽：按缺口排序，跳过「模板已全部问过」的槽
    const candidates = ranked.filter((r) => {
      const p = probeForSlot(itemId, r.slot.slot_id)
      const freshTemplates = [p && p.typical_question, p && p.followup_question]
        .filter((t) => t && !templateAsked(t))
      return freshTemplates.length > 0
    })
    // 2.1：教师本轮回答命中的槽优先承接其话题（而非跳到别的缺口）；teacherTurn 为空不影响原行为。
    // 在多个被命中的槽之间，按命中数择优（命中最多者最贴近教师刚说的点）。
    let touched = null
    if (teacherTurn) {
      const item = TCIM_DATA.items[itemId]
      const ab = {}
      for (const a of (item.anchors && item.anchors.anchors) || []) ab[a.slot_id] = a
      const scored = candidates
        .map((c) => ({ c, hits: anchorHitsInTurn(teacherTurn, ab[c.slot.slot_id]) }))
        .filter((x) => x.hits > 0)
        .sort((x, y) => y.hits - x.hits)
      touched = scored.length ? scored[0].c : null
    }
    top = touched || candidates[0] || ranked[0]
  }
  const slotId = top.slot.slot_id
  const p = probeForSlot(itemId, slotId)
  const st = ev[slotId]
  if (!st.asked_questions) st.asked_questions = []
  const askedCount = st.asked_questions.length

  // 2.1：教师本轮回答是否命中了该槽，用于记录承接关系（不改问句文本本身的专业性）
  const it = TCIM_DATA.items[itemId]
  const ab = {}
  for (const a of (it.anchors && it.anchors.anchors) || []) ab[a.slot_id] = a
  const followsTeacher = !!(teacherTurn && slotTouchedByTeacher(teacherTurn, ab[slotId]))
  const anchorSpan = followsTeacher ? teacherAnchorSpan(teacherTurn, ab[slotId]) : ''

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
    return { question: template, done: false, target_slot: slotId, probe_strategy: (p && p.preferred_action) || '澄清', followup_reason: followsTeacher ? 'teacher_topic_match' : 'evidence_gap', anchor_span: anchorSpan }
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
  return { question: generic, done: false, target_slot: slotId, probe_strategy: '通用追问', followup_reason: followsTeacher ? 'teacher_topic_match' : 'evidence_gap', anchor_span: anchorSpan }
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
    pretest: pretest || null,
    ranking: (ranking || []).slice(),   // A00 输入：教师排序
    processTags: (tags || []).slice(),  // A00 输入：过程标签
    contextual_belief_state: { beliefs: {}, version: 0 } // V0.2 Belied State
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
 * V0.2 首问链路：A00（情境解释/Teacher Model）→ A03（Planner 选 action）→ A04（Risk Gate）→ 生成首问。
 * 在教师尚未回答时调用。disabled 模式回退到模板首问。
 * @param {object} session 由 initTcisSession 返回（会原地更新 contextual_belief_state / replay）
 * @returns {{ question, done, target_slot, gate, replay }}
 */
export function firstQuestion(session) {
  const item = TCIM_DATA.items[session.itemId]
  const isV2 = getSemanticMode() !== 'disabled'
  if (!isV2) {
    // 规则基线：用现有 generateQuestion 首问（模板/通用问）
    const gen = generateQuestion(session.itemId, session.evidence, session.turnNo, session.history)
    session.turnNo += 1
    if (gen.question) session.history.push({ role: 'ai', text: gen.question, ts: Date.now() })
    return { question: gen.question || '', done: gen.done, target_slot: gen.target_slot || null, gate: null, replay: session.replay }
  }

  // ---- A00：情境解释 / Teacher Model（用 ranking + processTags + pretest）----
  const factRefs = [session.itemId, ...(session.ranking || []).map((r) => `OPT-${r}`)]
  const a00 = teacherModel.buildContextInterpretationProposal({
    factRefs,
    assessmentSnapshot: { open_text: session.pretest && session.pretest.total != null ? String(session.pretest.total) : null },
    processTags: session.processTags || [],
    questionTitle: (item.metadata && item.metadata.title) || ''
  })
  // A00 → Belief：把 A00 的 proposed_beliefs 提交为 Belief(ADD)
  const bs = session.contextual_belief_state || { beliefs: {}, version: 0 }
  for (const b of (a00.proposed_beliefs || [])) {
    const mut = { op: 'ADD', claim: b.claim, confidence: b.confidence, uncertainty: 0.6, source_refs: b.source_refs || factRefs, alternatives: b.alternatives || [] }
    const v = beliefState.validateBeliefMutation(mut, bs)
    if (v.ok) { const r = beliefState.applyBeliefMutation(bs, mut, 'init'); session.contextual_belief_state = r.state }
  }
  // Teacher Model 快照
  const teacherModelSnapshot = teacherModel.buildTeacherModelSnapshot({
    factRefs,
    beliefState: session.contextual_belief_state,
    evidenceStateRef: session.itemId,
    turnId: 'init'
  })
  replayEvent(session, { event: 'TeacherModelEvent', active_belief_refs: teacherModelSnapshot.active_belief_refs, competing_belief_refs: teacherModelSnapshot.competing_belief_refs, builder_version: teacherModelSnapshot.builder_version })
  // ---- A03 Planner：选绿色低风险 action ----
  const agentDecision = agentPlanner.planDecision({ item, evidence: session.evidence, teacherModel: teacherModelSnapshot, beliefState: session.contextual_belief_state })
  replayEvent(session, { event: 'PlannerEvent', selected_action_id: agentDecision.selected_action_id, primary_target_slot: agentDecision.primary_target_slot, claimed_table_alignment: agentDecision.claimed_table_alignment, claimed_risk_level: agentDecision.claimed_risk_level, rejected_action_ids: agentDecision.rejected_action_ids })
  // ---- A04 Risk Gate ----
  const gateResult = decisionGate.validateDecision(agentDecision, { expectedStateVersion: session.contextual_belief_state.version, committedStateVersion: session.contextual_belief_state.version })
  replayEvent(session, { event: 'GateEvent', decision: gateResult.decision, approved_action_id: gateResult.approved_action_id, adjudicated_risk_level: gateResult.adjudicated_risk_level, adjudicated_table_alignment: gateResult.adjudicated_table_alignment, evaluator_required: gateResult.evaluator_required })

  // ---- 生成首问：绑定 Planner 选中的 target_slot 的探测模板（仍是「非诱导问法」，non-leaking）----
  const gen = generateQuestion(session.itemId, session.evidence, session.turnNo, session.history, agentDecision.primary_target_slot)
  session.turnNo += 1
  const q = gen.question || ''
  if (q) session.history.push({ role: 'ai', text: q, ts: Date.now() })
  return { question: q, done: gen.done, target_slot: agentDecision.primary_target_slot, gate: gateResult, replay: session.replay }
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
  const item = TCIM_DATA.items[session.itemId]
  const validSlotIds = new Set(((item.ontology && item.ontology.slots) || []).map((s) => s.slot_id))
  const evidenceBefore = JSON.parse(JSON.stringify(session.evidence))

  // ---- A01 语义预筛（先做，供 V2 双状态链使用；V0.1 时仅作观察透传）----
  // 2.3：把本题 anchors 一起传给语义层，否则云端 anchorBySlot 收到空数组，无法校验锚点。
  const anchorBySlot = {}
  for (const a of ((item.anchors && item.anchors.anchors) || [])) anchorBySlot[a.slot_id] = a
  const semantic = await analyzeSemantic(trimmed, {
    itemId: session.itemId,
    turnId,
    evidenceSummary: session.evidence,
    questionTitle: (item.metadata && item.metadata.title) || '',
    validSlotIds,
    anchorBySlot
  })
  for (const sp of (semantic.ok && semantic.proposal ? semantic.proposal.slot_evidence_proposals || [] : [])) {
    replayEvent(session, { event: 'SemanticEvent', type: 'slot_proposal', slot: sp.slot_id, proposed_level: sp.proposed_level, confidence: sp.confidence, supporting_spans: sp.supporting_spans || [], provider: semantic.provider })
  }
  for (const span of (semantic.ok && semantic.proposal ? semantic.proposal.candidate_spans || [] : [])) {
    replayEvent(session, { event: 'SemanticEvent', type: 'span', span: span.text, slots: span.candidate_slots || [], provider: semantic.provider })
  }
  for (const c of (semantic.ok && semantic.proposal ? semantic.proposal.conflict_candidates || [] : [])) {
    replayEvent(session, { event: 'SemanticEvent', type: 'conflict_candidate', slot: c.slot_id || '?', note: c.reason, provider: semantic.provider })
  }
  if (semantic.errors && semantic.errors.length) {
    replayEvent(session, { event: 'SemanticEvent', type: 'invalid', errors: semantic.errors, provider: semantic.provider })
  }

  let evidence
  let updates = []
  let beliefEvents = []
  let teacherModelSnapshot = null
  let agentDecision = null
  let gateResult = null
  let challengeCandidates = []

  if (getSemanticMode() === 'disabled') {
    // V0.1 规则基线：bigram updateEvidence（与原行为一致）
    const r = updateEvidence(session.itemId, session.evidence, trimmed, turnId)
    evidence = r.evidence
    updates = r.updates
  } else if (semantic.ok && semantic.proposal && (semantic.proposal.slot_evidence_proposals || []).length) {
    // ---- V0.2 双状态链：Evidence(validator/committer) → Belief → TeacherModel → Planner → Gate ----
    const p = semantic.proposal
    // Evidence：用 Node 共享 validator + committer（单一真源，消除 Node/网页分叉）
    const anchorsBySlot = {}
    for (const a of ((item.anchors && item.anchors.anchors) || [])) anchorsBySlot[a.slot_id] = a
    const v = v2ValidateProposal(p, { itemId: session.itemId, validSlotIds, teacherTurn: trimmed, anchorsBySlot })
    const c = v2CommitProposal(session.evidence, v.acceptedUpdates, trimmed, turnId)
    evidence = c.state
    updates = c.updates
    // Belief（A02B）：uncertainty → ADD
    let bs = session.contextual_belief_state || { beliefs: {}, version: 0 }
    for (const u of (p.uncertainty || []).slice(0, 2)) {
      const mut = { op: 'ADD', claim: u, confidence: 0.6, uncertainty: 0.6, source_refs: [turnId, session.itemId], alternatives: [] }
      const validB = beliefState.validateBeliefMutation(mut, bs)
      if (validB.ok) { const r = beliefState.applyBeliefMutation(bs, mut, turnId); bs = r.state; beliefEvents.push(r.event) }
    }
    session.contextual_belief_state = bs
    // TeacherModel（A00 快照）
    teacherModelSnapshot = teacherModel.buildTeacherModelSnapshot({ factRefs: [turnId, session.itemId], beliefState: bs, evidenceStateRef: session.itemId, turnId })
    // Planner（A03）
    agentDecision = agentPlanner.planDecision({ item, evidence, teacherModel: teacherModelSnapshot, beliefState: bs })
    // Gate（A04）
    gateResult = decisionGate.validateDecision(agentDecision, { expectedStateVersion: bs.version, committedStateVersion: bs.version })
    // A12 Challenge
    const cq = challengeQueue.createChallengeQueue()
    const chal = challengeQueue.challengeFromDecision(cq, agentDecision, gateResult)
    if (chal) challengeCandidates = cq.challenges
  } else {
    // semantic 无效但非 disabled：回退 bigram，保证可推进
    const r = updateEvidence(session.itemId, session.evidence, trimmed, turnId)
    evidence = r.evidence
    updates = r.updates
  }
  session.evidence = evidence
  for (const u of updates) {
    replayEvent(session, { event: 'EvidenceUpdate', slot_id: u.slot_id, before: u.before, after: u.after, reason: u.reason })
  }
  if (!updates.length) {
    replayEvent(session, { event: 'EvidenceUpdate', slot_id: null, before: null, after: null, reason: 'no_change' })
  }
  // V0.2 Replay：Belief / TeacherModel / Planner / Gate
  for (const ev of beliefEvents) replayEvent(session, { event: 'BeliefEvent', op: ev.op, claim: ev.claim || null, before: ev.before, after: ev.after })
  if (teacherModelSnapshot) replayEvent(session, { event: 'TeacherModelEvent', active_belief_refs: teacherModelSnapshot.active_belief_refs, competing_belief_refs: teacherModelSnapshot.competing_belief_refs })
  if (agentDecision) replayEvent(session, { event: 'PlannerEvent', selected_action_id: agentDecision.selected_action_id, primary_target_slot: agentDecision.primary_target_slot, claimed_table_alignment: agentDecision.claimed_table_alignment, claimed_risk_level: agentDecision.claimed_risk_level, rejected_action_ids: agentDecision.rejected_action_ids })
  if (gateResult) replayEvent(session, { event: 'GateEvent', decision: gateResult.decision, approved_action_id: gateResult.approved_action_id, adjudicated_risk_level: gateResult.adjudicated_risk_level, adjudicated_table_alignment: gateResult.adjudicated_table_alignment, evaluator_required: gateResult.evaluator_required })
  if (challengeCandidates.length) replayEvent(session, { event: 'ChallengeEvent', challenges: challengeCandidates })

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
    return { question: closing, done: true, updates, actionPlan: { action_type: 'STOP_CANDIDATE', target_slot: 'ALL' }, replay: session.replay }
  }

  const ranked = rankSlots(session.itemId, evidence)
  const actionPlan = { target_slot: ranked[0]?.slot.slot_id || null, probe_strategy: '' }
  // V0.2 RAG：Planner 侧提出 KnowledgeNeedProposal（默认克制 R0；缺 key/未开启 → R0）
  const rag = knowledgeNeed.decideKnowledgeNeed({ evidence, item, turnNo: session.turnNo })
  replayEvent(session, {
    event: 'OrchestratorEvent',
    decision: 'PROBE',
    target_slot: actionPlan.target_slot,
    ranked_slots: ranked.slice(0, 5).map((r) => ({ slot: r.slot.slot_id, score: Number(r.score.toFixed(3)) })),
    knowledge_need: rag.need,
    knowledge_need_gap: rag.gap,
    rag_route: rag.need ? rag.route_ceiling : 'R0',
    reason: 'top_evidence_gap'
  })
  // V0.2 PRDM：A06 observe（Planner 前，纯互动信号，不输出行动/诊断/推荐）
  const recentTurns = session.history.filter((h) => h.role === 'teacher').map((h) => h.text)
  const obs = prdmV2.observe({ teacherTurn: trimmed, recentTurns, observedActionFingerprint: agentDecision ? (agentDecision.selected_action_id || '') : '', turnId })
  replayEvent(session, { event: 'PRDMObserveEvent', interaction_read: obs, forbidden_present: prdmV2.FORBIDDEN_OBS.some((f) => obs[f] !== undefined && obs[f] !== null) })
  // V0.2 PRDM：A07 plan（Committed action 之后，绑定 fingerprint；不生成文本、不改专业目标）
  const protectedAction = agentDecision ? { target_slot: agentDecision.primary_target_slot, professional_objective: '', probe_strategy: '' } : null
  const prdm = prdmV2.plan({ protectedAction, actionFingerprint: agentDecision ? agentDecision.selected_action_id : '', teacherTurn: trimmed, recentTurns, evidenceUpdates: updates })
  if (prdm) {
    replayEvent(session, {
      event: 'PRDMPlanEvent',
      dialogue_plan: {
        move: prdm.dialogue_move,
        stance: prdm.stance,
        progress: prdm.local_progress === undefined ? (prdm.local_progress ? prdm.local_progress.status : 'n/a') : (prdm.local_progress && prdm.local_progress.status),
        challenge_level: prdm.challenge_level,
        question_load: prdm.question_load,
        response_dose: prdm.response_dose,
        fingerprint: prdm.protected_action_fingerprint
      }
    })
  }
  const gen = generateQuestion(session.itemId, evidence, session.turnNo, session.history, agentDecision ? agentDecision.primary_target_slot : null, trimmed)
  // 修复能力：教师纠正/澄清/没听懂 → 先用修复/重述问句接住,而不是照常进下一模板
  if (isRepairTurn(trimmed) && !gen.done) {
    gen.question = repairQuestion(trimmed)
    gen.probe_strategy = '澄清修复'
    gen.followup_reason = 'teacher_repair'
    gen.anchor_span = sanitizeExcerpt(trimmed)
  }
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
    return { question: closing, done: true, updates, actionPlan: { action_type: 'STOP_CANDIDATE', target_slot: gen.target_slot || 'ALL' }, replay: session.replay }
  }
  // PRDM 措辞适配：按 DialoguePlan 调整问句（不改专业目标/证据判断）。
  // 只在「未问过的模板」上做措辞；重复用通用问时不叠加前缀，避免逐字重复。
  // A08 Generator 是唯一教师可见文本点；PRDM(prdm) 只提供互动参数，不做措辞改写。
  const genText = gen.question || ''
  const priorQuestions = session.history.filter((h) => h.role === 'ai').map((h) => h.text)
  const checked = checkConstraints(genText, actionPlan, priorQuestions)
  let finalQuestion = genText
  let constraintResult = checked.ok ? 'pass' : 'rewritten'
  if (!checked.ok) {
    // 安全兜底：单问、非诱导、不泄露；用「当前槽未用过的通用追问」，避免固定句循环。
    // 2.6：先全历史逐字去重,选一条尚未问过的;都用尽了才按轮次轮换(最后兜底)。
    const safeBank = [
      '关于这一点，您能再多说一些您是怎么判断的吗？',
      '您最想先帮孩子解决的是哪一件事？',
      '如果换一个更具体的场景，您会怎么处理？'
    ]
    const safeAsked = new Set(priorQuestions.map((q) => String(q).replace(/\s+/g, '')))
    const freshSafe = safeBank.find((q) => !safeAsked.has(String(q).replace(/\s+/g, '')))
    finalQuestion = freshSafe || safeBank[Math.min(session.turnNo % safeBank.length, safeBank.length - 1)]
    replayEvent(session, {
      event: 'ConstraintEvent',
      target_slot: gen.target_slot,
      issues: checked.issues,
      rewritten_to: finalQuestion
    })
  }
  // 2.2/2.1：让 actionPlan 反映 Generator 真正选定的槽与策略（此前 target_slot 取自纯缺口排序 ranked[0]，
  // 与教师可见问题可能不一致——Planner/Gate 目标与最终问题必须对齐）。
  actionPlan.target_slot = gen.target_slot || actionPlan.target_slot
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
    prdm_move: (prdm && prdm.dialogue_move) || 'n/a',
    evidence_before_count: Object.keys(evidenceBefore).length,
    // 2.1：记录本轮问题与教师上一答的承接关系(回放/研究审计用)
    source_turn_id: turnId,
    followup_reason: gen.followup_reason || 'evidence_gap',
    anchor_span: gen.anchor_span || ''
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
