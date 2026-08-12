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
//   网页 AI: WEB_INTERVIEW_LLM_PROFILE/OPENAI_API_KEY/DEEPSEEK_API_KEY/OPENAI_COMPATIBLE_* 等见 README

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const DEFAULT_MODEL = process.env.WXAI_MODEL || 'hy3-preview';
const DEFAULT_PROVIDER = process.env.WXAI_PROVIDER || 'cloudbase';
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 30000); // 2026-07-09 提到 30s:hy3-preview 生成 200-400 字 + 网络往返常需 15-25s,12s 频繁超时导致回退规则版
const SEC_CHECK_ON = String(process.env.SEC_CHECK || '') === '1';
const MIN_NORMAL_QUESTIONS = 8;
const MAX_VISIBLE_QUESTION_CHARS = 100;
const DEFAULT_CLOSING_MESSAGE = '感谢您的分享，本情境的访谈先到这里。';

const INTERVIEW_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    understanding: {
      type: 'object',
      additionalProperties: false,
      properties: {
        teacher_quote: { type: 'string' },
        meaning: { type: 'string' },
        confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] }
      },
      required: ['teacher_quote', 'meaning', 'confidence']
    },
    state: {
      type: 'object',
      additionalProperties: false,
      properties: {
        active_thread: { type: 'string' },
        latest_new_point: { type: 'string' },
        next_move: {
          type: 'string',
          enum: ['OPEN', 'CLARIFY', 'DEEPEN', 'CONNECT', 'TENSION', 'BOUNDARY', 'INTEGRATE', 'PIVOT', 'CLOSE']
        },
        purpose: { type: 'string' },
        completion: {
          type: 'string',
          enum: ['BEFORE_MINIMUM', 'INCOMPLETE', 'COMPLETE', 'MUST_STOP']
        }
      },
      required: ['active_thread', 'latest_new_point', 'next_move', 'purpose', 'completion']
    },
    next_question: { type: 'string' },
    done: { type: 'boolean' },
    closing_message: { type: 'string' },
    covered_evidence: { type: 'array', items: { type: 'string' } }
  },
  required: ['understanding', 'state', 'next_question', 'done', 'closing_message', 'covered_evidence']
});

// LLM 配置白名单。前端只能传 llmProfile 选择这里已有的配置,不能传 endpoint/key。
// 密钥仍走云函数环境变量,不要写入代码或前端构建变量。
const LLM_PROFILES = Object.freeze({
  wxai: { type: 'wxai' },
  'openai-official': {
    type: 'openai-responses',
    endpoint: 'https://api.openai.com/v1/responses',
    apiKeyEnv: 'OPENAI_API_KEY',
    model: process.env.OPENAI_MODEL || 'gpt-5.6-sol',
    reasoningEffort: process.env.OPENAI_REASONING_EFFORT || 'high',
    maxOutputTokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 4000)
  },
  deepseek: {
    type: 'openai-compatible',
    endpoint: 'https://api.deepseek.com/chat/completions',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    temperature: Number(process.env.DEEPSEEK_TEMPERATURE || 0.2),
    maxTokens: Number(process.env.DEEPSEEK_MAX_TOKENS || 900)
  },
  'kimi-k3': {
    type: 'openai-compatible',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    model: process.env.KIMI_MODEL || 'kimi-k3',
    reasoningEffort: process.env.KIMI_REASONING_EFFORT || 'high',
    maxCompletionTokens: Number(process.env.KIMI_MAX_COMPLETION_TOKENS || 4000),
    strictJsonSchema: true
  },
  'openai-compatible': {
    type: 'openai-compatible',
    endpoint: process.env.OPENAI_COMPATIBLE_ENDPOINT || '',
    apiKeyEnv: 'OPENAI_COMPATIBLE_API_KEY',
    model: process.env.OPENAI_COMPATIBLE_MODEL || '',
    temperature: Number(process.env.OPENAI_COMPATIBLE_TEMPERATURE || 0.2),
    maxTokens: Number(process.env.OPENAI_COMPATIBLE_MAX_TOKENS || 900)
  }
});

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
// 2026-07-27:恢复 2026-07-18 的 v7 访谈决策提示词；
//   生成稳定性、格式抢救与教师可见文本保护留在提示词外围处理。
//   · 个性化任务卡与教师排序作为「动态输入」放到 user 消息(见 buildUserPrompt)。
//   · 保留项目红线:不透露专家排序/得分/标准答案/对错;纯文字;严格 JSON。
// 注:任务卡数据由 gsyg_selectFinal 预生成(session.selection.final[i].task_card),
//    在 buildUserPrompt 内映射为该提示词的「动态输入」字段;缺卡时降级用 kbSlice。

const INTERVIEW_POLICY = [
  '你是一名面向幼儿园教师的情境访谈者。教师已经完成一道情境排序题。你的任务不是验证教师是否符合标准答案，也不是把知识库观点教给教师，而是通过自然、有限的追问，逐步理解教师如何看待情境、如何作出教育判断、重视什么，以及这些判断在什么条件下会变化。',
  '',
  '【访谈开始前：先做好专业准备】',
  '阅读题干、四个选项、教师排序和知识库后，先在内部形成“情境理解图”：题干明确发生了什么、哪些信息未提供；四个选项采取了什么行动、可能依赖什么判断；情境可能涉及什么教育关系；排序中什么位置值得了解；知识库有哪些尚未被教师确认的可能解释。',
  '知识库帮助你看见可能值得理解的地方，不是访谈提纲，也不是必须逐项验证的答案。不得把知识库假设当成教师观点。',
  '',
  '【首问】',
  '首问不使用固定模板。根据本题选择最能打开教师思考且最容易理解的一个进入点：教师最先注意到什么；怎样理解一个含义开放的儿童表现；排序中真正有解释价值的反差；或情境中需要教师判断的真实教育关系。',
  '首问开放、具体、不预设结论。不要把两个都可能成立的方面强迫成二选一，也不要默认使用“为什么这样排序”。',
  '页面打开时系统预排的选项顺序不属于教师观点。除非动态输入明确标注初始排序来源为teacher_choice，否则不得称“您一开始把某项放在前面/后面”，也不得把系统默认顺序与最终排序描述成教师改变了想法。',
  '',
  '【每轮先理解，再决定】',
  '只依据教师原话提取其新表达的判断、区别、理由、关切或条件。区分教师明确说出的意思、你的推测、知识库的可能解释。只有教师明确说出的意思可以直接成为下一问前提；只有影响后续理解的关键歧义才需要澄清。',
  '理解教师整句话及其对话作用，不能按单个关键词判断。例如“有的幼儿享受重复，有的是低水平重复”是在提出教育区别，不是在抱怨AI重复提问。',
  '一次只维持一条主要线索。教师刚提出新的区别、修正、矛盾、价值或条件时，优先处理这一点，不能因任务卡、排序或轮数跳去别处。',
  '',
  '【选择本轮动作】',
  '下一问只承担一种功能：OPEN首问；CLARIFY澄清关键歧义；DEEPEN了解判断为何成立或怎样影响行动/儿童；CONNECT理解前后观点的关系；TENSION理解教师观点、排序或情境中已经出现的权衡；BOUNDARY了解判断何时改变；INTEGRATE简短小结后问尚未清楚的一点；PIVOT在当前线索充分或无法继续时转向另一条已有依据的线索；CLOSE结束。',
  '不是每轮都需要制造两种思维模式，也不是每条线索都必须走完“解释—行动—影响—条件”。选择此刻最自然、最有信息价值的一步。',
  '',
  '【保护主线】',
  '提出问题前检查：教师能否直接重复旧答案作答；是否在追问教师认为理所当然且无助于理解判断的细节；冲突、风险或儿童反应是否确实来自题干、选项或教师原话；教师刚提出的核心区别是否已被吸收；答案是否可能改变你对教师思考的理解。没有推进价值就换一个动作，不要勉强发问。',
  '排序只是线索，不是访谈主线。只有排序差异能帮助理解尚未说出的判断标准时才追问。',
  '',
  '【理解出现问题时】',
  '教师表示没懂、看不懂、为什么问这个、这重要吗，或指出前提不对时，先依据整句话判断是在质疑问题、纠正理解还是拒绝继续。若问题不清或理解有误：用一句话说明真正想了解什么或承认前提错误；回到最近一条可靠原话；用更直接的问题继续，或放弃当前线索转向。',
  '修复不是把原问题换词重问，也不能在教师刚纠正后立刻结束。只有教师明确烦躁、不愿回答或要求结束时，才因拒绝继续而收束。',
  '',
  '【表达】',
  '使用教师听一遍就明白的口语，明确在问谁、哪件事和什么关系。一轮只完成一个认知任务、一个问号；必要承接不超过一句；不堆叠多个假设、条件、选项和前几轮结论；不向教师展示专业分析词；不索要无必要的例子、指标或现场话术。',
  '问题不以字数越少越好。先保证意思完整、自然、容易回答，再删除不必要重复。',
  '',
  '【小结与结束】',
  '有两个以上可靠观点且其关系值得理解时，可以用一句忠实于教师原话的小结承接，再问尚未清楚的一点。',
  '正常访谈至少提出8个可回答问题。纯致歉、无问题的小结和结束语不计入问题数。第8问是开始检查内容是否完整的最低门槛，不是自动结束点。少于8问时，除非教师明确拒绝或系统时间无法继续，否则done必须为false；不能为了凑数遍历选项、索要无意义细节或重复旧问题。',
  '教师回答第8问后，满足以下条件才可以结束：已理解至少一条对本情境有解释力的判断；其重要理由、教育关切、影响或适用边界至少一方面清楚；教师最后的新区别、修正或条件已被回应；当前没有明显更有价值且不重复的下一问。任一项不满足就继续。',
  '若时间即将结束，先吸收教师最后回答再收束。结束语用一至两句概括真正了解到的主要判断及其条件或关切，再感谢教师；不提出新问题，不要求确认。',
  '',
  '【安全】不透露专家排序、得分、标准答案、能力等级或题目入选原因；不判断教师对错；不诱导接受知识库观点；不把访谈变成培训。',
  '',
  '【输出】只输出严格JSON：',
  '{"understanding":{"teacher_quote":"支持本轮理解的一句教师原话；首问为空","meaning":"教师明确表达的意思，不得写知识库假设","confidence":"HIGH/MEDIUM/LOW"},"state":{"active_thread":"当前主要理解线索","latest_new_point":"本轮新增区别、理由、关切或条件；无则NONE","next_move":"OPEN/CLARIFY/DEEPEN/CONNECT/TENSION/BOUNDARY/INTEGRATE/PIVOT/CLOSE","purpose":"下一问希望新增了解什么；结束时写为何完整","completion":"BEFORE_MINIMUM/INCOMPLETE/COMPLETE/MUST_STOP"},"next_question":"继续时写一个自然问题；结束时为空","done":false,"closing_message":"结束时写内容化结束语；继续时为空","covered_evidence":[]}',
  'completion规则：少于8个可回答问题为BEFORE_MINIMUM；达到8问但内容未完整为INCOMPLETE；达到8问且符合结束条件为COMPLETE；仅教师明确拒绝或系统时间无法继续时为MUST_STOP。',
  '输出前检查：下一问是否准确承接教师、是否真的增加理解、是否容易回答。任一项不满足就重新选择动作，不能用结束掩盖低质量候选问题。'
].join('\n');

function buildSystemPrompt(ev, taskCard) {
  // 系统提示词为静态访谈策略;个性化数据全部走 user 消息的「动态输入」。
  // taskCard 参数保留以兼容调用点(当前 system 段不再拼接任务卡明细)。
  return INTERVIEW_POLICY;
}

function fmtRemain(ms) {
  if (typeof ms !== 'number' || ms < 0) return '未知';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return m + ' 分 ' + (ss < 10 ? '0' : '') + ss + ' 秒';
}

function isTeacherRole(role) {
  return role === 'me' || role === 'teacher' || role === 'user';
}

function isAIRole(role) {
  return role === 'ai' || role === 'assistant';
}

function teacherMessages(history) {
  return (history || []).filter((h) => isTeacherRole(h.role) && h.text).map((h) => String(h.text).trim());
}

function latestTeacherMessage(history) {
  const messages = teacherMessages(history);
  return messages.length ? messages[messages.length - 1] : '';
}

function isStrongFrustrationText(text) {
  const s = String(text || '').replace(/\s+/g, '');
  return /(?:烦(?:死|透|了)?|别问了|不要再问|不想继续|不愿继续|不想回答|不回答了|到这里吧|结束吧)/.test(s);
}

function formatHistory(history) {
  let questionNo = 0;
  return (history || []).map((h) => {
    if (isAIRole(h.role)) {
      questionNo += 1;
      return 'AI问题' + questionNo + '：' + h.text;
    }
    return '教师回答' + (questionNo || 1) + '：' + h.text;
  }).join('\n');
}

function buildUserPrompt(ev, taskCard) {
  const ctx = ev.itemContext || {};
  const opts = ctx.options
    ? Object.keys(ctx.options).map((k) => k + '：' + ctx.options[k]).join('\n')
    : '';
  const ranking = Array.isArray(ev.teacherRanking) ? ev.teacherRanking.join(' > ') : (ev.teacherRanking || '');

  const tap = (taskCard && taskCard.teacher_answer_profile) || {};
  const af = (taskCard && taskCard.ability_focus) || {};
  const kb = ev.kbSlice || {};

  // 只有明确由教师主动确认过的初始排序，才可作为教师观点提供给模型。
  // 旧网页数据未记录来源；为避免把系统 A/B/C/D 默认展示误称为教师选择，一律按未知处理。
  const provenance = ev.rankingProvenance || {};
  const initialIsTeacherChoice = provenance.initialOrderSource === 'teacher_choice';
  let initLine = '（无记录）';
  if (initialIsTeacherChoice && tap.teacherInitialOrder) {
    initLine = String(tap.teacherInitialOrder).split('').join(' > ')
      + (tap.orderChangeSummary ? '（' + tap.orderChangeSummary + '）' : (tap.orderChanged ? '（有调整）' : '（未调整）'));
  } else {
    initLine = '（无教师初始排序记录；系统展示顺序不代表教师选择）';
  }

  // 同时提供主、次焦点：很多题目的教育张力实际存放在 secondary_focus 中。
  const mainFocus = af.interview_main_focus || af.primary_ability_type || '（未指定）';
  const secondaryFocus = af.interview_secondary_focus || af.secondary_ability_type || '（未指定）';
  const prioOpt = tap.priorityOption || '（无）';
  const prioPair = tap.priorityPair || '（无）';

  let hyp = (taskCard && taskCard.interview_hypotheses) || [];
  let evtar = (taskCard && taskCard.must_obtain_evidence) || [];
  if (!taskCard) {
    // 兜底(老 session 无预生成任务卡):脚本只作为少量候选，不作为逐题清单。
    hyp = (kb.scripts || []).map((s) => s.q).filter(Boolean).slice(0, 2);
    evtar = (kb.evidence || kb.evidence_points || [])
      .map((e) => (e.code ? e.code + ' ' : '') + (e.name || '')).filter((s) => s.trim());
  }
  const listBlock = (arr, maxItems) => (arr && arr.length)
    ? arr.slice(0, maxItems).map((x, i) => '\n  ' + (i + 1) + '. ' + String(x)).join('')
    : '（无）';

  const hist = formatHistory(ev.history || []);
  const answeredQuestions = (ev.history || [])
    .filter((h) => isAIRole(h.role)).length;
  const latestTeacher = latestTeacherMessage(ev.history || []);
  let roundControl = answeredQuestions < MIN_NORMAL_QUESTIONS
    ? '已提出 ' + answeredQuestions + ' 个可回答问题，尚未达到正常访谈至少8问的门槛。completion必须为BEFORE_MINIMUM，done必须为false；继续当前最有价值的线索，但不得凑数、重复或遍历选项。'
    : '已提出 ' + answeredQuestions + ' 个可回答问题，已达到最低门槛。现在按内容完整性判断：若主线完整且最新观点已回应，可标记COMPLETE；否则标记INCOMPLETE并继续，不存在固定最高问数。';
  if (typeof ev.remainingMs === 'number' && ev.remainingMs < 60000) {
    roundControl = '剩余不足一分钟。先吸收教师最新回答，completion标记MUST_STOP，用内容化小结收束。';
  }
  const interactionControl = isStrongFrustrationText(latestTeacher)
    ? '教师明确不愿继续：completion标记MUST_STOP，用简短内容化结束语结束。'
    : '不要用关键词判断教师是否在批评访谈。请结合完整句子和上下文，判断最新回答是在表达教育内容、纠正理解、质疑问题，还是拒绝继续。';

  return [
    '【当前情境】' + (ctx.stem || ''),
    opts ? '【四个做法】\n' + opts : '',
    '【教师最终排序：最理想→最不理想】' + ranking,
    '【教师初始排序与变化，如有】' + initLine,
    '【排序数据边界】只有最终排序可视为教师明确提交的观点；系统默认展示顺序不得归因于教师。',
    '',
    '【知识库给出的专业准备；以下全部属于可能解释，不是事实，也不是教师观点】',
    '主要访谈焦点：' + mainFocus,
    '次级访谈焦点（常含需要深入的价值张力）：' + secondaryFocus,
    '待检验的可能解释（除非教师自己提出，否则不得写入问题前提）：' + listBlock(hyp, 4),
    '说明：任务卡中的现成追问脚本不注入本轮，避免把浅层脚本当成访谈路线。',
    '知识库提示的可关注内容（帮助准备，不要求逐项覆盖）：' + listBlock(evtar, 4),
    '排序辅助线索（低于教师最新表达，不得逐项遍历）：关注选项 ' + prioOpt + '；比较对 ' + prioPair,
    (ev.processTags && ev.processTags.length) ? '过程标签（仅作追问线索，勿作评价）：' + ev.processTags.join('、') : '',
    '',
    hist ? '【逐轮对话；先理解教师观点和当前主线】\n' + hist : '【尚未开始追问；请先完成情境理解图并自主选择首问】',
    latestTeacher ? '【教师最新回答——本轮第一优先级】' + latestTeacher : '',
    '【本轮进度要求】' + roundControl,
    '【互动状态】' + interactionControl,
    '【剩余时间】' + fmtRemain(ev.remainingMs),
    '请按 system 指定的严格 JSON 输出。'
  ].filter(Boolean).join('\n');
}

/* ------------------------------ LLM 调用 ------------------------------ */

function isWebGatewayCall(event) {
  const gateway = event && event.__gsygGateway;
  return Boolean(gateway && gateway.actor && String(gateway.actor).indexOf('web:') === 0);
}

function resolveLLMProfile(event) {
  const requested = String((event && event.llmProfile) || '').trim();
  const defaultForWeb = String(process.env.WEB_INTERVIEW_LLM_PROFILE || 'wxai').trim();
  const id = requested || (isWebGatewayCall(event) ? defaultForWeb : 'wxai');
  if (!LLM_PROFILES[id]) throw new Error('unsupported_llm_profile:' + id);
  const config = LLM_PROFILES[id];
  console.log('[llm_profile] selected', JSON.stringify({
    id,
    type: config.type,
    requested: requested || '',
    isWebGateway: isWebGatewayCall(event)
  }));
  return { id, config };
}

function llmResponseMeta(selected) {
  if (!selected || !selected.config) return { llmProfile: '', llmModel: '' };
  return {
    llmProfile: selected.id,
    llmModel: selected.config.type === 'wxai' ? DEFAULT_MODEL : (selected.config.model || '')
  };
}

function endpointHost(endpoint) {
  try { return new URL(endpoint).host; } catch (e) { return ''; }
}

async function callLLM(selected, system, user) {
  if (selected.config.type === 'wxai') return callWxAI(system, user, selected.id);
  if (selected.config.type === 'openai-responses') {
    return callOpenAIResponses(selected.id, selected.config, system, user);
  }
  if (selected.config.type === 'openai-compatible') {
    return callOpenAICompatible(selected.id, selected.config, system, user);
  }
  throw new Error('unsupported_llm_profile_type:' + selected.config.type);
}

async function callOpenAIResponses(profileId, profile, system, user) {
  const apiKey = process.env[profile.apiKeyEnv];
  if (!apiKey) throw new Error('llm_profile_missing_api_key:' + profile.apiKeyEnv);

  const payload = {
    model: profile.model,
    instructions: system,
    input: user,
    reasoning: { effort: profile.reasoningEffort },
    text: {
      verbosity: 'low',
      format: {
        type: 'json_schema',
        name: 'teacher_interview_turn',
        strict: true,
        schema: INTERVIEW_RESPONSE_SCHEMA
      }
    },
    max_output_tokens: profile.maxOutputTokens,
    store: false
  };
  console.log('[openai_official] call', JSON.stringify({
    profileId,
    model: profile.model,
    endpointHost: endpointHost(profile.endpoint),
    reasoningEffort: profile.reasoningEffort,
    timeoutMs: LLM_TIMEOUT_MS
  }));

  const response = await fetch(profile.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(async () => ({ text: await response.text().catch(() => '') }));
  if (!response.ok) {
    const msg = body && (body.error && (body.error.message || body.error.code) || body.message || body.text);
    throw new Error('openai_official_http_' + response.status + ':' + String(msg || '').slice(0, 200));
  }
  const text = extractOpenAIResponseText(body);
  if (!text) throw new Error('openai_official_empty_response:' + profileId);
  console.log('[openai_official] ok', JSON.stringify({ profileId, model: profile.model, chars: text.length }));
  return text;
}

// 微信云开发 AI（`cloud.extend.AI.createModel(...)`）主接口是 `streamText`（SSE）。
// 需要 wx-server-sdk ^3.0.0；package.json 已升级。
async function callWxAI(system, user, profileId) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
  console.log('[wxai] call', JSON.stringify({ profileId: profileId || 'wxai', model: DEFAULT_MODEL, provider: DEFAULT_PROVIDER, timeoutMs: LLM_TIMEOUT_MS }));

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

async function callOpenAICompatible(profileId, profile, system, user) {
  if (!profile.endpoint) throw new Error('llm_profile_missing_endpoint:' + profileId);
  const apiKey = process.env[profile.apiKeyEnv];
  if (!apiKey) throw new Error('llm_profile_missing_api_key:' + profile.apiKeyEnv);
  if (!profile.model) throw new Error('llm_profile_missing_model:' + profileId);

  const payload = {
    model: profile.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  };
  if (Number.isFinite(profile.temperature)) payload.temperature = profile.temperature;
  if (Number.isFinite(profile.maxTokens)) payload.max_tokens = profile.maxTokens;
  if (profile.reasoningEffort) payload.reasoning_effort = profile.reasoningEffort;
  if (Number.isFinite(profile.maxCompletionTokens)) payload.max_completion_tokens = profile.maxCompletionTokens;
  if (profile.strictJsonSchema) {
    payload.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'teacher_interview_turn',
        strict: true,
        schema: INTERVIEW_RESPONSE_SCHEMA
      }
    };
  }
  console.log('[third_llm] call', JSON.stringify({
    profileId,
    model: profile.model,
    endpointHost: endpointHost(profile.endpoint),
    reasoningEffort: profile.reasoningEffort || '',
    strictJsonSchema: !!profile.strictJsonSchema,
    timeoutMs: LLM_TIMEOUT_MS
  }));

  const response = await fetch(profile.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(async () => ({ text: await response.text().catch(() => '') }));
  if (!response.ok) {
    const msg = body && (body.error && (body.error.message || body.error.code) || body.message || body.text);
    throw new Error('third_llm_http_' + response.status + ':' + String(msg || '').slice(0, 200));
  }
  const text = extractText(body);
  if (!text) throw new Error('third_llm_empty_response:' + profileId);
  console.log('[third_llm] ok', JSON.stringify({ profileId, model: profile.model, chars: text.length }));
  return text;
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

function extractOpenAIResponseText(res) {
  if (!res) return '';
  if (typeof res.output_text === 'string' && res.output_text) return res.output_text;
  if (!Array.isArray(res.output)) return '';
  return res.output
    .filter((item) => item && item.type === 'message' && Array.isArray(item.content))
    .flatMap((item) => item.content)
    .filter((content) => content && content.type === 'output_text' && typeof content.text === 'string')
    .map((content) => content.text)
    .join('');
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

// 严格 JSON 失败时尽量抢救模型已经生成的可见问题，避免因一个逗号或引号错误
// 把有内容的候选整个替换成通用备用句。这里只提取问题，不猜测完成状态。
function extractLooseModelResult(text) {
  const raw = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  if (!raw) return null;
  const keyed = raw.match(/(?:"next_question"|'next_question'|next_question)\s*[:：]\s*["“']?([^\r\n"”]*?[？?])/i);
  let question = keyed && keyed[1] ? keyed[1].trim() : '';
  if (!question) {
    const candidates = raw.match(/[^{}\[\]\r\n]{4,180}[？?]/g) || [];
    question = candidates.length ? candidates[candidates.length - 1].trim() : '';
  }
  if (!question) return null;
  return {
    understanding: null,
    state: {
      active_thread: '沿教师最新表达继续',
      latest_new_point: '由下一轮重新判断',
      next_move: 'DEEPEN',
      purpose: '保留模型已生成的问题',
      completion: 'INCOMPLETE',
      recovered_from: 'loose_model_output'
    },
    next_question: question,
    done: false,
    closing_message: '',
    covered_evidence: []
  };
}

function normalizeResult(obj, rawText) {
  const question = (obj && typeof obj.next_question === 'string')
    ? obj.next_question.trim()
    : '';
  const done = !!(obj && obj.done === true);
  // 决策程序版:covered_evidence 记录「教师已明确说出的内容」,可能是任务卡证据点原文或其编号,
  // 不再强制 E1-E7;此处宽松保留非空字符串项(去空白、去重)。
  const covered = Array.isArray(obj && obj.covered_evidence)
    ? Array.from(new Set(obj.covered_evidence
        .filter((c) => typeof c === 'string' && c.trim())
        .map((c) => c.trim())))
    : [];
  const strategy = (obj && obj.state && typeof obj.state === 'object')
    ? obj.state
    : null;
  const closingMessage = (obj && typeof obj.closing_message === 'string')
    ? obj.closing_message.trim()
    : '';
  const understanding = (obj && obj.understanding && typeof obj.understanding === 'object')
    ? obj.understanding
    : null;
  return { question, closingMessage, done, evidenceHint: covered, questionStrategy: strategy, understanding };
}

function normalizeTeacherFacingText(text, teacherName) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  const providedName = String(teacherName || '').trim();
  const address = s.match(/^([\u4e00-\u9fff]{1,4})老师(?:您好)?[，,：:]\s*/);
  if (address && (!providedName || !providedName.startsWith(address[1]))) {
    s = s.slice(address[0].length).trim();
  }
  const replacements = {
    content: '内容',
    task: '任务',
    space: '空间',
    still: '仍然'
  };
  s = s.replace(/\b(content|task|space|still)\b/gi, (word) => replacements[word.toLowerCase()]);
  s = s.replace(/\b([a-d]{4})\b/gi, (order) => order.toUpperCase());
  return s;
}

function normalizeVisibleQuestion(question, teacherName) {
  let s = normalizeTeacherFacingText(question, teacherName);
  const firstQuestionMark = s.search(/[？?]/);
  if (firstQuestionMark >= 0 && /[？?]/.test(s.slice(firstQuestionMark + 1))) {
    s = s.slice(0, firstQuestionMark + 1).trim();
  }
  if (s.length > MAX_VISIBLE_QUESTION_CHARS) {
    const markers = ['我想问的是', '那在您看来', '在您看来', '那您觉得', '您觉得', '您当时', '您会', '您为什么', '什么情况下'];
    let shortened = '';
    markers.forEach((marker) => {
      let from = s.indexOf(marker, 18);
      while (from >= 0) {
        const candidate = s.slice(from).trim();
        if (candidate.length <= MAX_VISIBLE_QUESTION_CHARS && /[？?]$/.test(candidate)) shortened = candidate;
        from = s.indexOf(marker, from + marker.length);
      }
    });
    if (shortened) s = shortened;
  }
  return s;
}

function salvageVisibleQuestion(question, teacherName) {
  let s = normalizeVisibleQuestion(question, teacherName);
  const exposesInternal = /这个情境主要涉及|从这个角度看|对游戏行为的分析与回应|游戏中的观察|游戏环境创设/.test(s);
  if (exposesInternal) {
    const markers = ['我想问的是', '那在您看来', '在您看来', '那您觉得', '您觉得', '您当时', '您会', '您为什么', '什么情况下'];
    let best = '';
    markers.forEach((marker) => {
      const from = s.lastIndexOf(marker);
      if (from >= 0) {
        const candidate = s.slice(from).trim();
        if (/[？?]$/.test(candidate) && candidate.length > best.length) best = candidate;
      }
    });
    if (best) s = normalizeVisibleQuestion(best, teacherName);
  }
  if (s.length > MAX_VISIBLE_QUESTION_CHARS) {
    const sentences = s.split(/[。；;]/).map((x) => x.trim()).filter(Boolean);
    const lastQuestion = sentences.reverse().find((x) => /[？?]$/.test(x));
    if (lastQuestion) s = normalizeVisibleQuestion(lastQuestion, teacherName);
  }
  return s;
}

function visibleQuestionIssue(question) {
  const s = String(question || '').trim();
  const questionMarks = (s.match(/[？?]/g) || []).length;
  const nestedPunctuation = (s.match(/[，,；;]/g) || []).length;
  const latinWords = (s.match(/[A-Za-z]{3,}/g) || []).filter((word) => !/^[A-D]{3,4}$/.test(word));
  if (s.length > MAX_VISIBLE_QUESTION_CHARS) return 'too_long';
  if (questionMarks !== 1) return 'question_count_' + questionMarks;
  if (nestedPunctuation > 5) return 'too_many_clauses';
  if (latinWords.length) return 'mixed_language';
  if (/这个情境主要涉及|从这个角度看|对游戏行为的分析与回应|游戏中的观察|游戏环境创设/.test(s)) return 'internal_analysis_exposed';
  return '';
}

// 质量保护触发或模型调用偶发失败时，不把失败交给旧客户端去启动固定脚本。
// 只使用教师最新原话生成一条短的承接问题；下一轮仍重新调用模型，不接管访谈主线。
function buildGroundedRecoveryQuestion(event, strategy) {
  const history = (event && event.history) || [];
  const latest = latestTeacherMessage(history);
  const compactLatest = String(latest || '').replace(/\s+/g, '');
  const confusion = /(?:没|不)(?:看懂|明白|听懂)|什么意思|不知道你问|为什么问这个/.test(compactLatest);
  const teacherTurns = teacherMessages(history);
  const substantive = teacherTurns.slice().reverse().find((text) => {
    const compact = String(text || '').replace(/\s+/g, '');
    if (!compact || /(?:没|不)(?:看懂|明白|听懂)|什么意思|不知道你问|为什么问这个/.test(compact)) return false;
    return !/^(?:不知道|我也不知道|看情况吧?|都可以|都看|差不多|各种因素吧?|没有例子)$/.test(compact);
  }) || latest;
  const rawExcerpt = String(substantive || '')
    .replace(/[“”"'？?。！!，,；;：:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const unsafeAnchor = /这个情境主要涉及|从这个角度看|对游戏行为的分析与回应|游戏中的观察|游戏环境创设/.test(rawExcerpt);
  const excerpt = unsafeAnchor ? '' : (rawExcerpt.length > 24 ? rawExcerpt.slice(0, 24) + '……' : rawExcerpt);
  const anchor = excerpt ? '您刚才说“' + excerpt + '”，' : '';
  const move = String(strategy && strategy.next_move || '').toUpperCase();
  const candidates = [];

  if (!latest) {
    candidates.push('如果您是情境中的教师，看到这一幕后，您最想先判断什么？');
    candidates.push('面对这个情境，您的第一反应是什么？');
  } else if (confusion) {
    const previousAI = history.slice().reverse().find((h) => isAIRole(h.role) && h.text);
    const previousQuestion = String(previousAI && previousAI.text || '');
    const together = previousQuestion.match(/您觉得(.+?)和(.+?)这两件事怎么放在一起/);
    if (together) {
      candidates.push('我刚才想问的是：您既重视' + together[1] + '，也重视' + together[2] + '。实际处理时，您会怎样同时顾到这两点？');
    }
    candidates.push('我刚才的问题没有说清楚。' + anchor + '您为什么会特别看重这一点？');
  } else if (move === 'CLARIFY') {
    candidates.push(anchor + '您最想说明的是哪一点？');
    candidates.push(anchor + '您为什么会特别看重这一点？');
  } else if (move === 'BOUNDARY') {
    candidates.push(anchor + '什么情况下您的处理会有所不同？');
    candidates.push(anchor + '您会根据什么决定是否换一种处理？');
  } else {
    candidates.push(anchor + '您为什么会特别看重这一点？');
    candidates.push(anchor + '您希望这样的处理给孩子带来什么？');
    candidates.push(anchor + '什么情况下您的处理会有所不同？');
  }

  const previous = new Set(((event && event.history) || [])
    .filter((h) => isAIRole(h.role) && h.text)
    .map((h) => String(h.text).replace(/\s+/g, '').trim()));
  for (const candidate of candidates) {
    const normalized = normalizeVisibleQuestion(candidate, event && event.teacherName);
    if (!visibleQuestionIssue(normalized) && !previous.has(normalized.replace(/\s+/g, ''))) return normalized;
  }
  return latest
    ? '回到这个情境，您最希望先帮助孩子解决什么？'
    : '面对这个情境，您的第一反应是什么？';
}

function isExplicitStopText(text) {
  const s = String(text || '').replace(/\s+/g, '');
  return /(?:不想继续|不愿继续|不想回答|不回答了|别问了|到这里吧|就这样吧|结束吧|可以结束|不聊了)/.test(s);
}

if (process.env.NODE_ENV === 'test') {
  exports.__test = {
    INTERVIEW_POLICY,
    buildUserPrompt,
    extractLooseModelResult,
    normalizeTeacherFacingText,
    normalizeVisibleQuestion,
    salvageVisibleQuestion,
    visibleQuestionIssue,
    buildGroundedRecoveryQuestion,
    closingFromLatestTeacher,
    extractOpenAIResponseText,
    isStrongFrustrationText,
    isExplicitStopText
  };
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

function closingFromLatestTeacher(latestTeacher) {
  const latest = String(latestTeacher || '').replace(/\s+/g, ' ').trim();
  if (!latest) return DEFAULT_CLOSING_MESSAGE;
  const excerpt = latest.length > 42 ? latest.slice(0, 42) + '……' : latest;
  return '谢谢您的分享。我记下了您刚才强调的“' + excerpt + '”。本情境访谈先到这里。';
}

function normalizeClosingMessage(text, teacherName, latestTeacher) {
  const s = normalizeTeacherFacingText(text, teacherName);
  // mp 在 done=true 时会立即隐藏输入框，因此收束文本不得再要求教师回答。
  const stillAsksForAnswer = /[?？]/.test(s)
    || /请(?:您)?(?:确认|修正|补充|说明|解释|选择|回答)/.test(s)
    || /(?:能否|是否).*(?:。|！|!)?$/.test(s);
  return (!s || stillAsksForAnswer) ? closingFromLatestTeacher(latestTeacher) : s;
}

exports.main = async (event) => {
  event = event || {};
  const rounds = (event.history || []).filter((h) => isAIRole(h.role)).length;
  let llmMeta = { llmProfile: '', llmModel: '' };

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
    const user = buildUserPrompt(event, taskCard);
    const selectedLLM = resolveLLMProfile(event);
    llmMeta = llmResponseMeta(selectedLLM);
    const raw = await withTimeout(callLLM(selectedLLM, system, user), LLM_TIMEOUT_MS);
    if (!raw) throw new Error('LLM 空响应');

    const obj = parseModelJSON(raw) || extractLooseModelResult(raw);
    if (!obj) throw new Error('LLM 未返回严格JSON');
    const norm = normalizeResult(obj, raw);

    const strategy = norm.questionStrategy || {};
    const latestTeacher = latestTeacherMessage(event.history || []);
    const completion = String(strategy.completion || '').toUpperCase();
    const explicitStop = isStrongFrustrationText(latestTeacher) || isExplicitStopText(latestTeacher);
    const timeMustStop = typeof event.remainingMs === 'number' && event.remainingMs < 60000;
    const mustStop = explicitStop || timeMustStop;
    const contentComplete = rounds >= MIN_NORMAL_QUESTIONS
      && completion === 'COMPLETE'
      && norm.done;
    let done = mustStop || contentComplete;

    // 服务端只执行最低8问与明确停止边界，不再用覆盖槽、关键词元反馈、
    // 相似度或选项字母规则接管访谈内容。
    if (!done && norm.done) {
      strategy.guard_reason = rounds < MIN_NORMAL_QUESTIONS
        ? 'continued_before_minimum_eight'
        : 'continued_because_content_incomplete';
      console.warn('[interview_guard] reject close', JSON.stringify({ rounds, completion }));
    }

    let question;
    if (done) {
      question = normalizeClosingMessage(norm.closingMessage || norm.question, event.teacherName, latestTeacher);
      strategy.next_move = 'CLOSE';
      strategy.completion = mustStop ? 'MUST_STOP' : 'COMPLETE';
      strategy.guard_reason = explicitStop
        ? 'explicit_stop'
        : (timeMustStop ? 'less_than_60_seconds' : 'content_complete_after_minimum');
    } else {
      question = normalizeVisibleQuestion(norm.question, event.teacherName);
      if (!question) throw new Error('继续访谈但LLM未返回next_question');
      const wordingIssue = visibleQuestionIssue(question);
      if (wordingIssue) {
        // 先保留模型原问题的核心问句，只去掉内部前言或多余承接；确实无法抢救时才恢复。
        strategy.wording_warning = wordingIssue;
        console.warn('[interview_guard] wording warning', JSON.stringify({ rounds, wordingIssue, chars: question.length }));
        const salvaged = salvageVisibleQuestion(norm.question, event.teacherName);
        const salvageIssue = visibleQuestionIssue(salvaged);
        if (!salvageIssue) {
          question = salvaged;
          strategy.guard_reason = 'salvaged_model_question_after_' + wordingIssue;
          strategy.salvaged = true;
        } else {
          question = buildGroundedRecoveryQuestion(event, strategy);
          strategy.guard_reason = 'grounded_recovery_after_' + wordingIssue;
          strategy.recovered = true;
        }
      }
    }

    // 阶段推进保留(决策程序版由模型自身管理问题类型,stage 仅供 mp 端记录,不再注入 prompt)
    const nextStage = decideNextStage(stage, norm.evidenceHint, rounds + 1);
    if (norm.questionStrategy) console.log('[strategy]', JSON.stringify(norm.questionStrategy));

    // 内容安全
    const sec = await secCheck(question);
    if (!sec.pass) return {
      ok: false,
      error: 'msgSecCheck_failed: ' + (sec.error || ''),
      llmProfile: llmMeta.llmProfile,
      llmModel: llmMeta.llmModel
    };

    return {
      ok: true,
      question: question,
      done: done,
      evidenceHint: norm.evidenceHint,
      questionStrategy: norm.questionStrategy || null, // 研究审计用,mp 端不展示
      understanding: norm.understanding || null,
      recovered: !!strategy.recovered,
      salvaged: !!strategy.salvaged,
      llmProfile: llmMeta.llmProfile,
      llmModel: llmMeta.llmModel,
      stage: stage,           // 本轮实际使用的 stage(保留兼容)
      nextStage: nextStage    // 下一轮建议的 stage(保留兼容)
    };
  } catch (e) {
    // 老体验版收到 ok:false 会中途切入固定脚本。模型超时、空响应或JSON异常时，
    // 返回一条基于教师最新原话的短承接问题；不额外调用模型，避免增加等待时间。
    const error = (e && e.message) || 'llm_error';
    const profileConfigError = /^(?:unsupported_llm_profile|llm_profile_missing_)/.test(error);
    if (profileConfigError) {
      return {
        ok: false,
        error,
        llmProfile: llmMeta.llmProfile,
        llmModel: llmMeta.llmModel
      };
    }
    const latestTeacher = latestTeacherMessage(event.history || []);
    const mustStop = isStrongFrustrationText(latestTeacher)
      || isExplicitStopText(latestTeacher)
      || (typeof event.remainingMs === 'number' && event.remainingMs < 60000);
    const question = mustStop
      ? closingFromLatestTeacher(latestTeacher)
      : buildGroundedRecoveryQuestion(event, null);
    console.warn('[interview_recovery] model failure', JSON.stringify({ rounds, error }));
    const sec = await secCheck(question);
    if (!sec.pass) return {
      ok: false,
      error: 'msgSecCheck_failed: ' + (sec.error || ''),
      llmProfile: llmMeta.llmProfile,
      llmModel: llmMeta.llmModel
    };
    return {
      ok: true,
      question,
      done: mustStop,
      evidenceHint: [],
      questionStrategy: {
        active_thread: '教师最新表达',
        latest_new_point: latestTeacher || 'NONE',
        next_move: mustStop ? 'CLOSE' : 'DEEPEN',
        purpose: mustStop ? '吸收最新回答后安全收束' : '云端生成异常后保持当前主线',
        completion: mustStop ? 'MUST_STOP' : (rounds < MIN_NORMAL_QUESTIONS ? 'BEFORE_MINIMUM' : 'INCOMPLETE'),
        guard_reason: mustStop ? 'safe_close_after_model_failure' : 'grounded_recovery_after_model_failure',
        recovered: true
      },
      understanding: null,
      recovered: true,
      recoveryError: error,
      llmProfile: llmMeta.llmProfile,
      llmModel: llmMeta.llmModel,
      stage: STAGES.indexOf(event.stage) >= 0 ? event.stage : 'S1_CONTEXT',
      nextStage: STAGES.indexOf(event.stage) >= 0 ? event.stage : 'S1_CONTEXT'
    };
  }
};
