// 云函数 gsyg_interviewChat —— AI 访谈动态追问(v2.1:任务卡预生成 + 阶段化)
// 入参优先级:taskCard(session 里已存的完整卡) > taskCardSeed(现场拼) > kbSlice(v1 兜底)
//   { sessionId, itemId, itemContext:{stem,options,title},
//     teacherRanking,               // 最终排序数组 ['B','D','A','C']
//     taskCard? / taskCardSeed?,    // 二选一;taskCard 由 gsyg_selectFinal 预生成落地
//     stage,                        // 'S1_CONTEXT' | 'S2_COMPARE' | 'S3_STRATEGY' | 'S4_SUMMARY'
//     processTags[], history[], remainingMs,
//     kbSlice? }                    // v1 老字段
// 返回:{ ok, question, done, evidenceHint[], stage, nextStage }
//
// 硬约束(system prompt 内已声明):
//   1) 不透露标准排序 / 得分 / 对错;2) 每轮只问一个问题;3) 语气专业但通俗、非评判、不诱导
//
// 环境变量:
//   WXAI_MODEL/WXAI_PROVIDER/LLM_TIMEOUT_MS/SEC_CHECK 见 README

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const DEFAULT_MODEL = process.env.WXAI_MODEL || 'hy3-preview';
const DEFAULT_PROVIDER = process.env.WXAI_PROVIDER || 'cloudbase';
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 30000); // 2026-07-09 提到 30s:hy3-preview 生成 200-400 字 + 网络往返常需 15-25s,12s 频繁超时导致回退规则版
const SEC_CHECK_ON = String(process.env.SEC_CHECK || '') === '1';

// ⚠️ 以下两个文件的 canonical 源在 tools/,由 `node tools/sync_cf.js` 物理拷入本目录。
//    改这些前先改 tools/ 里的原文件,再跑 sync,不要直接改本目录副本(会被覆盖)。
// canonical: tools/knowledge.json (由 tools/build_knowledge_v16.js 从 DOC/inbox_0709/_kb16/*.xlsx 生成)
let KB = null;
try { KB = require('./knowledge.json'); } catch (e) { console.warn('[kb] knowledge.json 加载失败:', e && e.message); KB = { items: {} }; }
// canonical: tools/task_card_builder.js (与 gsyg_selectFinal 共用同一份实现)
const taskCardBuilder = require('./task_card_builder.js');
taskCardBuilder.setKnowledge(KB);
const { STAGES, STAGE_LABEL, buildTaskCard, decideNextStage } = taskCardBuilder;

/* ------------------------------ prompt 构造 ------------------------------ */

function buildSystemPrompt(ev, taskCard) {
  // v2:优先用 task_card;task_card 缺时降级到 v1 kbSlice
  const kb = ev.kbSlice || {};
  const useTaskCard = !!taskCard;
  const obs = (kb.observation_points || []).join('、');
  const trig = (kb.triggers || [])
    .map((t) => '- ' + (t.code || '') + ':' + (t.result_cond || '') + (t.target ? '(目标:' + t.target + ')' : ''))
    .join('\n');
  const evPoints = (kb.evidence || kb.evidence_points || [])
    .map((e) => (e.code || '') + ' ' + (e.name || ''))
    .filter((s) => s.trim())
    .join(';');
  const scripts = (kb.scripts || [])
    .map((s) => '- ' + (s.code || '') + ':' + (s.q || '') + (s.E && s.E.length ? '(触及证据:' + s.E.join(',') + ')' : ''))
    .join('\n');

  // 任务卡块(v2)
  const taskCardBlock = useTaskCard ? [
    '',
    '【当前教师任务卡(核心访谈依据,只给你看,不能读给教师)】',
    '- 题目:' + taskCard.item_id + ' · ' + taskCard.item_title,
    '- 能力主方向:' + (taskCard.ability_focus.interview_main_focus || taskCard.ability_focus.primary_ability_type),
    '- 能力次方向:' + (taskCard.ability_focus.interview_secondary_focus || taskCard.ability_focus.secondary_ability_type),
    '- 教师最终排序:' + taskCard.teacher_answer_profile.teacherFinalOrder + '(左=最理想,右=最不理想)',
    '- 教师初始排序:' + taskCard.teacher_answer_profile.teacherInitialOrder + '(' + taskCard.teacher_answer_profile.orderChangeSummary + ')',
    '- 重点选项:' + (taskCard.teacher_answer_profile.priorityOption || '(无)') + ';重点比较对:' + (taskCard.teacher_answer_profile.priorityPair || '(无)'),
    '- 过程标签:' + ((taskCard.teacher_answer_profile.processTags || []).join('、') || '(无异常标签)'),
    '- 遴选来源:' + ((taskCard.teacher_answer_profile.sources || []).join('/')),
    '',
    '【本次访谈必须验证的假设(选性追问,不要机械问完)】',
    ...(taskCard.interview_hypotheses || []).map((h, i) => '  H' + (i + 1) + '. ' + h),
    '',
    '【必须采集的证据(至少覆盖 3 条即可推进阶段;缺证据时优先追问)】',
    ...(taskCard.must_obtain_evidence || []).map((e, i) => '  E' + (i + 1) + '. ' + e),
    '',
    '【本题可用的专业追问(参考深度,不要机械照搬,须按教师原话改写)】',
    ...(taskCard.recommended_probes || []).slice(0, 6).map((p, i) => '  P' + (i + 1) + '. ' + p),
    '',
    '【当前访谈阶段】' + taskCard.current_stage + ' · ' + taskCard.current_stage_focus,
    '  · S1_CONTEXT:先弄清教师如何解读儿童行为与情境冲突(不要一上来问"为什么这么排")',
    '  · S2_COMPARE:围绕教师排序里最耐人寻味的一对做法,追问判断依据与价值权衡',
    '  · S3_STRATEGY:请教师说出具体的现场话术或后续策略;避免抽象',
    '  · S4_SUMMARY:中性小结教师观点并请其确认,准备收束',
    '  · 当前处于 ' + taskCard.current_stage + ',请围绕这一阶段的目标提问;不要跳阶段。'
  ].join('\n') : '';

  return [
    '你是一名幼儿园教师专业能力测评的资深研究者,不是普通聊天机器人。你要围绕教师对某道游戏情境题的"最理想→最不理想"排序进行深度访谈,采集其判断依据、现场语言和后续支持策略。',
    '',
    '【硬约束 — 不可违反】',
    '1) 绝不透露是否有标准答案、专家排序、得分或对错;',
    '2) 每轮只问一个问题;先用一句话简短接住教师上一轮原话(体现你在听),再针对尚缺的证据追问;',
    '3) 语气专业但通俗、非评判、不诱导预设答案;',
    '4) 输出必须是**严格 JSON**,字段固定为 next_question / done / covered_evidence,不要 Markdown、不要 ```。',
    '',
    '【访谈深度要求 — 关键】',
    '⛔ 严禁的浅层提问方式(这些是非专业访谈者的做法,你绝不能这样问):',
    '   ✗ "为什么把 D 排在最理想,B 排在最不理想?"(直接读排序、要求教师全面解释)',
    '   ✗ "你怎么理解这个情境?"(过于宽泛,教师给不出结构化回答)',
    '   ✗ "还有其他考虑吗?"(甩问,无着力点)',
    '',
    '✅ 应做的专业深度提问 — 要"碰撞"到教师作答时的心路历程:',
    '  · **抓具体细节**:抓住教师排序或过程数据里最耐人寻味的一处,拿情境里的具体行为、材料、儿童反应做锚点提问。例如不问"为什么排 D 最理想",而问"当你看到孩子把水灌进篮框时,你是先觉得这是个新的游戏创造,还是先想到篮球架的原用途?"',
    '  · **触到专业边界**:结合本题核心测评指向 + 触发规则(见下方),问出教师专业判断的隐性假设、可能的盲点或图式惯性。例如"如果这时其他老师告诉你篮球架被泡坏后学校要问责,你的排序会变吗?为什么?"',
    '  · **揭短式反问**:如果教师给出貌似标准的答案,要**反向探测**其实际操作可能性、时间/精力预算、与真实幼儿反应的匹配度。例如"你说会先陪伴他到专注,现场如果这个孩子 20 分钟都不专注、其他孩子又需要你,你会怎么办?"',
    '  · **对比性追问**:两个选项排序邻近但方向不同时,不是问"为什么排 A 高于 B",而是问"A 和 B 都在你的排序前半,是不是意味着你更看重 XX 而不是 YY? 具体在什么条件下你会倒过来排?"',
    '',
    // task_card 块(v2 主路径),缺失时退到 v1 kbSlice
    taskCardBlock,
    !useTaskCard ? '【本题专业底层信息(仅供你构思提问,绝不能读给教师)】' : '',
    !useTaskCard && kb.core_orientation ? '核心测评指向:' + kb.core_orientation : '',
    !useTaskCard && obs ? '观察维度:' + obs : '',
    !useTaskCard && evPoints ? '期望采集的能力证据点:' + evPoints : '',
    !useTaskCard && trig ? '触发规则(何时该往哪个方向追问):\n' + trig : '',
    !useTaskCard && scripts ? '研究团队为本题预设的专业追问模板(你可参考其深度,但不要机械照搬,要根据教师原话改写):\n' + scripts : '',
    '',
    '【问答节奏】',
    '- 首轮:选一个最能引出教师专业判断动机的具体切入点(参考上方触发规则和脚本)。不要用"你怎么排的""为什么"起手。',
    '- 中间轮:根据教师原话选择一条尚未覆盖的证据点,针对该证据做揭短/对比/边界追问。',
    '- 收束:证据已充分(至少 3 个 E 点被实质覆盖)、教师明显开始重复、或已问 5 轮以上,输出自然收束语并 done=true。',
    '',
    '【输出格式 — 严格】',
    '严格 JSON 对象,无任何多余字符:',
    '{"next_question": "下一句要问教师的话;若已充分则输出一句自然收束语", "done": false, "covered_evidence": ["E1", "E3"]}',
    '- next_question:一句话或至多两句,直接可发送给教师;禁止出现编号 / 括注 / E 代码 / T 代码 / 任何内部术语;',
    '- done:若证据已充分或应收束返回 true,否则 false;',
    '- covered_evidence:**基于教师最后一轮原话**判定其表述已实质覆盖的证据点代码数组(E1-E7),未开始/无回答返回 []。'
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
    // v2.1:优先使用 mp 传来的完整 task_card(gsyg_selectFinal 预生成,存于 session.selection.final[i].task_card);
    // mp 只传 taskCardSeed 时降级到现场组装;两者都缺则退到 v1 kbSlice 路径。
    const stage = STAGES.indexOf(event.stage) >= 0 ? event.stage : 'S1_CONTEXT';
    let taskCard = null;
    let taskCardSource = 'none';
    if (event.taskCard && event.taskCard.item_id) {
      // session 里已有完整任务卡:浅拷贝一份并覆盖 current_stage 相关字段(每轮阶段不同)
      taskCard = Object.assign({}, event.taskCard, {
        current_stage: stage,
        current_stage_focus: STAGE_LABEL[stage] || (event.taskCard.current_stage_focus || '')
      });
      taskCardSource = 'session';
    } else if (event.taskCardSeed) {
      taskCard = buildTaskCard(event.itemId, event.taskCardSeed, stage);
      taskCardSource = 'seed';
    }
    if (taskCard) console.log('[task_card] source=' + taskCardSource, JSON.stringify({ itemId: taskCard.item_id, stage, hypotheses: (taskCard.interview_hypotheses || []).length, evidence: (taskCard.must_obtain_evidence || []).length, probes: (taskCard.recommended_probes || []).length }));

    const system = buildSystemPrompt(event, taskCard);
    const user = buildUserPrompt(event);
    const raw = await withTimeout(callWxAI(system, user), LLM_TIMEOUT_MS);
    if (!raw) throw new Error('LLM 空响应');

    const obj = parseModelJSON(raw);
    const norm = normalizeResult(obj, raw);
    if (!norm.question) throw new Error('LLM 未返回可用 next_question');

    // 收束兜底:模型不主动置 done 时,轮次过多强制收束
    const rounds = (event.history || []).filter((h) => h.role === 'ai' || h.role === 'assistant').length;
    const done = norm.done || rounds >= 6;
    // 阶段推进(基于本轮 covered_evidence + 轮数)
    const nextStage = decideNextStage(stage, norm.evidenceHint, rounds + 1);

    // 内容安全
    const sec = await secCheck(norm.question);
    if (!sec.pass) return { ok: false, error: 'msgSecCheck_failed: ' + (sec.error || '') };

    return {
      ok: true,
      question: norm.question,
      done: done,
      evidenceHint: norm.evidenceHint,
      stage: stage,           // 本轮实际使用的 stage
      nextStage: nextStage    // 下一轮建议的 stage
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'llm_error' };
  }
};
