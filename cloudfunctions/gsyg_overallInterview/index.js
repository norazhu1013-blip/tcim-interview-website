'use strict';

const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 70000 });

const MODEL = process.env.OVERALL_WXAI_MODEL || process.env.WXAI_MODEL || 'deepseek-v4-flash-0731';
const PROVIDER = process.env.OVERALL_WXAI_PROVIDER || process.env.WXAI_PROVIDER || 'cloudbase';
const PROMPT_VERSION = 'tcim-overall-interview/2026-09-17-v2';

function equal(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 20 && crypto.timingSafeEqual(a, b);
}

function authorized(event) {
  const gateway = event?.__gsygGateway;
  return equal(gateway?.token, process.env.GSYG_WEB_GATEWAY_TOKEN)
    && gateway?.identityType === 'web_account'
    && /^web:overall_[a-f0-9]{24}$/.test(gateway?.actor || '');
}

function aiClient() {
  if (cloud.extend?.AI?.createModel) return cloud.extend.AI;
  if (typeof cloud.ai === 'function') return cloud.ai();
  throw new Error('cloud_ai_unavailable');
}

function extractText(result) {
  return String(result?.text || result?.output || result?.choices?.[0]?.message?.content || '').trim();
}

function pickContent(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const choice = value.choices?.[0];
  if (choice) return choice.delta?.content || choice.message?.content || choice.text || '';
  return value.content || value.text || value.output || value.data?.output || '';
}

function extractDelta(chunk) {
  if (chunk == null) return '';
  if (typeof chunk === 'string') {
    const text = chunk.replace(/^data:\s*/, '').trim();
    if (!text || text === '[DONE]') return '';
    try { return pickContent(JSON.parse(text)); } catch { return text; }
  }
  return pickContent(chunk);
}

async function drain(stream) {
  if (!stream) return '';
  if (typeof stream === 'string') return stream;
  if (typeof stream.text === 'string') return stream.text;
  if (stream.textStream?.[Symbol.asyncIterator]) {
    let output = '';
    for await (const chunk of stream.textStream) output += typeof chunk === 'string' ? chunk : pickContent(chunk);
    return output.trim();
  }
  if (stream.eventStream?.[Symbol.asyncIterator]) {
    let output = '';
    for await (const event of stream.eventStream) output += extractDelta(event?.data ?? event);
    return output.trim();
  }
  if (stream.dataStream?.[Symbol.asyncIterator]) {
    let output = '';
    for await (const chunk of stream.dataStream) output += extractDelta(chunk);
    return output.trim();
  }
  let output = '';
  if (stream[Symbol.asyncIterator]) {
    for await (const chunk of stream) output += extractDelta(chunk);
  }
  return output.trim() || extractText(stream);
}

async function generate(system, user) {
  const ai = aiClient();
  let model;
  try { model = ai.createModel(PROVIDER); } catch { model = ai.createModel(MODEL); }
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  const request = { model: MODEL, messages, data: { model: MODEL, messages } };
  // CloudBase AI 的稳定主接口是 streamText。旧实现先等待 generateText 失败、
  // 再重新调用 streamText，最坏会把一次教师追问变成两次完整模型请求。
  // 这里每轮只发起一次上游生成，同时完整兼容 text/event/data stream 返回形态。
  if (typeof model.streamText === 'function') {
    const output = await drain(await model.streamText(request));
    if (!output) throw new Error('model_stream_empty');
    return output;
  }
  if (typeof model.generateText === 'function') {
    const output = extractText(await model.generateText(request));
    if (!output) throw new Error('model_generation_empty');
    return output;
  }
  throw new Error('model_generation_unavailable');
}

function compactItems(items) {
  return (Array.isArray(items) ? items : []).slice(0, 30).map((item) => ({
    itemId: item.canonicalItemId || item.itemId,
    sourceItemId: item.itemId,
    title: item.title,
    stem: item.stem,
    indicator: item.indicator,
    ranking: item.ranking,
    topOption: item.topOption,
    topOptionText: item.topOptionText,
    options: item.options,
    process: item.process
  }));
}

const SYSTEM = `你是幼儿园教师专业能力研究中的访谈者。目标不是教教师答题，也不是评价、表扬或纠正教师，而是通过约10分钟的自然对话，弄清教师在多道情境题中的真实判断、权衡、边界和可迁移的教育理念。

本模式与逐题访谈不同：这是一次完整访谈，不规定每题几轮，也不要求覆盖固定题数。你可以围绕少数关键题深入，也可以在证据需要时跨题连接。

必须遵守：
1. 测验排序和过程数据是已知事实。不得再问“您选了哪个”“是否会这样做”等可直接从数据得知的问题。
2. 每轮先理解教师刚说了什么，再决定追问。若教师质疑你的预设，必须正面回应并修正，不能绕开。
3. 一次只问一个核心问题，语言自然、具体、短。不要把多个假设塞进问题。
4. 不说“很难得、很好、您愿意坦白、您很重视”等评价教师的话，也不要机械道歉。
5. 默认先把当前情境谈清楚：通常围绕同一题连续追问2轮左右，至少弄清判断依据、适用条件或改变决定的边界之一，再考虑换题。整场通常深入2—4题即可，不追求覆盖题数。
6. 只有出现下列情况之一才跨题：当前线索已经得到实质回答；另一题能检验刚形成的理解；两题之间存在明确而有解释价值的相同或差异。跨题时要用一句话说明联系，不能突然跳题。
7. 哲学意味来自真实教育张力，如自由与责任、尊重与保护、当下秩序与长期成长、儿童主体性与共同生活。先落在具体题和教师原话上，再追问其边界；不要突然讲大道理。
8. 区分“教师已经证明的想法”和“需要核实的假设”。不能把AI提出的观点算作教师能力证据。
9. 访谈前段优先找到一个真正有解释价值的矛盾或权衡；中段深化依据与边界；后段统整跨题倾向并邀请教师修正你的理解。
10. 教师明确要求结束、剩余不足60秒，或已经形成清楚的跨题理解时，吸收最后回答后自然收束。不要突然只说“本轮已保存”。

只输出JSON：{"visibleText":"给教师看的承接或问题","done":false,"focus":"本轮想弄清的内容","itemIds":["涉及题号"]}。visibleText不得包含内部分析。`;

function parseOutput(raw) {
  const cleaned = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('model_json_missing');
  const value = JSON.parse(cleaned.slice(start, end + 1));
  const visibleText = String(value.visibleText || '').trim();
  if (!visibleText || visibleText.length > 800) throw new Error('model_visible_text_invalid');
  return { visibleText, done: Boolean(value.done), focus: String(value.focus || '').slice(0, 160), itemIds: Array.isArray(value.itemIds) ? value.itemIds.map(String).slice(0, 6) : [] };
}

exports.main = async (event = {}) => {
  if (!authorized(event)) return { ok: false, error: 'not_authenticated' };
  if (event.operation === 'health') return { ok: true, ready: true, model: MODEL, provider: PROVIDER, promptVersion: PROMPT_VERSION };
  if (event.operation !== 'turn' || !event.payload) return { ok: false, error: 'invalid_request' };
  const payload = event.payload;
  if (Buffer.byteLength(JSON.stringify(payload)) > 900 * 1024) return { ok: false, error: 'payload_too_large' };
  const messages = (Array.isArray(payload.messages) ? payload.messages : []).slice(-18).map((message) => ({
    role: message.role,
    text: String(message.text || '').slice(0, 3000),
    ...(message.role === 'ai' && message.meta ? { focus: String(message.meta.focus || '').slice(0, 160), itemIds: Array.isArray(message.meta.itemIds) ? message.meta.itemIds.map(String).slice(0, 4) : [] } : {})
  }));
  const aiTurns = messages.filter((message) => message.role === 'ai');
  const recentItemIds = aiTurns.at(-1)?.itemIds || [];
  const itemTurnCounts = {};
  for (const turn of aiTurns) for (const id of turn.itemIds || []) itemTurnCounts[id] = (itemTurnCounts[id] || 0) + 1;
  const user = JSON.stringify({
    teacherName: payload.teacherName,
    time: { elapsedMs: payload.elapsedMs, remainingMs: payload.remainingMs, completedAITurns: payload.turnCount },
    knownAssessment: compactItems(payload.items),
    conversation: messages,
    topicState: { currentItemIds: recentItemIds, aiQuestionCountsByItem: itemTurnCounts },
    instruction: messages.length
      ? (recentItemIds.length && recentItemIds.some((id) => (itemTurnCounts[id] || 0) < 2)
        ? '优先承接教师刚才的回答，继续深化当前题；除非回答已把当前判断的依据和边界说清，否则不要换题。'
        : '根据最新回答，优先深化当前线索；只有当前线索已清楚或另一题能检验当前理解时才跨题，并明确说出联系。')
      : '生成自然的开场问题。选择一项最有解释价值的已知作答事实进入，不要宣布对教师的评价。'
  });
  try {
    const started = Date.now();
    console.log('[overall] turn_start', JSON.stringify({ turnCount: payload.turnCount || 0, itemCount: Array.isArray(payload.items) ? payload.items.length : 0, messageCount: messages.length, payloadBytes: Buffer.byteLength(user) }));
    const result = parseOutput(await generate(SYSTEM, user));
    const latencyMs = Date.now() - started;
    console.log('[overall] turn_ok', JSON.stringify({ latencyMs, turnCount: payload.turnCount || 0, itemIds: result.itemIds }));
    return { ok: true, ...result, model: MODEL, provider: PROVIDER, promptVersion: PROMPT_VERSION, latencyMs, attempts: 1 };
  } catch (error) {
    console.error('[overall] model_failed', JSON.stringify({ turnCount: payload.turnCount || 0, error: String(error?.message || error).slice(0, 180) }));
    return { ok: false, error: 'model_generation_failed' };
  }
};

exports.__test = { authorized, compactItems, parseOutput, drain, extractDelta, pickContent, SYSTEM };
