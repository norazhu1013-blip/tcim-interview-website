'use strict';

/**
 * semantic_core.js —— TCIM A01 语义预筛的纯逻辑层（无 wx-server-sdk / 无网络 I/O）。
 *
 * 由 `gsyg_semanticProbe/index.js` require，也供本地测试直接驱动。
 * 只处理提示词构造 + 模型返回的 JSON 解析 + 规范化 + G04/G05 校验。
 * LLM 的 I/O（fetch / cloud.ai）、SEC_CHECK、云函数包装都在 index.js。
 *
 * 这样做的目的（对齐项目惯例，如 gsyg_selectFinal 的 advisor_port.js）：
 *   让「LLM 输出 → 解析 → 校验 → Proposal」整条决策链可以脱离云环境在本机验证，
 *   开发环境无 LLM API Key 时也能用伪造响应跑通。
 */

// 允许的候选 span 标签
const SPAN_TYPES = ['supporting', 'conflict', 'false'];
// G05：能力/人格/动机判定词（出现即整条 Proposal 打 invalid 标记，但清洗后的 spans 保留）
const JUDGE_RE = /能力|人格|动机|心理|性格|智力水平|属于.{0,3}(高|中|低)能力/;

const EMPTY_PROPOSAL = Object.freeze({
  proposal_type: 'EvidenceAnalysisProposal',
  candidate_spans: [],
  candidate_slots: [],
  conflict_candidates: [],
  false_evidence_flags: [],
  uncertainty: 0,
  no_change_reasons: [],
  source_turn: null,
  provider_version: 'semantic-v0.1'
});

function emptyProposal(turn, version) {
  return Object.assign({}, EMPTY_PROPOSAL, {
    source_turn: turn || null,
    provider_version: version || 'semantic-v0.1'
  });
}

/* ------------------------------ 提示词 ------------------------------ */

function buildSystemPrompt() {
  return [
    '你是一名幼儿园教师专业谈话系统中的语义预筛层。',
    '你会收到教师某一轮回答的原话，以及当前题目的证据项（锚点描述）。',
    '你的任务：判断教师这段话里**关于这些证据项**透出了哪些候选信息。',
    '',
    '【只做语义预筛，绝不做裁决】',
    '你不是评分者。你只回答「教师可能表达了什么」，不回答「这算几级」。',
    '能力等级（level/confidence/得分/标准答案）一律不出现。',
    '',
    '【输出为严格 JSON，仅含以下字段】',
    '{"candidate_spans":[],"candidate_slots":[],"conflict_candidates":[],"false_evidence_flags":[],"no_change_reasons":[],"uncertainty":0}',
    'candidate_spans: [{ "text":"<教师原话中真实出现的片段>", "slot_id":"Q1-S2", "span_type":"supporting|conflict|false", "confidence":0.0-1.0 }]',
    '  规则：text 必须是教师原话的**逐字子串**；span_type 只能三种之一；不确定就 low confidence。',
    'candidate_slots: [{ "slot_id":"Q1-S2", "relevance":"low|medium|high" }]',
    'conflict_candidates: [{ "slot_id":"Q1-S5", "reason":"<一句可审计原因>" }]',
    'false_evidence_flags: [{ "slot_id":"Q1-S1", "reason":"<为何可能空话/泛泛>" }]',
    'no_change_reasons: [{ "slot_id":"Q1-S1", "reason":"<为何本轮无证据增益>" }]',
    'uncertainty: 0-1，仅表示你本轮语义判断的不确定度。',
    '',
    '【硬性禁止】',
    '1) 不得判定教师「能力高/中/低」「人格」「动机」「心理状态」——这是确定性引擎的事（G05）。',
    '2) 不得因为教师话短、犹豫、客气、流畅而推断任何能力。',
    '3) 不得出现 level、confidence、分数、标准答案、专家排序。',
    '4) 不得编造教师没说的片段；无法定位就留空。',
    '5) 教师原话是只读参考；没有可信证据时，返回一个全空 JSON（candidate_spans:[]）。',
    ''
  ].join('\n');
}

function buildUserPrompt(event, anchors, evidenceSummary) {
  const teacherTurn = String(event.teacherTurn || '').trim() || '(本轮教师未提供输入)';
  const anchorsText = (anchors || []).map((a) => {
    const lv = [a.level_2, a.level_3].filter(Boolean).join('；');
    const conflict = a.conflict_evidence ? ' [冲突线索:' + a.conflict_evidence + ']' : '';
    return `${a.slot_id}: ${lv}${conflict}`;
  }).join('\n');
  const evText = Object.keys(evidenceSummary || {}).map((k) => {
    const s = evidenceSummary[k] || {};
    return `${k} level=${s.level ?? 0} status=${s.status || 'UNKNOWN'} confidence=${s.confidence ?? 0}`;
  }).join('\n');
  return [
    `【情境】${event.questionTitle || '(未提供)'}`,
    `【当前证据摘要】${evText || '(无)'}`,
    '',
    `【教师原话】${teacherTurn}`,
    '',
    '【证据锚点】',
    anchorsText || '(无锚点，请只基于教师原话语义判断是否出现' +
      '「理解游戏生成/风险判断/介入阈值/规则协商」等与本题相关的候选意图)',
    '',
    '请输出上述严格 JSON。'
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

function normalizeProposal(proposal) {
  const p = proposal && typeof proposal === 'object' ? proposal : {};
  return {
    proposal_type: p.proposal_type || 'EvidenceAnalysisProposal',
    candidate_spans: Array.isArray(p.candidate_spans) ? p.candidate_spans : [],
    candidate_slots: Array.isArray(p.candidate_slots) ? p.candidate_slots : [],
    conflict_candidates: Array.isArray(p.conflict_candidates) ? p.conflict_candidates : [],
    false_evidence_flags: Array.isArray(p.false_evidence_flags) ? p.false_evidence_flags : [],
    uncertainty: typeof p.uncertainty === 'number' ? p.uncertainty : 0,
    no_change_reasons: Array.isArray(p.no_change_reasons) ? p.no_change_reasons : [],
    source_turn: p.source_turn || null,
    provider_version: p.provider_version || 'semantic-v0.1'
  };
}

/**
 * 服务端 G04/G05 校验：spans 必须回指原话；不得出现能力/人格/动机判定词。
 * 返回 { ok, errors, proposal }，proposal 是清洗后的合格形状（非法 span 已剔除）。
 */
function validateProposal(proposal, teacherTurn) {
  const errors = [];
  const normalized = normalizeProposal(proposal);
  const spans = Array.isArray(normalized.candidate_spans) ? normalized.candidate_spans : [];
  const validSpans = [];
  for (const s of spans) {
    const text = s && s.text;
    if (!text || !teacherTurn.includes(text)) { continue; } // 不能回指原话 → 丢弃
    const type = SPAN_TYPES.includes(s.span_type) ? s.span_type : 'supporting';
    validSpans.push({
      text,
      slot_id: s.slot_id || null,
      span_type: type,
      confidence: typeof s.confidence === 'number' ? s.confidence : 0.3
    });
  }
  normalized.candidate_spans = validSpans;
  // 置信度过低（<0.25）的 span 语义层不应引为候选
  normalized.candidate_spans = normalized.candidate_spans.filter((s) => s.confidence >= 0.25);
  const joined = JSON.stringify(normalized);
  if (JUDGE_RE.test(joined)) errors.push('G05: 出现能力/人格/动机判定词');
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
  SPAN_TYPES,
  JUDGE_RE
};
