// 云函数 gsyg_interviewChat —— AI 访谈动态追问（微信云开发 AI 版）
// 入参：{ sessionId, itemId, itemContext:{stem,options,title}, teacherRanking, processTags,
//        kbSlice:{core_orientation, observation_points, triggers, evidence_points}, history, remainingMs }
// 返回：{ ok, question, done, evidenceHint }
//
// 硬约束（system prompt 内已声明）：
//   1) 不透露标准排序 / 得分 / 对错
//   2) 每轮只问一个问题；先接住上一轮教师回答，再追缺失证据
//   3) 语气专业但通俗、非评判、不诱导
//
// 与规则版的关键差异：evidenceHint 由模型基于教师"上一轮原话"判定，而非"问过即算"
// —— 这是 CLAUDE.md 中上线前必须修的硬缺口。
//
// 环境变量（在云开发控制台云函数配置里设）：
//   WXAI_MODEL     可选，默认 deepseek-v3；wxai 已开通的任意模型 id
//   SEC_CHECK      可选，1 则对 AI 输出走 openapi security.msgSecCheck（推荐上线开）
//   LLM_TIMEOUT_MS 可选，默认 12000

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const DEFAULT_MODEL = process.env.WXAI_MODEL || 'hy3-preview';
// createModel 收的是「供应商」(如 hunyuan / deepseek)，data.model 才是真正的 model_id
const DEFAULT_PROVIDER = process.env.WXAI_PROVIDER || 'cloudbase';
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 12000);
const SEC_CHECK_ON = String(process.env.SEC_CHECK || '') === '1';

/* ------------------------------ prompt 构造 ------------------------------ */

function buildSystemPrompt(ev) {
  const kb = ev.kbSlice || {};
  const obs = (kb.observation_points || []).join('、');
  const trig = (kb.triggers || [])
    .map((t) => '- ' + (t.code || '') + '：' + (t.result_cond || '') + (t.target ? '（目标：' + t.target + '）' : ''))
    .join('\n');
  const evPoints = (kb.evidence || kb.evidence_points || [])
    .map((e) => (e.code || '') + ' ' + (e.name || ''))
    .filter((s) => s.trim())
    .join('；');

  return [
    '你是一名幼儿园教师专业能力测评中的 AI 访谈者，围绕教师对一道游戏情境题的"最理想→最不理想"排序，采集其判断依据、现场语言和后续支持策略。',
    '【硬约束】',
    '1) 绝不透露是否有标准答案、专家排序、得分或对错；',
    '2) 每轮只问一个问题；先简短接住教师上一轮回答，再针对尚缺的证据追问；',
    '3) 语气专业但通俗、非评判，不诱导预设答案；',
    '4) 输出必须是**严格 JSON**，字段固定为 next_question / done / covered_evidence，不要 Markdown、不要 ```。',
    '【本题核心测评指向】' + (kb.core_orientation || ''),
    obs ? '【主观测点】' + obs : '',
    evPoints ? '【期望采集的能力证据点（E1-E7）】' + evPoints : '',
    trig ? '【可参考的追问方向（后台用，不要读给教师）】\n' + trig : '',
    '【输出格式】',
    '严格 JSON 对象，无任何多余字符：',
    '{"next_question": "下一句要问教师的话；若已充分则输出一句自然收束语", "done": false, "covered_evidence": ["E1", "E3"]}',
    '- next_question：一句话，直接可发送给教师，禁止编号 / 括注 / 证据代码；',
    '- done：若证据已充分或应收束返回 true，否则 false；',
    '- covered_evidence：**基于教师最后一轮回答**判定其原话已实质覆盖的证据点代码数组（E1-E7），未开始/无回答返回 []。'
  ].filter(Boolean).join('\n');
}

function buildUserPrompt(ev) {
  const ctx = ev.itemContext || {};
  const opts = ctx.options
    ? Object.keys(ctx.options).map((k) => k + '：' + ctx.options[k]).join('\n')
    : '';
  const hist = (ev.history || [])
    .map((h) => (h.role === 'me' || h.role === 'teacher' ? '教师' : 'AI') + '：' + h.text)
    .join('\n');
  return [
    ctx.stem ? '【情境】' + ctx.stem : '',
    opts ? '【四种做法】\n' + opts : '',
    ev.teacherRanking
      ? '【教师排序（最理想→最不理想）】' + (Array.isArray(ev.teacherRanking) ? ev.teacherRanking.join(' > ') : ev.teacherRanking)
      : '',
    (ev.processTags && ev.processTags.length)
      ? '【过程标签（仅作追问线索，勿作评价）】' + ev.processTags.join('、')
      : '',
    hist ? '【已进行的问答】\n' + hist : '【尚未开始追问】',
    '请按 system 指定的严格 JSON 格式输出。'
  ].filter(Boolean).join('\n');
}

/* ------------------------------ LLM 调用（wxai） ------------------------------ */

// 微信云开发 AI（`cloud.extend.AI.createModel(...)`）主接口是 `streamText`（SSE）。
// 需要 wx-server-sdk ^3.0.0；package.json 已升级。
async function callWxAI(system, user) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
  console.log('[wxai] call', JSON.stringify({ model: DEFAULT_MODEL, provider: DEFAULT_PROVIDER, timeoutMs: LLM_TIMEOUT_MS }));

  // wxai 在不同 wx-server-sdk 版本下暴露路径不同：
  //   4.x 稳定路径优先 cloud.extend.AI；老版本或某些运行时只注入 cloud.ai。两者 API 形状一致。
  // wx-server-sdk 4.x：cloud.ai 是工厂函数，需先实例化，再调实例上的 createModel(modelId)。
  //   兼容 cloud.extend.AI（若某版本注入）；否则走 cloud.ai()。
  let ai;
  if (cloud.extend && cloud.extend.AI && typeof cloud.extend.AI.createModel === 'function') {
    ai = cloud.extend.AI;
  } else if (typeof cloud.ai === 'function') {
    ai = cloud.ai();
  } else {
    throw new Error('wxai 缺失：cloud.ai / cloud.extend.AI 均不可用');
  }
  if (typeof ai.createModel !== 'function') {
    throw new Error('wxai 实例上无 createModel 方法');
  }
  // provider 先试 DEFAULT_PROVIDER，失败再回退传 model_id 本身（少数版本 createModel 直接吃 model_id）
  let model, providerUsed = DEFAULT_PROVIDER;
  try {
    model = ai.createModel(DEFAULT_PROVIDER);
  } catch (e) {
    try { model = ai.createModel(DEFAULT_MODEL); providerUsed = DEFAULT_MODEL; }
    catch (e2) { throw new Error('createModel 失败：' + ((e && e.message) || e) + ' / 回退亦失败：' + ((e2 && e2.message) || e2)); }
  }

  console.log('[wxai] model created', JSON.stringify({ providerUsed, model: DEFAULT_MODEL, hasGenerateText: typeof model.generateText === 'function', hasStreamText: typeof model.streamText === 'function' }));

  const t0 = Date.now();
  // 优先非流式，失败回落 streamText
  if (typeof model.generateText === 'function') {
    try {
      const res = await model.generateText({ model: DEFAULT_MODEL, messages: messages, data: { model: DEFAULT_MODEL, messages: messages } });
      const t = extractText(res);
      if (t) {
        console.log('[wxai] ok generateText', JSON.stringify({ model: DEFAULT_MODEL, providerUsed, ms: Date.now() - t0, chars: t.length }));
        return t;
      }
    } catch (e) {
      // 若是"model not found"意味着 createModel 传的应该就是 model_id 而非 provider，做二次尝试
      const msg = (e && (e.errMsg || e.message)) || '';
      console.warn('[wxai] generateText failed', JSON.stringify({ providerUsed, model: DEFAULT_MODEL, err: msg }));
      if (/MODEL_NOT_FOUND|not found/i.test(msg) && providerUsed !== DEFAULT_MODEL) {
        try {
          const m2 = ai.createModel(DEFAULT_MODEL);
          console.log('[wxai] retry with createModel(modelId)', JSON.stringify({ model: DEFAULT_MODEL }));
          if (typeof m2.generateText === 'function') {
            const r2 = await m2.generateText({ model: DEFAULT_MODEL, messages: messages, data: { model: DEFAULT_MODEL, messages: messages } });
            const t2 = extractText(r2);
            if (t2) {
              console.log('[wxai] ok generateText retry', JSON.stringify({ model: DEFAULT_MODEL, ms: Date.now() - t0, chars: t2.length }));
              return t2;
            }
          }
          if (typeof m2.streamText === 'function') {
            const out = await drainStream(await m2.streamText({ model: DEFAULT_MODEL, messages: messages, data: { model: DEFAULT_MODEL, messages: messages } }));
            console.log('[wxai] ok streamText retry', JSON.stringify({ model: DEFAULT_MODEL, ms: Date.now() - t0, chars: out.length }));
            return out;
          }
        } catch (e3) { /* 交给下面 streamText 兜底或最终抛错 */ }
      }
    }
  }

  if (typeof model.streamText !== 'function') {
    throw new Error('模型 ' + DEFAULT_MODEL + '(provider=' + providerUsed + ') 未提供 streamText/generateText');
  }
  const res = await model.streamText({ model: DEFAULT_MODEL, messages: messages, data: { model: DEFAULT_MODEL, messages: messages } });
  const out = await drainStream(res);
  console.log('[wxai] ok streamText', JSON.stringify({ model: DEFAULT_MODEL, providerUsed, ms: Date.now() - t0, chars: out.length }));
  return out;
}

// 兼容多种返回形态：dataStream/eventStream/textStream/AsyncIterable
async function drainStream(res) {
  if (!res) return '';
  // 直接是字符串
  if (typeof res === 'string') return res;
  // 直接给出 text（有些实现流式聚合后返回）
  if (typeof res.text === 'string') return res.text;

  // 优先 textStream（若存在，chunk 已是纯文本）
  if (res.textStream && typeof res.textStream[Symbol.asyncIterator] === 'function') {
    let out = '';
    for await (const chunk of res.textStream) out += (typeof chunk === 'string' ? chunk : (chunk && chunk.content) || '');
    return out;
  }
  // eventStream：SSE 事件 { event, data }
  if (res.eventStream && typeof res.eventStream[Symbol.asyncIterator] === 'function') {
    let out = '';
    for await (const ev of res.eventStream) out += extractDelta(ev && ev.data);
    return out;
  }
  // dataStream：yields raw data 行（"data: {json}" 或 直接 JSON 串）
  if (res.dataStream && typeof res.dataStream[Symbol.asyncIterator] === 'function') {
    let out = '';
    for await (const line of res.dataStream) out += extractDelta(line);
    return out;
  }
  // 顶层可迭代
  if (typeof res[Symbol.asyncIterator] === 'function') {
    let out = '';
    for await (const chunk of res) out += extractDelta(chunk);
    return out;
  }
  return extractText(res);
}

// 解析 SSE 里的单行 data → 增量文本
function extractDelta(chunk) {
  if (chunk == null) return '';
  if (typeof chunk === 'string') {
    const s = chunk.replace(/^data:\s*/, '').trim();
    if (!s || s === '[DONE]') return '';
    try {
      const j = JSON.parse(s);
      return pickContent(j);
    } catch (e) {
      return s; // 非 JSON 就当纯文本
    }
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
  if (typeof res === 'string') return res;
  if (res.text) return res.text;
  if (res.output) return res.output;
  if (res.choices && res.choices[0]) {
    const c = res.choices[0];
    return (c.message && c.message.content) || c.text || '';
  }
  if (res.data && res.data.output) return res.data.output;
  return '';
}

// 12s 内 llm 未返回视为失败
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('LLM 超时 ' + ms + 'ms')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/* ------------------------------ JSON 解析 ------------------------------ */

// 模型偶尔会用 ```json 包裹或前后带闲话。做鲁棒抽取。
function parseModelJSON(text) {
  if (!text) return null;
  const raw = String(text).trim();
  // 去掉 ```json ... ``` 包裹
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const tryParse = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
  let obj = tryParse(stripped);
  if (obj) return obj;
  // 提取首个 {...}
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) obj = tryParse(m[0]);
  return obj;
}

function normalizeResult(obj, rawText) {
  const question = (obj && typeof obj.next_question === 'string' && obj.next_question.trim())
    ? obj.next_question.trim()
    : (rawText ? String(rawText).trim() : '');
  const done = !!(obj && obj.done === true);
  const covered = Array.isArray(obj && obj.covered_evidence)
    ? obj.covered_evidence.filter((c) => typeof c === 'string' && /^E[1-7]$/.test(c))
    : [];
  return { question, done, evidenceHint: covered };
}

/* ------------------------------ 内容安全 ------------------------------ */

async function secCheck(text) {
  if (!SEC_CHECK_ON) return { pass: true };
  if (!text) return { pass: true };
  try {
    const openapi = cloud.openapi ? cloud.openapi({ env: cloud.DYNAMIC_CURRENT_ENV }) : null;
    if (!openapi || !openapi.security || !openapi.security.msgSecCheck) return { pass: true, note: 'openapi_unavailable' };
    // scene 4 = 资料；version 2 参见微信文档
    await openapi.security.msgSecCheck({ content: text, version: 2, scene: 4 });
    return { pass: true };
  } catch (e) {
    return { pass: false, error: (e && e.errMsg) || String(e) };
  }
}

/* ------------------------------ 主入口 ------------------------------ */

exports.main = async (event) => {
  // 剩余 <60s：直接收束（红线）
  if (typeof event.remainingMs === 'number' && event.remainingMs < 60000) {
    return {
      ok: true,
      done: true,
      question: '您已经说明了对孩子行为的理解、介入依据和后续支持方式，我们进入下一个情境。',
      evidenceHint: []
    };
  }

  try {
    const system = buildSystemPrompt(event);
    const user = buildUserPrompt(event);
    const raw = await withTimeout(callWxAI(system, user), LLM_TIMEOUT_MS);
    if (!raw) throw new Error('LLM 空响应');

    const obj = parseModelJSON(raw);
    const norm = normalizeResult(obj, raw);
    if (!norm.question) throw new Error('LLM 未返回可用 next_question');

    // 收束兜底：模型不主动置 done 时，历史轮次过多也强制收束
    const rounds = (event.history || []).filter((h) => h.role === 'ai' || h.role === 'assistant').length;
    const done = norm.done || rounds >= 6;

    // 内容安全（可通过 SEC_CHECK=1 开启；未通过则视为失败，客户端回退规则版）
    const sec = await secCheck(norm.question);
    if (!sec.pass) return { ok: false, error: 'msgSecCheck_failed: ' + (sec.error || '') };

    return {
      ok: true,
      question: norm.question,
      done: done,
      evidenceHint: norm.evidenceHint // ← 由 LLM 判定教师上一轮回答覆盖了哪些 E
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'llm_error' };
  }
};
