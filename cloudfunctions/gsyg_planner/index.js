// 云函数 gsyg_planner —— TCIM V0.2 A03（AI Agent Planner）+ A04（Decision/Risk Gate）。
//
// 输入（网页经 gsyg_webGateway /call 转发，data 即本 event）：
//   { itemId, teacherModel, evidence, beliefState, candidateActions, llmProfile? }
//     teacherModel     : ContextualTeacherModelSnapshot（fact/belief refs）
//     evidence         : 当前 Canonical Evidence
//     beliefState      : { beliefs, version }
//     candidateActions : 可选，预置候选（缺省由 LLM 生成）
//
// 输出：
//   { ok, decision: AgentDecisionProposal, gate: DecisionGateResult, llmProfile, llmModel, fallback }
//
// 硬约束：AI 只出 Proposal（可 green 选 action）；Gate 只裁决不重做选择；不得改分/写 Evidence/
// 改 Production 五表。G05（能力/人格/动机判定词）+ 泄露（得分/标准答案/评分）服务端拦截。
//
// 环境变量（集中在云函数配置，不进代码/前端）：
//   LLM_TIMEOUT_MS             默认 18000
//   PLANNER_PROFILE            默认 'wxai'（'wxai'|'deepseek'|'openai-compatible'）
//   DEEPSEEK_API_KEY / DEEPSEEK_MODEL / OPENAI_COMPATIBLE_*  —— 同 gsyg_semanticProbe
//   SEC_CHECK=1                开 msgSecCheck v2 scene:4（可选，一般只回传 span/action 文本）
//
// 部署：开发者工具右键本函数 → 上传并部署 → 云端安装依赖。前端由 web/src/services/plannerLLM.js 调用。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const {
  emptyDecision, normalizeDecision, validateDecision, adjudicate
} = require('./planner_core.js');

const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 18000);
const DEFAULT_PROFILE = String(process.env.PLANNER_PROFILE || 'wxai').trim();
const SEC_CHECK_ON = String(process.env.SEC_CHECK || '') === '1';

const LLM_PROFILES = Object.freeze({
  wxai: { type: 'wxai' },
  deepseek: {
    type: 'openai-compatible',
    endpoint: 'https://api.deepseek.com/chat/completions',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    temperature: Number(process.env.DEEPSEEK_TEMPERATURE || 0.1),
    maxTokens: Number(process.env.DEEPSEEK_MAX_TOKENS || 900)
  },
  'openai-compatible': {
    type: 'openai-compatible',
    endpoint: process.env.OPENAI_COMPATIBLE_ENDPOINT || '',
    apiKeyEnv: 'OPENAI_COMPATIBLE_API_KEY',
    model: process.env.OPENAI_COMPATIBLE_MODEL || '',
    temperature: Number(process.env.OPENAI_COMPATIBLE_TEMPERATURE || 0.1),
    maxTokens: Number(process.env.OPENAI_COMPATIBLE_MAX_TOKENS || 900)
  }
});

const VALID_SLOTS_DEFAULT = [];
const TABLE_ALIGNMENT = ['SUPPORT', 'PARTIAL', 'CONFLICT', 'OUT_OF_SCHEMA', 'NO_APPLICABLE_RULE'];

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('LLM 超时 ' + ms + 'ms')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function resolveLLMProfile(event) {
  const requested = String((event && event.llmProfile) || '').trim();
  const id = LLM_PROFILES[requested] ? requested : (LLM_PROFILES[DEFAULT_PROFILE] ? DEFAULT_PROFILE : 'wxai');
  return { id, config: LLM_PROFILES[id] };
}

async function callLLM(config, system, user) {
  if (config.type === 'wxai') return callWxAI(system, user);
  return callOpenAICompatible(config, system, user);
}

async function callWxAI(system, user) {
  const provider = process.env.WXAI_PROVIDER || 'cloudbase';
  const model = process.env.WXAI_MODEL || 'hy3-preview';
  const ai = cloud.ai();
  const m = ai.createModel(provider);
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
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
  const payload = { model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: config.temperature, max_tokens: config.maxTokens };
  const response = await fetch(config.endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey }, body: JSON.stringify(payload)
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

async function drainStream(res) {
  if (!res) return '';
  if (typeof res === 'string') return res;
  if (typeof res.text === 'string') return res.text;
  if (res.textStream && typeof res.textStream[Symbol.asyncIterator] === 'function') { let o = ''; for await (const c of res.textStream) o += (typeof c === 'string' ? c : (c && c.content) || ''); return o; }
  if (res.eventStream && typeof res.eventStream[Symbol.asyncIterator] === 'function') { let o = ''; for await (const ev of res.eventStream) o += extractDelta(ev && ev.data); return o; }
  if (res.dataStream && typeof res.dataStream[Symbol.asyncIterator] === 'function') { let o = ''; for await (const line of res.dataStream) o += extractDelta(line); return o; }
  if (typeof res[Symbol.asyncIterator] === 'function') { let o = ''; for await (const c of res) o += extractDelta(c); return o; }
  return extractText(res);
}
function extractDelta(chunk) {
  if (chunk == null) return '';
  if (typeof chunk === 'string') { const s = chunk.replace(/^data:\s*/, '').trim(); if (!s || s === '[DONE]') return ''; try { return pickContent(JSON.parse(s)); } catch (e) { return s; } }
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

/* ------------------------------ 提示词 ------------------------------ */

function buildSystemPrompt() {
  return [
    '你是一名幼儿园教师专业谈话系统中的 AI Agent Planner。',
    '你会收到教师情境快照（已确认事实、有效信念）、当前证据、以及当前题目的专业候选。',
    '你的任务：比较至少两个合法候选行动，选出一个绿色（低风险、可逆、探查性）的下一专业行动。',
    '',
    '【只做行动提议，绝不做裁决】',
    '你不是评分者。你只回答「此刻最值得做的探查是什么」，不评能力等级、不写分数。',
    '能力等级（level / 得分 / 标准答案 / 专家排序）一律不出现。',
    '',
    '【输出严格 JSON，仅含以下字段】',
    '{"candidate_actions":[],"selected_action_id":"","rejected_action_ids":[],"primary_target_slot":"Q8-S4","supporting_slot_refs":[],"single_cognitive_task":true,"cognitive_task_code":"EXPLAIN_ONE","claimed_table_alignment":"SUPPORT","claimed_risk_level":"LOW","why_this_now":"","prior_disposition":"NEUTRAL","fallback_action_id":null,"exit_condition":"","source_refs":[]}',
    'candidate_actions: 至少 2 个候选的 action_id 列表',
    'selected_action_id: 你选中的一个（绿色低风险）',
    'claimed_table_alignment: SUPPORT|PARTIAL|CONFLICT|OUT_OF_SCHEMA|NO_APPLICABLE_RULE',
    'claimed_risk_level: LOW|MEDIUM|HIGH',
    '',
    '【硬性禁止】',
    '1) 不得判定教师能力/人格/动机（G05）。',
    '2) 不得出现得分/标准答案/专家排序/评分/R-P-G。',
    '3) 只选一个主目标（single_cognitive_task=true），不挑多任务。',
    '4) 优先选 LOW 风险、可逆、探查性行动；不知道就选最保守的。',
    '5) 无信息时给一个空 JSON（selected_action_id:null）。',
    ''
  ].join('\n');
}

function buildUserPrompt(event, validSlotIds) {
  const tm = event.teacherModel || {};
  const evText = Object.keys(event.evidence || {}).map((k) => {
    const s = event.evidence[k] || {};
    return `${k} level=${s.level ?? 0} status=${s.status || 'UNKNOWN'} confidence=${s.confidence ?? 0}`;
  }).join('\n');
  const beliefText = Object.values((event.beliefState && event.beliefState.beliefs) || {}).map((b) => `${b.id}: ${b.claim} (conf=${b.confidence})`).join('\n');
  const candActions = (Array.isArray(event.candidateActions) ? event.candidateActions : []);
  return [
    `【情境题目】${event.itemId || '(未提供)'}`,
    `【有效信念】${beliefText || '(无)'}`,
    `【当前证据】${evText || '(无)'}`,
    `【已确认事实】${(tm.confirmed_fact_refs || []).join(', ') || '(无)'}`,
    `【教师主动议题】${(tm.teacher_agenda_refs || []).join(', ') || '(无)'}`,
    `【预置候选】${candActions.map((c) => c.action_id + '(' + (c.primary_target_slot || '') + ')').join(', ') || '(无，由你生成)'}`,
    '',
    '请输出上述严格 JSON。'
  ].join('\n');
}

/* ------------------------------ 内容安全（可选） ------------------------------ */

async function secCheck(text) {
  if (!SEC_CHECK_ON) return { pass: true };
  try {
    const res = await cloud.openapi.security.msgSecCheck({ content: String(text || '').slice(0, 2500), version: 2, scene: 4 });
    return { pass: res && res.result && res.result.suggest === 'pass' };
  } catch (e) { return { pass: true }; }
}

/* ------------------------------ 主入口 ------------------------------ */

exports.main = async (event) => {
  event = event || {};
  const validSlotIds = new Set(Array.isArray(event.validSlotIds) ? event.validSlotIds : VALID_SLOTS_DEFAULT);
  const selected = resolveLLMProfile(event);
  const system = buildSystemPrompt();
  const user = buildUserPrompt(event, validSlotIds);

  let fallback = '';
  let decision = emptyDecision();
  let gate = null;

  try {
    const raw = await withTimeout(callLLM(selected.config, system, user), LLM_TIMEOUT_MS);
    if (!raw) throw new Error('LLM 空响应');
    const obj = parseModelJSON(raw);
    if (!obj) throw new Error('LLM 未返回严格JSON');
    const v = validateDecision(obj, { validSlotIds });
    if (!v.ok) {
      // LLM 越界（G05/泄露/结构）→ 用保守空决策，Gate 会 REJECT
      fallback = 'planner_llm_invalid:' + v.errors.join(';');
      decision = v.proposal;
    } else {
      decision = v.proposal;
    }
  } catch (e) {
    fallback = 'planner_llm_error:' + (e && e.message || '');
    decision = emptyDecision();
  }

  // A04：确定性 Risk Gate 裁决（只在决策合法时给出 meaningful gate）
  gate = adjudicate(decision, {});

  // 内容安全（可选）
  const sec = await secCheck((decision.why_this_now || '') + ' ' + (decision.primary_target_slot || ''));
  if (!sec.pass) fallback = fallback || 'msgSecCheck_failed';

  return {
    ok: true,
    decision,
    gate,
    fallback,
    llmProfile: selected.id,
    llmModel: selected.config.model || '',
    audits: { fallback, table_alignment: decision.claimed_table_alignment, risk_level: decision.claimed_risk_level }
  };
};
