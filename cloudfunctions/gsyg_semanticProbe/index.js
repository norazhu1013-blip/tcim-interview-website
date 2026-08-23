// 云函数 gsyg_semanticProbe —— TCIM A01 语义预筛（Step 1）。
// 作用：对教师这一轮的原话做「语义理解与证据抽取」的 Proposal 输出，
//       即 What the teacher meant。LLM 只出 Proposal，**不写**证据状态、不判能力等级。
//
// 入参（由网页经 gsyg_webGateway /call 转发，data 即本 event）：
//   { itemId, teacherTurn, turnId, anchors, evidenceSummary, questionTitle, llmProfile? }
//     anchors        : [{ slot_id, level_1..3, conflict_evidence }] —— 供模型按锚点定位
//     evidenceSummary: 当前槽的点位（只作为上下文，模型不得据此给结论）
//
// 返回：
//   { ok, proposal: EvidenceAnalysisProposal, llmProfile, llmModel, fallback }
//     proposal.candidate_spans[]     { text, slot_id?, span_type, confidence }   （span 必须回指原话）
//     proposal.candidate_slots[]     { slot_id, relevance }
//     proposal.conflict_candidates[] { slot_id, reason }
//     proposal.false_evidence_flags[]{ slot_id, reason }
//     proposal.no_change_reasons[]   { slot_id, reason }
//     proposal.uncertainty          0..1
//
// 硬约束（与 gsyg_interviewChat 一致，服务端再拦一轮）：
//   G01 教师原话先保存再调模型；此处只读、不落库。
//   G03 模型输出严格 JSON；自由文本理由不能用作状态写入依据。
//   G04/spans 必须回指教师原话；凡无法回指 → 丢弃该 span。
//   G05 不得把能力/人格/动机从短答/犹豫/礼貌/流畅推断出来（词表拦 + 提示词禁）。
//   LLM 失败/低置信/无合法 span → fallback 返回空 proposal，不丢失、不猜测。
//
// 环境变量（可选，全部集中在云函数配置，不进代码/前端）：
//   LLM_TIMEOUT_MS             默认 18000（语义分析需真实理解，给足但不拖沓）
//   SEMANTIC_PROFILE           默认 'wxai'（'wxai' | 'deepseek' | 'openai-compatible'）
//   DEEPSEEK_API_KEY / DEEPSEEK_MODEL / OPENAI_COMPATIBLE_*  —— 同 gsyg_interviewChat
//   SEC_CHECK=1                开 msgSecCheck v2 scene:4 机审（可选，语义层一般只要 span 不回指教师语）
//
// 部署：开发者工具右键本函数 → 上传并部署 → 云端安装依赖。前端由 web/src/services/semanticLLM.js 调用。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 18000);
const DEFAULT_PROFILE = String(process.env.SEMANTIC_PROFILE || 'wxai').trim();
const SEC_CHECK_ON = String(process.env.SEC_CHECK || '') === '1';

// LLM 配置白名单。前端只能传 llmProfile 选这里已有的配置，不能传 endpoint/key。
const LLM_PROFILES = Object.freeze({
  wxai: { type: 'wxai' },
  deepseek: {
    type: 'openai-compatible',
    endpoint: 'https://api.deepseek.com/chat/completions',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    temperature: Number(process.env.DEEPSEEK_TEMPERATURE || 0.1),
    maxTokens: Number(process.env.DEEPSEEK_MAX_TOKENS || 700)
  },
  'openai-compatible': {
    type: 'openai-compatible',
    endpoint: process.env.OPENAI_COMPATIBLE_ENDPOINT || '',
    apiKeyEnv: 'OPENAI_COMPATIBLE_API_KEY',
    model: process.env.OPENAI_COMPATIBLE_MODEL || '',
    temperature: Number(process.env.OPENAI_COMPATIBLE_TEMPERATURE || 0.1),
    maxTokens: Number(process.env.OPENAI_COMPATIBLE_MAX_TOKENS || 700)
  }
});

const EMPTY_PROPOSAL = {
  proposal_type: 'EvidenceAnalysisProposal',
  candidate_spans: [],
  candidate_slots: [],
  conflict_candidates: [],
  false_evidence_flags: [],
  uncertainty: 0,
  no_change_reasons: [],
  source_turn: null,
  provider_version: 'offline-v0.1'
};

function emptyProposal(turn, version) {
  return Object.assign({}, EMPTY_PROPOSAL, { source_turn: turn, provider_version: version || 'offline-v0.1' });
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('LLM 超时 ' + ms + 'ms')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
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

/* ------------------------------ LLM 调用 ------------------------------ */

function resolveLLMProfile(event) {
  const requested = String((event && event.llmProfile) || '').trim();
  const id = LLM_PROFILES[requested] ? requested : (LLM_PROFILES[DEFAULT_PROFILE] ? DEFAULT_PROFILE : 'wxai');
  return { id, config: LLM_PROFILES[id] };
}

async function callLLM(config, system, user) {
  if (config.type === 'wxai') return callWxAI(system, user);
  return callOpenAICompatible(config, system, user);
}

// 直接走 wx-server-sdk 的 cloud.ai（与 gsyg_interviewChat 同款）
async function callWxAI(system, user, preferProvider) {
  const provider = preferProvider || process.env.WXAI_PROVIDER || 'cloudbase';
  const model = process.env.WXAI_MODEL || 'hy3-preview';
  const ai = cloud.ai();
  const m = ai.createModel(provider);
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
  if (typeof m.generateText === 'function') {
    const res = await m.generateText({ model, messages, data: { model, messages } });
    const out = typeof res === 'string' ? res : (res && res.text);
    if (out) return out;
  }
  if (typeof m.streamText === 'function') {
    const res = await m.streamText({ model, messages, data: { model, messages } });
    return await drainStream(res);
  }
  throw new Error('模型 ' + model + '(provider=' + provider + ') 未提供 generateText/streamText');
}

async function callOpenAICompatible(config, system, user) {
  if (!config.endpoint) throw new Error('llm_profile_missing_endpoint:' + config.id);
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) throw new Error('llm_profile_missing_api_key:' + config.apiKeyEnv);
  if (!config.model) throw new Error('llm_profile_missing_model:' + config.id);
  const payload = {
    model: config.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: config.temperature,
    max_tokens: config.maxTokens
  };
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(async () => ({ text: await response.text().catch(() => '') }));
  if (!response.ok) {
    const msg = body && (body.error && (body.error.message || body.error.code) || body.message || body.text);
    throw new Error('third_llm_http_' + response.status + ':' + String(msg || '').slice(0, 200));
  }
  const text = extractText(body);
  if (!text) throw new Error('third_llm_empty_response:' + config.id);
  return text;
}

// 兼容多种返回形态：dataStream/eventStream/textStream/AsyncIterable
async function drainStream(res) {
  if (!res) return '';
  if (typeof res === 'string') return res;
  if (typeof res.text === 'string') return res.text;
  if (res.textStream && typeof res.textStream[Symbol.asyncIterator] === 'function') {
    let out = '';
    for await (const chunk of res.textStream) out += (typeof chunk === 'string' ? chunk : (chunk && chunk.content) || '');
    return out;
  }
  if (res.eventStream && typeof res.eventStream[Symbol.asyncIterator] === 'function') {
    let out = '';
    for await (const ev of res.eventStream) out += extractDelta(ev && ev.data);
    return out;
  }
  if (res.dataStream && typeof res.dataStream[Symbol.asyncIterator] === 'function') {
    let out = '';
    for await (const line of res.dataStream) out += extractDelta(line);
    return out;
  }
  if (typeof res[Symbol.asyncIterator] === 'function') {
    let out = '';
    for await (const chunk of res) out += extractDelta(chunk);
    return out;
  }
  return extractText(res);
}

function extractDelta(chunk) {
  if (chunk == null) return '';
  if (typeof chunk === 'string') {
    const s = chunk.replace(/^data:\s*/, '').trim();
    if (!s || s === '[DONE]') return '';
    try { return pickContent(JSON.parse(s)); } catch (e) { return s; }
  }
  if (typeof chunk === 'object') return pickContent(chunk);
  return '';
}

function pickContent(j) {
  if (!j) return '';
  if (typeof j === 'string') return j;
  const c = j.choices && j.choices[0];
  if (c) return (c.delta && c.delta.content) || (c.message && c.message.content) || c.text || '';
  return j.content || j.text || j.output || '';
}

function extractText(res) {
  if (!res) return '';
  const text = res.content && res.content.text;
  if (typeof text === 'string') return text;
  const c = res.choices && res.choices[0];
  if (c) return c.message && c.message.content;
  return res.text || res.output || String(res);
}

/* ------------------------------ JSON 解析 + 规范化 + 校验 ------------------------------ */

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

// 服务端再拦 G04/G05：spans 必须回指原话；不得出现能力/人格/动机判定词。
function validateProposal(proposal, teacherTurn) {
  const errors = [];
  const spans = Array.isArray(proposal.candidate_spans) ? proposal.candidate_spans : [];
  const validSpans = [];
  for (const s of spans) {
    const text = s && s.text;
    if (!text || !teacherTurn.includes(text)) { continue; } // 不能回指原话 → 丢弃
    const type = ['supporting', 'conflict', 'false'].includes(s.span_type) ? s.span_type : 'supporting';
    validSpans.push({ text, slot_id: s.slot_id || null, span_type: type, confidence: typeof s.confidence === 'number' ? s.confidence : 0.3 });
  }
  proposal.candidate_spans = validSpans;
  const judgeRe = /能力|人格|动机|心理|性格|智力水平|属于.{0,3}(高|中|低)能力/;
  const joined = JSON.stringify(proposal);
  if (judgeRe.test(joined)) errors.push('G05: 出现能力/人格/动机判定词');
  // 置信度过低（<0.25）的 span 语义层不应引为候选
  proposal.candidate_spans = proposal.candidate_spans.filter((s) => s.confidence >= 0.25);
  return { ok: errors.length === 0, errors, proposal };
}

/* ------------------------------ 内容安全（可选） ------------------------------ */

async function secCheck(text) {
  if (!SEC_CHECK_ON) return { pass: true };
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      content: String(text || '').slice(0, 2500),
      version: 2,
      scene: 4
    });
    return { pass: res && res.result && res.result.suggest === 'pass' };
  } catch (e) {
    // 机审失败不阻断（语义层内部处理）；如需严格可在云函数配置开。
    return { pass: true };
  }
}

/* ------------------------------ 主入口 ------------------------------ */

exports.main = async (event) => {
  event = event || {};
  const teacherTurn = String(event.teacherTurn || '').trim();
  const anchors = Array.isArray(event.anchors) ? event.anchors : [];
  const evidenceSummary = event.evidenceSummary || {};
  const selected = resolveLLMProfile(event);
  const system = buildSystemPrompt();
  const user = buildUserPrompt(event, anchors, evidenceSummary);

  let fallback = '';
  let proposal = emptyProposal(teacherTurn, 'semantic-v0.1');
  let llmRaw = '';

  try {
    const raw = await withTimeout(callLLM(selected.config, system, user), LLM_TIMEOUT_MS);
    if (!raw) throw new Error('LLM 空响应');
    llmRaw = raw;
    const obj = parseModelJSON(raw);
    if (!obj) throw new Error('LLM 未返回严格JSON');
    const normalized = normalizeProposal(obj);
    const { ok, errors, proposal: cleaned } = validateProposal(normalized, teacherTurn);
    // 即便 G05 判定词出现，也保留已清洗的 spans（它们已回指原话且非判定词）；只把整条打上 invalid 标记。
    proposal = cleaned;
    if (!ok) fallback = 'G05_violation:' + errors.join(';');
  } catch (e) {
    fallback = 'semantic_llm_error:' + (e && e.message || '');
    proposal = emptyProposal(teacherTurn, 'semantic-v0.1'); // 失败 → 空 proposal，不丢回答、不猜测
  }

  // 服务端再对最终 spans 做一次内容安全（可选）
  const spansText = (proposal.candidate_spans || []).map((s) => s.text).join(' ');
  const sec = await secCheck(spansText);
  if (!sec.pass) fallback = fallback || 'msgSecCheck_failed';

  return {
    ok: Boolean(proposal),
    proposal,
    fallback,
    llmProfile: selected.id,
    llmModel: selected.config.model || '',
    audits: {
      llmRaw_chars: llmRaw.length,
      fallback,
      provider_version: proposal.provider_version
    }
  };
};
