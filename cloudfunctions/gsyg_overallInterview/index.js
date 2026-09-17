'use strict';

const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 70000 });

const MODEL = process.env.OVERALL_WXAI_MODEL || process.env.WXAI_MODEL || 'deepseek-v4-flash-0731';
const PROVIDER = process.env.OVERALL_WXAI_PROVIDER || process.env.WXAI_PROVIDER || 'cloudbase';
const PROMPT_VERSION = 'tcim-overall-interview/2026-09-17-v1';

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

async function drain(stream) {
  if (!stream) return '';
  if (typeof stream.text === 'string') return stream.text;
  let output = '';
  if (stream[Symbol.asyncIterator]) {
    for await (const chunk of stream) output += extractText(chunk) || String(chunk?.data || '');
  }
  return output.trim();
}

async function generate(system, user) {
  const ai = aiClient();
  let model;
  try { model = ai.createModel(PROVIDER); } catch { model = ai.createModel(MODEL); }
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  if (typeof model.generateText === 'function') {
    try {
      const result = await model.generateText({ model: MODEL, messages, data: { model: MODEL, messages } });
      const output = extractText(result);
      if (output) return output;
    } catch (error) {
      console.warn('[overall] generateText failed', String(error?.message || error).slice(0, 180));
    }
  }
  if (typeof model.streamText !== 'function') throw new Error('model_generation_unavailable');
  return drain(await model.streamText({ model: MODEL, messages, data: { model: MODEL, messages } }));
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
5. 跨题统整必须有明确证据：指出两道具体题中不同或相近的选择，再问这种差异背后的条件。不要为了“统整”硬凑联系。
6. 哲学意味来自真实教育张力，如自由与责任、尊重与保护、当下秩序与长期成长、儿童主体性与共同生活。先落在具体题和教师原话上，再追问其边界；不要突然讲大道理。
7. 区分“教师已经证明的想法”和“需要核实的假设”。不能把AI提出的观点算作教师能力证据。
8. 访谈前段优先找到一个真正有解释价值的矛盾或权衡；中段深化依据与边界；后段统整跨题倾向并邀请教师修正你的理解。
9. 教师明确要求结束、剩余不足60秒，或已经形成清楚的跨题理解时，吸收最后回答后自然收束。不要突然只说“本轮已保存”。

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
  const messages = (Array.isArray(payload.messages) ? payload.messages : []).slice(-18).map((message) => ({ role: message.role, text: String(message.text || '').slice(0, 3000) }));
  const user = JSON.stringify({
    teacherName: payload.teacherName,
    time: { elapsedMs: payload.elapsedMs, remainingMs: payload.remainingMs, completedAITurns: payload.turnCount },
    knownAssessment: compactItems(payload.items),
    conversation: messages,
    instruction: messages.length ? '根据最新教师回答，选择深化当前线索、连接另一题、检验边界或自然收束。' : '生成自然的开场问题。先点出一项有解释价值的已知作答事实，但不要宣布对教师的评价。'
  });
  try {
    const started = Date.now();
    const result = parseOutput(await generate(SYSTEM, user));
    return { ok: true, ...result, model: MODEL, provider: PROVIDER, promptVersion: PROMPT_VERSION, latencyMs: Date.now() - started };
  } catch (error) {
    console.error('[overall] model failed', String(error?.message || error).slice(0, 240));
    return { ok: false, error: 'model_generation_failed' };
  }
};

exports.__test = { authorized, compactItems, parseOutput, SYSTEM };
