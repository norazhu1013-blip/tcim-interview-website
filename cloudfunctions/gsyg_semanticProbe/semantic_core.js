'use strict';

/**
 * semantic_core.js —— TCIM A01 语义分析的纯逻辑层（无 wx-server-sdk / 无网络 I/O）。
 *
 * 由 `gsyg_semanticProbe/index.js` require，也供本地测试直接驱动。
 * 只处理提示词构造 + 模型返回的 JSON 解析 + 规范化 + G04/G05 校验。
 * LLM 的 I/O（fetch / cloud.ai）、SEC_CHECK、云函数包装都在 index.js。
 *
 * 对齐权威示例（`docs/tcim/Q8_AI_EXAMPLE_REFERENCE.txt`）的 Proposal 形状：
 *   {
 *     "candidate_spans": [ { "text": "<教师原话逐字片段>", "candidate_slots": ["Q8-S1"] } ],
 *     "slot_evidence_proposals": [
 *       { "slot_id": "Q8-S3", "proposed_level": 2, "confidence": 0.86,
 *         "supporting_spans": ["不会马上示范", "才会给一点提示"] }
 *     ],
 *     "uncertainty": ["<一句待澄清>"],
 *     "conflict_candidates": [ { "slot_id": "Q8-S5", "reason": "..." } ]
 *   }
 *
 * AI 只出 Proposal（语义提议权），Ontology 负责验证 + 提交（状态所有权）。
 * G04：每个 supporting_span / candidate_span.text 必须逐字回指教师原话。
 * G05：不得出现能力/人格/动机/心理状态的直接判定词。
 */

// G05：能力/人格/动机/心理判定词（出现即整条 Proposal 标 invalid，清洗后的 spans 保留）
const JUDGE_RE = /能力|人格|动机|心理|性格|智力水平|属于.{0,3}(高|中|低)能力/;

const EMPTY_PROPOSAL = Object.freeze({
  proposal_type: 'EvidenceAnalysisProposal',
  candidate_spans: [],
  slot_evidence_proposals: [],
  conflict_candidates: [],
  false_evidence_flags: [],
  uncertainty: [],
  no_change_reasons: [],
  source_turn: null,
  provider_version: 'semantic-v0.2'
});

function emptyProposal(turn, version) {
  return Object.assign({}, EMPTY_PROPOSAL, {
    source_turn: turn || null,
    provider_version: version || 'semantic-v0.2'
  });
}

/* ------------------------------ 提示词 ------------------------------ */

function buildSystemPrompt() {
  return [
    '你是一名幼儿园教师专业谈话系统中的专业语义分析层。',
    '你会收到教师某一轮回答的原话、当前题目的证据项（锚点描述）、以及各 Slot 当前的证据状态。',
    '你的任务：判断教师这段话里**关于这些证据项**透出了哪些候选专业信息，并给出每个相关 Slot 的等级建议。',
    '',
    '【只做语义提议，绝不做裁决】',
    '你不是评分者。你只回答「教师可能表达了什么、可能对应哪个证据等级建议」，不回答「这就算几级」。',
    '能力等级（level / 得分 / 标准答案 / 专家排序）一律不出现。',
    '',
    '【输出为严格 JSON，仅含以下字段】',
    '{"candidate_spans":[],"slot_evidence_proposals":[],"conflict_candidates":[],"false_evidence_flags":[],"no_change_reasons":[],"uncertainty":[]}',
    '',
    'candidate_spans: [{"text":"<教师原话的逐字片段>", "candidate_slots":["Q8-S1","Q8-S4"]}]',
    '  规则：text 必须是教师原话的**逐字子串**；candidate_slots 列出该片段可能涉及的 Slot（一次可多 Slot）。',
    '',
    'slot_evidence_proposals: [{"slot_id":"Q8-S3","proposed_level":2,"confidence":0.86,"supporting_spans":["不会马上示范","才会给一点提示"]}]',
    '  规则：proposed_level 0-3（按 Anchor 等级标准判断）；supporting_spans 每项必须是教师原话逐字子串；confidence 0-1。',
    '  只对你真正读出的证据给出建议；读不出就是 0 或省略该 slot。',
    '',
    'conflict_candidates: [{"slot_id":"Q8-S5","reason":"<为何疑似与前文冲突>"}]',
    'false_evidence_flags: [{"slot_id":"Q8-S1","reason":"<为何可能空话/泛泛/伪证据>"}]',
    'no_change_reasons: [{"slot_id":"Q8-S1","reason":"<为何本轮无证据增益>"}]',
    'uncertainty: ["<一句尚不清楚、需要澄清的判断>"]',
    '',
    '【硬性禁止】',
    '1) 不得判定教师「能力高/中/低」「人格」「动机」「心理状态」——这是确定性引擎/专业评审的事（G05）。',
    '2) 不得因为教师话短、犹豫、客气、礼貌、流畅而推断任何能力。',
    '3) 不得出现 level、confidence、分数、标准答案、专家排序、R/P/G。',
    '4) 不得编造教师没说的片段；无法定位就留空。',
    '5) 教师原话是只读参考；没有可信证据时，返回全空 JSON（candidate_spans:[] ，slot_evidence_proposals:[]）。',
    ''
  ].join('\n');
}

function buildUserPrompt(event, anchors, evidenceSummary) {
  const teacherTurn = String(event.teacherTurn || '').trim() || '(本轮教师未提供输入)';
  const anchorsText = (anchors || []).map((a) => {
    const lv = [a.level_0, a.level_1, a.level_2, a.level_3].filter(Boolean)
      .map((t, i) => `L${i}: ${t}`).join('\n       ');
    const conflict = a.conflict_evidence ? ' [冲突线索:' + a.conflict_evidence + ']' : '';
    return `${a.slot_id}:\n       ${lv}${conflict}`;
  }).join('\n');
  const evText = Object.keys(evidenceSummary || {}).map((k) => {
    const s = evidenceSummary[k] || {};
    return `${k} level=${s.level ?? 0} status=${s.status || 'UNKNOWN'} confidence=${s.confidence ?? 0}`;
  }).join('\n');
  return [
    `【情境】${event.questionTitle || '(未提供)'}`,
    `【当前证据状态】${evText || '(无)'}`,
    '',
    `【教师原话】${teacherTurn}`,
    '',
    '【证据锚点（0-3 级描述）】',
    anchorsText || '(无锚点，请只基于教师原话语义判断…)',
    '',
    '请输出上述严格 JSON，只基于教师原话与锚点，不要臆测。'
  ].join('\n');
}

/* ------------------------------ JSON 解析 ------------------------------ */

function parseModelJSON(text) {
  if (!text) return null;
  const raw = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const tryParse = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
  let obj = tryParse(raw);
  if (obj) return obj;
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) obj = tryParse(m[0]);
  return obj;
}

/** 规范化 Proposal：缺失的数组字段补空，非法值归零/留空（LLM 输出天然不完整）。 */
function normalizeProposal(proposal) {
  const p = proposal && typeof proposal === 'object' ? proposal : {};
  return {
    proposal_type: p.proposal_type || 'EvidenceAnalysisProposal',
    candidate_spans: Array.isArray(p.candidate_spans) ? p.candidate_spans : [],
    slot_evidence_proposals: Array.isArray(p.slot_evidence_proposals) ? p.slot_evidence_proposals : [],
    conflict_candidates: Array.isArray(p.conflict_candidates) ? p.conflict_candidates : [],
    false_evidence_flags: Array.isArray(p.false_evidence_flags) ? p.false_evidence_flags : [],
    uncertainty: Array.isArray(p.uncertainty) ? p.uncertainty : [],
    no_change_reasons: Array.isArray(p.no_change_reasons) ? p.no_change_reasons : [],
    source_turn: p.source_turn || null,
    provider_version: p.provider_version || 'semantic-v0.2'
  };
}

const clamp01 = (n) => Math.max(0, Math.min(1, typeof n === 'number' ? n : 0));
const clampLevel = (n) => (Number.isInteger(n) && n >= 0 && n <= 3 ? n : 0);

/**
 * G04/G05 校验 + 清洗：每个 span 逐字回指教师原话；proposed_level 0-3；confidence 0-1；
 * 出现能力/人格判定词则标 invalid。
 * @param {object} proposal 已 normalize 的 Proposal
 * @param {string} teacherTurn 教师原话
 * @param {Set<string>} [validSlotIds] 当前题允许的 slot 集合；提供时 slot_id 必须存在
 * @returns {{ ok, errors, proposal }}
 */
function validateProposal(proposal, teacherTurn, validSlotIds) {
  const errors = [];
  const normalized = normalizeProposal(proposal);

  // candidate_spans：text 必须逐字回指原话；candidate_slots 过滤到合法 slot。
  const cleanSpans = [];
  for (const s of (normalized.candidate_spans || [])) {
    const text = s && s.text;
    if (!text || !teacherTurn.includes(text)) { errors.push(`candidate_span「${text || ''}」未回指教师原话`); continue; }
    const slots = (Array.isArray(s.candidate_slots) ? s.candidate_slots : [])
      .filter((id) => !validSlotIds || validSlotIds.has(id));
    cleanSpans.push({ text, candidate_slots: slots });
  }
  normalized.candidate_spans = cleanSpans;

  // slot_evidence_proposals：slot_id 合法、proposed_level 0-3、supporting_spans 逐字回指、confidence 0-1。
  const cleanSlots = [];
  for (const sp of (normalized.slot_evidence_proposals || [])) {
    const slotId = sp && sp.slot_id;
    if (!slotId) { errors.push('slot_evidence_proposal 缺 slot_id'); continue; }
    if (validSlotIds && !validSlotIds.has(slotId)) { errors.push(`slot_evidence_proposal slot 「${slotId}」不存在于本题`); continue; }
    const supporting = (Array.isArray(sp.supporting_spans) ? sp.supporting_spans : [])
      .filter((t) => t && teacherTurn.includes(t));
    // 若提供了 supporting_spans 但全部回指失败 → 该条无依据，视为非法
    if (Array.isArray(sp.supporting_spans) && sp.supporting_spans.length && supporting.length === 0) {
      errors.push(`slot_evidence_proposal「${slotId}」supporting_spans 未回指教师原话`); continue;
    }
    cleanSlots.push({
      slot_id: slotId,
      proposed_level: clampLevel(sp.proposed_level),
      confidence: clamp01(sp.confidence),
      supporting_spans: supporting,
      mechanism: sp.mechanism || null,
      reasoning: sp.reasoning || null
    });
  }
  normalized.slot_evidence_proposals = cleanSlots;

  // 其余审计字段：只保留合法项
  normalized.conflict_candidates = (normalized.conflict_candidates || []).filter(
    (c) => c && c.slot_id && (!validSlotIds || validSlotIds.has(c.slot_id))
  );
  normalized.false_evidence_flags = (normalized.false_evidence_flags || []).filter(
    (f) => f && f.slot_id && (!validSlotIds || validSlotIds.has(f.slot_id))
  );
  normalized.no_change_reasons = (normalized.no_change_reasons || []).filter(
    (n) => n && n.slot_id && (!validSlotIds || validSlotIds.has(n.slot_id))
  );
  normalized.uncertainty = (normalized.uncertainty || []).filter((u) => typeof u === 'string' && u.trim());

  // G05：任何字段出现能力/人格/动机判定词 → invalid
  const joined = JSON.stringify(normalized);
  if (JUDGE_RE.test(joined)) errors.push('G05: 出现能力/人格/动机直接判定词');

  return { ok: errors.length === 0, errors, proposal: normalized };
}

module.exports = {
  EMPTY_PROPOSAL,
  emptyProposal,
  buildSystemPrompt,
  buildUserPrompt,
  parseModelJSON,
  normalizeProposal,
  validateProposal,
  JUDGE_RE
};
