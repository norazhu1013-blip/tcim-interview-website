// 云函数 gsyg_interviewChat —— AI 访谈动态追问（真正的对话式，非纯脚本）。
// 入参见下方 event 解构；返回 { ok, question, done, evidenceHint }。
// LLM 走 provider 抽象 + 环境变量（LLM_PROVIDER / LLM_ENDPOINT / LLM_KEY / LLM_MODEL），
// 不硬编码 key；未配置或调用失败时返回 ok:false，客户端回退规则版脚本序列。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/**
 * 红线（写入 system prompt，必须遵守）：
 *  - 只围绕教师真实排序追问其判断依据 / 现场语言 / 后续策略；
 *  - 绝不暴露专家排序、得分、标准答案，不诱导预设答案；
 *  - 每轮只问一个问题；先接住上一轮回答，再追缺失证据；
 *  - 非评判、通俗专业。
 */
function buildSystemPrompt(ev) {
  const kb = ev.kbSlice || {};
  const obs = (kb.observation_points || []).join('、');
  const trig = (kb.triggers || []).map((t) => '- ' + (t.code || '') + '：' + (t.result_cond || '') + (t.target ? '（目标：' + t.target + '）' : '')).join('\n');
  const ev7 = (kb.evidence || kb.evidence_points || []).map((e) => (e.code || '') + ' ' + (e.name || '')).join('；');
  return [
    '你是一名幼儿园教师专业能力测评中的 AI 访谈者，围绕教师对一道游戏情境题的“最理想→最不理想”排序，采集其判断依据、现场语言和后续支持策略。',
    '【硬约束】1) 绝不透露是否有标准答案、专家排序、得分或对错；2) 每轮只问一个问题；3) 先简短接住教师上一轮回答，再针对尚缺的证据追问；4) 语气专业但通俗、非评判，不诱导预设答案。',
    '【本题核心测评指向】' + (kb.core_orientation || ''),
    obs ? '【主观测点】' + obs : '',
    ev7 ? '【期望采集的能力证据点】' + ev7 : '',
    trig ? '【可参考的追问方向（后台用，不要读给教师）】\n' + trig : '',
    '【输出格式】只输出下一句要问教师的话（一句问题），不要输出解释、编号或证据代码。若证据已充分或应收束，则输出一句自然的收束语。'
  ].filter(Boolean).join('\n');
}

function buildUserPrompt(ev) {
  const ctx = ev.itemContext || {};
  const opts = ctx.options ? Object.keys(ctx.options).map((k) => k + '：' + ctx.options[k]).join('\n') : '';
  const hist = (ev.history || []).map((h) => (h.role === 'me' || h.role === 'teacher' ? '教师' : 'AI') + '：' + h.text).join('\n');
  return [
    ctx.stem ? '【情境】' + ctx.stem : '',
    opts ? '【四种做法】\n' + opts : '',
    ev.teacherRanking ? '【教师排序（最理想→最不理想）】' + (Array.isArray(ev.teacherRanking) ? ev.teacherRanking.join(' > ') : ev.teacherRanking) : '',
    (ev.processTags && ev.processTags.length) ? '【过程标签（仅作追问线索，勿作评价）】' + ev.processTags.join('、') : '',
    hist ? '【已进行的问答】\n' + hist : '【尚未开始追问】',
    '请给出下一句要问教师的话（只一句）。'
  ].filter(Boolean).join('\n');
}

/* ---- provider 适配层：按 LLM_PROVIDER 选择实现；全部走环境变量，未配置则抛错 ---- */
async function callLLM(system, user) {
  const provider = (process.env.LLM_PROVIDER || '').toLowerCase();
  const endpoint = process.env.LLM_ENDPOINT;
  const key = process.env.LLM_KEY;
  const model = process.env.LLM_MODEL || 'default';
  if (!provider && !endpoint) throw new Error('LLM 未配置（缺 LLM_PROVIDER / LLM_ENDPOINT）');

  // 微信云开发 AI 能力（推荐：国内可达，免自管 key）。SDK 具体接口以开通版本为准，这里做保护性调用。
  if (provider === 'wxai' || provider === 'cloudai') {
    if (cloud.ai && typeof cloud.ai.createModel === 'function') {
      const m = cloud.ai.createModel(model);
      const res = await m.generateText({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
      return (res && (res.text || res.output || (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content))) || '';
    }
    throw new Error('当前环境未提供 cloud.ai 能力，请改用 LLM_PROVIDER=openai 或 custom');
  }

  // OpenAI 兼容接口（含大多数国产大模型的 /v1/chat/completions 兼容层，及 Claude 可达时的兼容网关）
  if (provider === 'openai' || provider === 'custom' || endpoint) {
    if (!endpoint || !key) throw new Error('缺 LLM_ENDPOINT / LLM_KEY');
    const body = { model: model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.6, max_tokens: 300 };
    const resp = await httpsPostJSON(endpoint, key, body);
    return (resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content) || '';
  }
  throw new Error('未知 LLM_PROVIDER: ' + provider);
}

// 极简 https POST（云函数 Node 环境自带 https；不引第三方依赖）
function httpsPostJSON(url, key, body) {
  return new Promise((resolve, reject) => {
    let https, u;
    try { https = require('https'); u = new URL(url); } catch (e) { return reject(e); }
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key, 'Content-Length': Buffer.byteLength(data) },
      timeout: 12000
    }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('LLM 响应解析失败')); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('LLM 超时')); });
    req.write(data);
    req.end();
  });
}

exports.main = async (event) => {
  // 剩余时间不足：直接收束（红线：<60s 不再生成新问）
  if (typeof event.remainingMs === 'number' && event.remainingMs < 60000) {
    return { ok: true, done: true, question: '您已经说明了对孩子行为的理解、介入依据和后续支持方式，我们进入下一个情境。', evidenceHint: [] };
  }
  try {
    const system = buildSystemPrompt(event);
    const user = buildUserPrompt(event);
    let text = await callLLM(system, user);
    text = (text || '').trim();
    if (!text) throw new Error('LLM 空响应');

    // TODO(合规)：上线前对 text 过 openapi security.msgSecCheck（AI 生成内容需人工审核+可追溯）。
    // 简单收束判定：模型输出明显收束语，或历史轮次已多
    const done = /进入下一个情境|感谢您的分享|我们先聊到这/.test(text) || ((event.history || []).length >= 12);
    return { ok: true, question: text, done: done, evidenceHint: [] };
  } catch (e) {
    // 未配置/失败/超时 → ok:false，客户端回退规则版脚本序列
    return { ok: false, error: (e && e.message) || 'llm_error' };
  }
};
