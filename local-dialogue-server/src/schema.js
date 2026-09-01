'use strict';

const ACTIONS = ['ASK', 'CLOSE'];
const CONFIDENCE = ['HIGH', 'MEDIUM', 'LOW'];
const HYPOTHESIS_STATUS = ['ACTIVE', 'SUPPORTED', 'WEAKENED', 'REJECTED', 'UNKNOWN'];
const RESPONSE_ORIGINS = ['RO0', 'RO1', 'RO2', 'RO3', 'RO4'];
const EVIDENCE_RELATIONS = ['SUPPORT', 'CONTRADICT', 'REVISE'];
const EVIDENCE_STATUSES = ['NOT_DEMONSTRATED', 'PARTIAL', 'SUFFICIENT', 'HIGH_QUALITY'];
const BOUNDARY_KINDS = ['NONE', 'SAFETY', 'PRIVACY', 'EXIT'];

const DIALOGUE_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ACTIONS },
    visible_text: { type: 'string' },
    direction: {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: { type: 'string' },
        open_thread_id: { type: 'string' },
        rationale: { type: 'string' },
        consulted_policy_ids: { type: 'array', items: { type: 'string' } }
      },
      required: ['label', 'open_thread_id', 'rationale', 'consulted_policy_ids']
    },
    evidence_candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          evidence_claim_id: { type: 'string' },
          understanding_id: { type: 'string' },
          relation: { type: 'string', enum: EVIDENCE_RELATIONS },
          proposed_status: { type: 'string', enum: EVIDENCE_STATUSES },
          response_origin: { type: 'string', enum: RESPONSE_ORIGINS },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          spans: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' }
        },
        required: ['evidence_claim_id', 'understanding_id', 'relation', 'proposed_status', 'response_origin', 'confidence', 'spans', 'rationale']
      }
    },
    completion_recommendation: {
      type: 'object',
      additionalProperties: false,
      properties: { recommended: { type: 'boolean' }, reason: { type: 'string' } },
      required: ['recommended', 'reason']
    },
    boundary: {
      type: 'object',
      additionalProperties: false,
      properties: { kind: { type: 'string', enum: BOUNDARY_KINDS }, policy_id: { type: 'string' } },
      required: ['kind', 'policy_id']
    },
    understanding: {
      type: 'object',
      additionalProperties: false,
      properties: {
        teacher_quote: { type: 'string' },
        meaning: { type: 'string' },
        confidence: { type: 'string', enum: CONFIDENCE }
      },
      required: ['teacher_quote', 'meaning', 'confidence']
    },
    working_hypotheses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hypothesis_id: { type: 'string' }, statement: { type: 'string' },
          status: { type: 'string', enum: HYPOTHESIS_STATUS }, confidence: { type: 'number', minimum: 0, maximum: 1 },
          source_refs: { type: 'array', items: { type: 'string' } }
        },
        required: ['hypothesis_id', 'statement', 'status', 'confidence', 'source_refs']
      }
    }
  },
  required: ['action', 'visible_text', 'direction', 'evidence_candidates', 'completion_recommendation', 'boundary', 'understanding', 'working_hypotheses']
});

// 后台证据分析与前台问句生成分离。它只返回规范 Evidence 候选，避免教师
// 必须等待冗长的证据理由、工作假设和审计字段全部生成后才看到下一问。
const EVIDENCE_ANALYSIS_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    evidence_candidates: DIALOGUE_RESPONSE_SCHEMA.properties.evidence_candidates
  },
  required: ['evidence_candidates']
});

const FAST_DIALOGUE_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ACTIONS },
    visible_text: { type: 'string' },
    direction: {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: { type: 'string' },
        open_thread_id: { type: 'string' },
        consulted_policy_ids: { type: 'array', items: { type: 'string' } }
      },
      required: ['label', 'open_thread_id', 'consulted_policy_ids']
    },
    boundary: DIALOGUE_RESPONSE_SCHEMA.properties.boundary,
    teacher_quote: { type: 'string' }
  },
  required: ['action', 'visible_text', 'direction', 'boundary', 'teacher_quote']
});

const ROOT_KEYS = new Set(DIALOGUE_RESPONSE_SCHEMA.required);
const DIRECTION_KEYS = new Set(['label', 'open_thread_id', 'rationale', 'consulted_policy_ids']);
const EVIDENCE_KEYS = new Set(['evidence_claim_id', 'understanding_id', 'relation', 'proposed_status', 'response_origin', 'confidence', 'spans', 'rationale']);
const COMPLETION_KEYS = new Set(['recommended', 'reason']);
const BOUNDARY_KEYS = new Set(['kind', 'policy_id']);
const UNDERSTANDING_KEYS = new Set(['teacher_quote', 'meaning', 'confidence']);
const HYPOTHESIS_KEYS = new Set(['hypothesis_id', 'statement', 'status', 'confidence', 'source_refs']);
const VISIBLE_LEAK_RE = /得分|分数|标准答案|专家排序|能力等级|题目入选原因|R\s*\/\s*P\s*\/\s*G|P-?IVI|\b(?:ECL|UND)-/i;
const DUPLICATE_QUESTION_ERROR = 'duplicate_question';
const LEADING_QUESTION_ERROR = 'leading_confirmation_question';
const FORMULAIC_RESTATEMENT_ERROR = 'formulaic_restatement_before_question';
const EVALUATIVE_PRAISE_ERROR = 'evaluative_praise_before_question';
const MISPLACED_APOLOGY_ERROR = 'misplaced_apology_before_question';
const WARM_AFFIRMATION_BUDGET_ERROR = 'warm_affirmation_outside_budget';
const AI_SUPPLIED_OPTIONS_ERROR = 'ai_supplied_answer_options_before_open_elicitation';
const MULTI_INTENT_QUESTION_ERROR = 'multiple_question_intents';
const INTEGRATIVE_QUALITY_ERROR = 'integrative_question_lacks_global_judgment';
const RELATIONAL_CUE_BUDGET_ERROR = 'relational_microcue_outside_budget';
const CONSECUTIVE_CHALLENGE_ERROR = 'challenge_question_without_relief_turn';
const LEADING_CONFIRMATION_RE = /(您|你)(是不是也|是否也|同意|也认为|也觉得).{0,30}[?？]|(这样|这么做|我说的).{0,16}(对吗|好吗|是吗)[?？]|(正确做法|更好的做法|应该就是).{0,30}[?？]/i;
const FORMULAIC_RESTATEMENT_OPENING_RE = /^(?:(?:我理解|我的理解|听起来|我听到|也就是说|您的意思是|你(?:刚才)?的意思是|您(?:刚才)?(?:说|提到)|刚才您(?:说|提到))|(?:明白|好的|嗯|原来如此)[，,]\s*您|您(?:一下就|选择|希望|说要|会看|觉得|从|认为|想把|要先|是根据))/u;
const RELATIONAL_MICROCUE_OPENING_RE = /^(?:(?:嗯|明白|确实|这个(?:场面|情境|取舍|判断|度|平衡)|这里|这确实|您很看重|您很在意|能看出您在|不容易|可以理解)|[^?？。；]{0,24}(?:确实|不容易|不好拿捏|需要拿捏|需要掂量|要顾|都要顾))/u;
// 保留这一识别器只为兼容旧 trace / 测试数据；R6.2 起不再安排肯定配额，
// 这些表达也按评价式前缀处理，不再向教师展示。
const WARM_AFFIRMATION_RE = /(?:很难得|很细致|很有分辨|很生动|很实际)/u;
const PROHIBITED_PRAISE_RE = /(?:很难得|很真实|很灵活|很细(?:致)?|很有分辨|很生动|很实际|很成熟|很到位|很合理|很妥当|很恰当|很稳|很不错|挺好|很好|很清楚|很准确|很敏锐|很关键|很完整|说得很完整|好(?:的)?起点|非常好|很专业|很全面|考虑得很周到|很有深度|真不错|做得很好|回答得很好|想得很周全|特别棒|能力很强|水平很高|回答正确|答得对|愿意(?:先)?(?:坦白|承认))/u;
const MISPLACED_APOLOGY_RE = /(?:抱歉|对不起|不好意思|是我(?:理解错了|误解了|假设过头了|想多了|说错了))/u;
const AI_SUPPLIED_OPTIONS_RE = /(?:比如|例如)[^?？]{0,90}(?:、|或者|或是|还是|或)[^?？]*[?？]|(?:可能是|原因是|会不会是)[^?？]{1,48}(?:、|或者|或是)[^?？]{1,48}(?:还是|或)[^?？]{1,48}[?？]|(?:您|你)(?:会|是想|更倾向于)[^?？]{2,48}(?:还是|或者|或是)[^?？]{2,48}[?？]/u;
const MULTI_INTENT_QUESTION_RE = /(?:怎么|怎样|哪些|什么)[^?？]{2,60}(?:，|、)?还是(?:会|要|能|可以|看)?(?:怎么|怎样|哪些|什么)/u;
const INTEGRATIVE_DECISION_RE = /(?:判断|决定|依据|标准|取舍|平衡|兼顾|改变|调整|坚持|例外|边界|信号)/u;
const INTEGRATIVE_SCOPE_RE = /(?:整体|综合|放在一起|同时|之间|回过来看|回到这个情境|最看重|最关键|何时|什么时候|什么情况下|哪些|什么会|后续|最终)/u;
// “如果”本身常用于顺着教师的判断追问行动，并不必然构成高负担挑战。
// 只有和失败、持续不变、反对、改弦更张或底线等压力语义同时出现时，才按挑战问题处理。
const CHALLENGE_QUESTION_RE = /(?:即使|哪怕|怎么都|不肯|拒绝|失败|无效|推翻|例外|底线|边界|一定|必须|什么时候会改变|什么情况下.{0,32}改变(?:刚才|原来|此前)?(?:的)?(?:判断|做法|立场)|何时.{0,24}何时|坚持.{0,24}例外|(?:如果|假如).{0,56}(?:仍(?:然)?|还是不|没有效果|不接受|不同意|反对|拒绝|失败|无效|改变(?:刚才|原来|此前)?(?:的)?(?:判断|做法|立场)|推翻|例外|底线|边界|怎么办))/u;
const GENTLE_QUESTION_RE = /(?:愿意说说|讲一个|当时|平时|通常|最先|先看到|先留意|具体会留意|还想补充|还有什么|从您的经验|回到当时|慢慢说)/u;

function formulaicRestatementPrefix(value) {
  const text = String(value || '').trim();
  const questionIndex = text.search(/[?？]/u);
  if (questionIndex < 0) return null;
  const beforeQuestion = text.slice(0, questionIndex);
  const boundary = beforeQuestion.search(/[。！!；;—]/u);
  if (boundary < 0) return null;
  const prefix = beforeQuestion.slice(0, boundary).trim();
  if (prefix.length <= 4 && /^(?:明白|好的|嗯|原来如此)$/u.test(prefix)) return null;
  if (!FORMULAIC_RESTATEMENT_OPENING_RE.test(beforeQuestion)) return null;
  const remainder = text.slice(boundary + 1).replace(/^[—–-]+/u, '').trim();
  if ((remainder.match(/[?？]/gu) || []).length !== 1 || remainder.length < 6) return null;
  return { prefix, remainder };
}

/**
 * 模型偶尔仍会生成“换一种说法复述教师—再追问”。如果第二句本身是完整
 * 单问，直接去掉冗余前缀，比再次调用模型更自然、更低延时；否则交给验证器退回。
 */
function normalizeNaturalQuestionOutput(value, context = {}) {
  if (!value || value.action !== 'ASK' || context.phase !== 'next' || context.allowVisibleRepair) {
    return { value, adjusted: false, removedPrefix: '' };
  }
  const match = formulaicRestatementPrefix(value.visible_text);
  if (!match) return { value, adjusted: false, removedPrefix: '' };
  return {
    value: { ...value, visible_text: match.remainder },
    adjusted: true,
    removedPrefix: match.prefix
  };
}

function exactTeacherQuote(teacherTurn, attemptedQuote = '') {
  const source = String(teacherTurn || '').trim();
  const attempted = String(attemptedQuote || '').trim();
  if (!source) return '';
  if (attempted && source.includes(attempted)) return attempted;
  const candidates = source.match(/[^。！？；;，,\n]{4,48}/gu) || [];
  if (!candidates.length) return source.slice(0, 48).trim();
  if (!attempted) return candidates[0].trim();
  const attemptedChars = new Set(Array.from(attempted.replace(/\s+/gu, '')));
  return candidates
    .map((candidate, index) => ({
      candidate: candidate.trim(),
      index,
      score: Array.from(new Set(Array.from(candidate.replace(/\s+/gu, ''))))
        .filter((char) => attemptedChars.has(char)).length
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0].candidate;
}

/**
 * teacher_quote 是后台可追溯锚点，不需要把逐字截取这一机械任务交给模型。
 * 模型若返回空串或近义改写，程序从本轮教师原话中选择一个短的逐字片段；
 * 这只修复审计字段，不改模型面向教师的问句，也不生成专业证据。
 */
function normalizeDialogueGrounding(value, context = {}) {
  if (!value || typeof value !== 'object') return { value, adjusted: false, originalQuote: '', repairedQuote: '' };
  const phase = context.phase;
  const teacherTurn = String(context.teacherTurn || '');
  const nested = value.understanding && typeof value.understanding === 'object';
  const originalQuote = String(nested ? value.understanding.teacher_quote || '' : value.teacher_quote || '');
  const repairedQuote = phase === 'first' ? '' : exactTeacherQuote(teacherTurn, originalQuote);
  if (originalQuote === repairedQuote) return { value, adjusted: false, originalQuote, repairedQuote };
  if (nested) {
    return {
      value: { ...value, understanding: { ...value.understanding, teacher_quote: repairedQuote } },
      adjusted: true,
      originalQuote,
      repairedQuote
    };
  }
  return {
    value: { ...value, teacher_quote: repairedQuote },
    adjusted: true,
    originalQuote,
    repairedQuote
  };
}

function relationalMicrocuePrefix(value) {
  const text = String(value || '').trim();
  const questionIndex = text.search(/[?？]/u);
  if (questionIndex < 0) return '';
  const beforeQuestion = text.slice(0, questionIndex);
  const boundary = beforeQuestion.search(/[。！!；;，,]/u);
  if (boundary < 0) return '';
  const prefix = beforeQuestion.slice(0, boundary).trim();
  if (!prefix || prefix.length > 24 || !RELATIONAL_MICROCUE_OPENING_RE.test(prefix)) return '';
  return prefix;
}

function hasEvaluativePraise(value) {
  const text = String(value || '').trim();
  const questionIndex = text.search(/[?？]/u);
  const visibleLead = questionIndex < 0 ? text : text.slice(0, questionIndex);
  return PROHIBITED_PRAISE_RE.test(visibleLead);
}

function hasMisplacedApology(value) {
  const text = String(value || '').trim();
  const questionIndex = text.search(/[?？]/u);
  const visibleLead = questionIndex < 0 ? text : text.slice(0, questionIndex);
  return MISPLACED_APOLOGY_RE.test(visibleLead);
}

function hasWarmAffirmation(value) {
  const text = String(value || '').trim();
  const questionIndex = text.search(/[?？]/u);
  const visibleLead = questionIndex < 0 ? text : text.slice(0, questionIndex);
  return WARM_AFFIRMATION_RE.test(visibleLead);
}

function warmAffirmationPrefix(value) {
  const text = String(value || '').trim();
  const questionIndex = text.search(/[?？]/u);
  if (questionIndex < 0) return '';
  const beforeQuestion = text.slice(0, questionIndex);
  const boundary = beforeQuestion.search(/[。！!；;]/u);
  if (boundary < 0) return '';
  const prefix = beforeQuestion.slice(0, boundary).trim();
  return prefix.length <= 24 && WARM_AFFIRMATION_RE.test(prefix) ? prefix : '';
}

function normalizeBroadPraisePrefix(value) {
  if (!value) return { value, adjusted: false, removedPrefix: '' };
  const text = String(value.visible_text || '').trim();
  if (value.action === 'CLOSE' && PROHIBITED_PRAISE_RE.test(text)) {
    return { value: { ...value, visible_text: '谢谢您的分享，本情境访谈先到这里。' }, adjusted: true, removedPrefix: text };
  }
  if (value.action !== 'ASK') return { value, adjusted: false, removedPrefix: '' };
  const questionIndex = text.search(/[?？]/u);
  if (questionIndex < 0) return { value, adjusted: false, removedPrefix: '' };
  const lead = text.slice(0, questionIndex);
  if (!PROHIBITED_PRAISE_RE.test(lead)) return { value, adjusted: false, removedPrefix: '' };
  const boundaries = [...lead.matchAll(/[。！!；;]/gu)];
  if (!boundaries.length) return { value, adjusted: false, removedPrefix: '' };
  const boundary = boundaries[boundaries.length - 1].index;
  const remainder = text.slice(boundary + 1).trim();
  if ((remainder.match(/[?？]/gu) || []).length !== 1 || remainder.length < 6) {
    return { value, adjusted: false, removedPrefix: '' };
  }
  return {
    value: { ...value, visible_text: remainder },
    adjusted: true,
    removedPrefix: text.slice(0, boundary).trim()
  };
}

function normalizeMisplacedApologyPrefix(value) {
  if (!value || value.action !== 'ASK') return { value, adjusted: false, removedPrefix: '' };
  const text = String(value.visible_text || '').trim();
  const questionIndex = text.search(/[?？]/u);
  if (questionIndex < 0) return { value, adjusted: false, removedPrefix: '' };
  const lead = text.slice(0, questionIndex);
  if (!MISPLACED_APOLOGY_RE.test(lead)) return { value, adjusted: false, removedPrefix: '' };
  const boundaries = [...lead.matchAll(/[。！!；;]/gu)];
  if (!boundaries.length) return { value, adjusted: false, removedPrefix: '' };
  const boundary = boundaries[boundaries.length - 1].index;
  const remainder = text.slice(boundary + 1).trim();
  if ((remainder.match(/[?？]/gu) || []).length !== 1 || remainder.length < 6) {
    return { value, adjusted: false, removedPrefix: '' };
  }
  return {
    value: { ...value, visible_text: remainder },
    adjusted: true,
    removedPrefix: text.slice(0, boundary).trim()
  };
}

function classifyQuestionPressure(value) {
  const text = stripQuestionShell(value);
  if (!/[?？]/u.test(String(value || ''))) return 'NONE';
  if (CHALLENGE_QUESTION_RE.test(text)) return 'CHALLENGE';
  if (isIntegrativeQuestion(value)) return 'REFLECTIVE';
  if (GENTLE_QUESTION_RE.test(text)) return 'GENTLE';
  return 'NEUTRAL';
}

function hasAiSuppliedOptions(value) {
  return AI_SUPPLIED_OPTIONS_RE.test(String(value || '').trim());
}

function isIntegrativeQuestion(value) {
  const text = stripQuestionShell(value);
  return INTEGRATIVE_DECISION_RE.test(text) && INTEGRATIVE_SCOPE_RE.test(text);
}

/**
 * 去掉不改变问题落点的承接壳和常见语气词。这不做语义判分，只为中文问句的
 * 稳健去重提供一个可解释、可测试的字面核心。
 */
function stripQuestionShell(value) {
  let text = String(value || '').normalize('NFKC').trim();
  const shells = [
    /^(?:谢谢(?:您|你)?[^,，。；;!?！？]{0,30}[,，。；;]\s*)/u,
    /^(?:您|你)?(?:刚才|前面)(?:提到|说到|谈到|说过|强调|讲到|说)[\s\S]{0,80}?[,，。；;]\s*/u,
    /^(?:听起来|我听到|我理解到|也就是说)[\s\S]{0,80}?[,，。；;]\s*/u,
    /^(?:(?:嗯|明白|确实|不容易|可以理解)|(?:这个(?:场面|情境|取舍|判断|度|平衡)|这里|这确实|您很看重|您很在意|能看出您在)[^,，。；;!?！？]{0,24}|[^,，。；;!?！？]{0,18}(?:确实|不容易|不好拿捏|需要拿捏)[^,，。；;!?！？]{0,12})[,，。；;]\s*/u,
    /^[^,，。；;!?！？]{0,24}(?:很难得|很细致|很有分辨|很生动|很实际)[^,，。；;!?！？]{0,12}[,，。；;]\s*/u
  ];
  for (let pass = 0; pass < 2; pass += 1) {
    for (const shell of shells) text = text.replace(shell, '');
  }
  return text;
}

function normalizeQuestionForComparison(value) {
  return stripQuestionShell(value)
    .toLowerCase()
    .replace(/(?:那么|那|所以|接下来|还想再了解|想再了解)/gu, '')
    .replace(/(?:能不能|能否|可不可以|可以|请)(?:您|你)?/gu, '')
    .replace(/(?:您|你)(?:觉得|会|能)?/gu, '')
    .replace(/(?:这一点|这个方面|这个考虑|这件事)/gu, '')
    .replace(/(?:为何)/gu, '为什么')
    .replace(/(?:如何|怎样)/gu, '怎么')
    .replace(/(?:不一样|有所不同)/gu, '不同')
    .replace(/(?:处理方式|回应方式)/gu, '做法')
    .replace(/(?:特别看重|最看重|重视)/gu, '看重')
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

function bigrams(value) {
  const chars = Array.from(value);
  if (chars.length < 2) return chars.length ? [chars[0]] : [];
  return chars.slice(0, -1).map((char, index) => char + chars[index + 1]);
}

function diceSimilarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const a = bigrams(left);
  const b = bigrams(right);
  const counts = new Map();
  for (const token of a) counts.set(token, (counts.get(token) || 0) + 1);
  let overlap = 0;
  for (const token of b) {
    const count = counts.get(token) || 0;
    if (!count) continue;
    overlap += 1;
    counts.set(token, count - 1);
  }
  return (2 * overlap) / (a.length + b.length);
}

const QUESTION_MOVES = Object.freeze([
  ['REPAIR', /(?:没理解|意思是|澄清|重新说|换个说法|理解得对)/u],
  ['CONDITION_CHANGE', /(?:如果|假如|什么|哪些|哪种).{0,12}(?:情况|条件|时候|变化|不同)|(?:反过来|相反|预想不同|修正|调整|改变).{0,8}(?:做法|处理|判断|回应|方向)?/u],
  ['REASON_BASIS', /(?:为什么|原因|理由|依据|考虑|看重|重视|出于什么)/u],
  ['OBSERVATION_CUE', /(?:观察|注意|留意|细节|线索|迹象|表现|信息).{0,10}(?:判断|确认|支持|介入)?/u],
  ['PRIORITY_TRADEOFF', /(?:最先|首先|优先|排序|权衡|更靠前|取舍)/u],
  ['OUTCOME_GOAL', /(?:希望|获得|带来|影响|结果|最想帮助|解决什么)/u],
  ['ACTION_RESPONSE', /(?:怎么|如何|怎样).{0,8}(?:做|处理|介入|回应|支持|引导|调整|判断)/u],
  ['CONCRETE_EXAMPLE', /(?:具体例子|举个例子|实际发生|某一次)/u]
]);

function questionMove(value) {
  const text = stripQuestionShell(value).normalize('NFKC');
  const matched = QUESTION_MOVES.find(([, pattern]) => pattern.test(text));
  return matched ? matched[0] : 'OTHER';
}

function questionAnchor(value, move) {
  let text = normalizeQuestionForComparison(value);
  const common = /(?:幼儿|孩子|教师|情境|现场|刚才|原来|这个|那个|做法|处理|方向|判断|回应|问题|方面|一个|哪一个|什么|怎么|为什么)/gu;
  text = text.replace(common, '');
  if (move === 'CONDITION_CHANGE') text = text.replace(/(?:如果|假如|情况|条件|时候|出现|发生|变化|不同|相反|改变|调整|修正|重新|关键|新|时)/gu, '');
  else if (move === 'REASON_BASIS') text = text.replace(/(?:原因|理由|依据|考虑|看重|重视|出于)/gu, '');
  else if (move === 'OBSERVATION_CUE') text = text.replace(/(?:观察|注意|留意|细节|线索|迹象|表现|信息|确认|支持)/gu, '');
  else if (move === 'PRIORITY_TRADEOFF') text = text.replace(/(?:最先|首先|优先|排序|权衡|更靠前|取舍)/gu, '');
  else if (move === 'OUTCOME_GOAL') text = text.replace(/(?:希望|获得|带来|影响|结果|帮助|解决)/gu, '');
  else if (move === 'ACTION_RESPONSE') text = text.replace(/(?:做|处理|介入|回应|支持|引导|调整)/gu, '');
  return text.replace(/(?:的|地|得|会|要|想|能|可能|应该|可以)/gu, '');
}

function hasConflictingConcreteMarker(left, right) {
  const a = normalizeQuestionForComparison(left);
  const b = normalizeQuestionForComparison(right);
  const markers = [
    /[a-d]/gu,
    /介入|等待|观察|支持|引导|询问|制止|阻止|撤离|加入|退出|提醒|示范/gu
  ];
  for (const pattern of markers) {
    const leftSet = new Set(a.match(pattern) || []);
    const rightSet = new Set(b.match(pattern) || []);
    if (!leftSet.size || !rightSet.size) continue;
    const overlap = [...leftSet].some((marker) => rightSet.has(marker));
    if (!overlap) return true;
  }
  return false;
}

function moveSimilarity(left, right) {
  const leftMove = questionMove(left);
  const rightMove = questionMove(right);
  if (leftMove === 'OTHER' || leftMove !== rightMove) return 0;
  const leftAnchor = questionAnchor(left, leftMove);
  const rightAnchor = questionAnchor(right, rightMove);
  // 相同认知动作不等于相同问题。选项、行动对象不同，必须保留为有效的新追问。
  if (hasConflictingConcreteMarker(left, right)) return 0;
  // 落点类型相同且两边都没有足以区分的具体对象，就是“换皮复问”。
  if (leftAnchor.length <= 3 && rightAnchor.length <= 3) {
    if (!leftAnchor && !rightAnchor) return 0.9;
    if (leftAnchor === rightAnchor) return 0.9;
    return diceSimilarity(leftAnchor, rightAnchor) >= 0.67 ? 0.82 : 0;
  }
  if (!leftAnchor || !rightAnchor) return 0.82;
  const anchorScore = diceSimilarity(leftAnchor, rightAnchor);
  return anchorScore >= 0.5 ? Math.max(0.82, anchorScore) : 0;
}

function questionSimilarity(left, right) {
  const a = normalizeQuestionForComparison(left);
  const b = normalizeQuestionForComparison(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length >= 8 && longer.includes(shorter) && shorter.length / longer.length >= 0.78) return 0.95;
  return Math.max(diceSimilarity(a, b), moveSimilarity(left, right));
}

function recentAssistantQuestions(history, limit = 5) {
  return (Array.isArray(history) ? history : [])
    .filter((turn) => turn && ['assistant', 'ai', 'agent'].includes(turn.role))
    .map((turn) => String(turn.text || turn.content || '').trim())
    .filter((text) => /[?？]/.test(text))
    .slice(-limit);
}

function findNearDuplicateQuestion(candidate, history, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.78;
  const questions = recentAssistantQuestions(history, options.limit || 5);
  for (let index = questions.length - 1; index >= 0; index -= 1) {
    const score = questionSimilarity(candidate, questions[index]);
    if (score >= threshold) {
      return { matched: questions[index], score, normalized: normalizeQuestionForComparison(candidate) };
    }
  }
  return null;
}

function isPlainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function exactKeys(value, allowed, path, errors) {
  if (!isPlainObject(value)) { errors.push(`${path} must be an object`); return false; }
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
  for (const key of allowed) if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key} is required`);
  return true;
}

function collectEvidencePolicyIndex(compiledCard) {
  const index = new Map();
  for (const policy of Array.isArray(compiledCard && compiledCard.evidencePolicies) ? compiledCard.evidencePolicies : []) {
    if (policy && (policy.claimType === 'ORIGIN_POLICY' || policy.runtimeUse === 'ORIGIN_POLICY')) continue;
    if (policy && policy.claimType && policy.claimType !== 'CAPABILITY_EVIDENCE') continue;
    const claimId = String(policy && policy.evidenceClaimId || '').trim();
    const understandingId = String(policy && policy.understandingId || '').trim();
    if (!claimId || !understandingId) continue;
    index.set(claimId, {
      understandingId,
      allowedResponseOrigins: Array.isArray(policy.allowedResponseOrigins) ? policy.allowedResponseOrigins.filter((origin) => RESPONSE_ORIGINS.includes(origin)) : []
    });
  }
  return index;
}

function collectDialoguePolicyIndex(compiledCard) {
  const all = new Set();
  const hard = new Set();
  for (const policy of Array.isArray(compiledCard && compiledCard.dialoguePolicies) ? compiledCard.dialoguePolicies : []) {
    const id = String(policy && policy.policyId || '').trim();
    if (!id) continue;
    all.add(id);
    if (policy.type === 'HARD_BOUNDARY') hard.add(id);
  }
  return { all, hard };
}

function validateDialogueOutput(value, context = {}) {
  const errors = [];
  if (!exactKeys(value, ROOT_KEYS, 'output', errors)) return { ok: false, errors };
  const policyIndex = collectDialoguePolicyIndex(context.compiledCard);
  if (!ACTIONS.includes(value.action)) errors.push('output.action must be ASK or CLOSE');
  if (typeof value.visible_text !== 'string') errors.push('output.visible_text must be a string');

  if (exactKeys(value.direction, DIRECTION_KEYS, 'output.direction', errors)) {
    if (typeof value.direction.label !== 'string' || !value.direction.label.trim()) errors.push('output.direction.label must be non-empty');
    if (typeof value.direction.open_thread_id !== 'string') errors.push('output.direction.open_thread_id must be a string');
    if (typeof value.direction.rationale !== 'string') errors.push('output.direction.rationale must be a string');
    if (!Array.isArray(value.direction.consulted_policy_ids) || value.direction.consulted_policy_ids.some((id) => typeof id !== 'string')) errors.push('output.direction.consulted_policy_ids must be a string array');
    else for (const id of value.direction.consulted_policy_ids) if (!policyIndex.all.has(id)) errors.push(`output.direction.consulted_policy_ids contains unknown policy: ${id}`);
  }

  if (!Array.isArray(value.evidence_candidates)) errors.push('output.evidence_candidates must be an array');
  else {
    const evidencePolicyIndex = collectEvidencePolicyIndex(context.compiledCard);
    value.evidence_candidates.forEach((candidate, index) => {
      const path = `output.evidence_candidates[${index}]`;
      if (!exactKeys(candidate, EVIDENCE_KEYS, path, errors)) return;
      const claimId = String(candidate.evidence_claim_id || '').trim();
      const understandingId = String(candidate.understanding_id || '').trim();
      const evidencePolicy = evidencePolicyIndex.get(claimId);
      if (!claimId) errors.push(`${path}.evidence_claim_id must be non-empty`);
      else if (!evidencePolicy) errors.push(`${path}.evidence_claim_id is not present in compiled_card.evidencePolicies`);
      if (!understandingId) errors.push(`${path}.understanding_id must be non-empty`);
      else if (evidencePolicy && evidencePolicy.understandingId !== understandingId) errors.push(`${path}.understanding_id does not match its evidence policy`);
      if (!EVIDENCE_RELATIONS.includes(candidate.relation)) errors.push(`${path}.relation is invalid`);
      if (!EVIDENCE_STATUSES.includes(candidate.proposed_status)) errors.push(`${path}.proposed_status is invalid`);
      if (!RESPONSE_ORIGINS.includes(candidate.response_origin)) errors.push(`${path}.response_origin must be RO0 through RO4`);
      else if (evidencePolicy && evidencePolicy.allowedResponseOrigins.length && !evidencePolicy.allowedResponseOrigins.includes(candidate.response_origin)) errors.push(`${path}.response_origin is not allowed by its evidence policy`);
      if (typeof candidate.confidence !== 'number' || candidate.confidence < 0 || candidate.confidence > 1) errors.push(`${path}.confidence must be from 0 to 1`);
      if (!Array.isArray(candidate.spans) || !candidate.spans.length) errors.push(`${path}.spans must contain at least one exact quote`);
      for (const span of Array.isArray(candidate.spans) ? candidate.spans : []) if (typeof span !== 'string' || !span || !String(context.teacherTurn || '').includes(span)) errors.push(`${path}.spans must quote the current teacher turn exactly`);
      if (typeof candidate.rationale !== 'string') errors.push(`${path}.rationale must be a string`);
    });
  }

  if (exactKeys(value.completion_recommendation, COMPLETION_KEYS, 'output.completion_recommendation', errors)) {
    if (typeof value.completion_recommendation.recommended !== 'boolean') errors.push('output.completion_recommendation.recommended must be a boolean');
    if (typeof value.completion_recommendation.reason !== 'string') errors.push('output.completion_recommendation.reason must be a string');
  }
  if (exactKeys(value.boundary, BOUNDARY_KEYS, 'output.boundary', errors)) {
    if (!BOUNDARY_KINDS.includes(value.boundary.kind)) errors.push('output.boundary.kind is invalid');
    if (typeof value.boundary.policy_id !== 'string') errors.push('output.boundary.policy_id must be a string');
    if (value.boundary.kind === 'NONE' && value.boundary.policy_id) errors.push('output.boundary.policy_id must be empty when kind=NONE');
    if (value.boundary.kind !== 'NONE' && !policyIndex.hard.has(value.boundary.policy_id)) errors.push('output.boundary.policy_id must identify a HARD_BOUNDARY policy');
    if (value.boundary.kind === 'EXIT' && value.action !== 'CLOSE') errors.push('output.action must be CLOSE when boundary.kind=EXIT');
  }
  if (exactKeys(value.understanding, UNDERSTANDING_KEYS, 'output.understanding', errors)) {
    if (typeof value.understanding.teacher_quote !== 'string') errors.push('output.understanding.teacher_quote must be a string');
    if (typeof value.understanding.meaning !== 'string') errors.push('output.understanding.meaning must be a string');
    if (!CONFIDENCE.includes(value.understanding.confidence)) errors.push('output.understanding.confidence is invalid');
  }
  if (!Array.isArray(value.working_hypotheses)) errors.push('output.working_hypotheses must be an array');
  else value.working_hypotheses.forEach((hypothesis, index) => {
    const path = `output.working_hypotheses[${index}]`;
    if (!exactKeys(hypothesis, HYPOTHESIS_KEYS, path, errors)) return;
    if (typeof hypothesis.hypothesis_id !== 'string' || !hypothesis.hypothesis_id.trim()) errors.push(`${path}.hypothesis_id must be non-empty`);
    if (typeof hypothesis.statement !== 'string' || !hypothesis.statement.trim()) errors.push(`${path}.statement must be non-empty`);
    if (!HYPOTHESIS_STATUS.includes(hypothesis.status)) errors.push(`${path}.status is invalid`);
    if (typeof hypothesis.confidence !== 'number' || hypothesis.confidence < 0 || hypothesis.confidence > 1) errors.push(`${path}.confidence must be from 0 to 1`);
    if (!Array.isArray(hypothesis.source_refs) || hypothesis.source_refs.some((ref) => typeof ref !== 'string')) errors.push(`${path}.source_refs must be a string array`);
  });

  const teacherTurn = String(context.teacherTurn || '');
  const quote = value.understanding && String(value.understanding.teacher_quote || '');
  if (context.phase === 'first' && quote) errors.push('output.understanding.teacher_quote must be empty on the first turn');
  if (context.phase === 'next' && !quote.trim()) errors.push('output.understanding.teacher_quote must contain a non-empty exact quote on a follow-up turn');
  if (context.phase === 'next' && quote && !teacherTurn.includes(quote)) errors.push('output.understanding.teacher_quote must quote the current teacher turn exactly');
  if (context.phase === 'first' && value.evidence_candidates && value.evidence_candidates.length) errors.push('output.evidence_candidates must be empty on the first turn');

  const visibleText = String(value.visible_text || '').trim();
  if (!visibleText) errors.push('output.visible_text must be non-empty');
  if (value.action === 'ASK' && (visibleText.match(/[?？]/g) || []).length !== 1) errors.push('output.visible_text must contain exactly one question mark when action=ASK');
  if (value.action === 'CLOSE' && /[?？]/.test(visibleText)) errors.push('output.visible_text must not ask a question when action=CLOSE');
  if (value.action === 'ASK') {
    const duplicate = findNearDuplicateQuestion(visibleText, context.history);
    if (duplicate) errors.push(`${DUPLICATE_QUESTION_ERROR}: output.visible_text is too similar to a recent assistant question (${duplicate.score.toFixed(2)})`);
    if (LEADING_CONFIRMATION_RE.test(visibleText)) errors.push(`${LEADING_QUESTION_ERROR}: output.visible_text asks the teacher to endorse an answer supplied by AI`);
    if (context.phase === 'next' && !context.allowVisibleRepair && formulaicRestatementPrefix(visibleText)) {
      errors.push(`${FORMULAIC_RESTATEMENT_ERROR}: output.visible_text restates the teacher before asking`);
    }
    if (hasEvaluativePraise(visibleText)) {
      errors.push(`${EVALUATIVE_PRAISE_ERROR}: broad praise must not grade the teacher's answer or ability`);
    }
    if (hasMisplacedApology(visibleText)) {
      errors.push(`${MISPLACED_APOLOGY_ERROR}: calibrate the premise neutrally instead of apologizing or self-blaming`);
    }
    const warmAffirmationObserved = hasWarmAffirmation(visibleText);
    if (warmAffirmationObserved && !context.warmAffirmationAllowed) {
      errors.push(`${WARM_AFFIRMATION_BUDGET_ERROR}: a concrete affirmation is only allowed on one of the two scheduled turns`);
    }
    if (context.warmAffirmationRequired && !warmAffirmationObserved) {
      errors.push(`${WARM_AFFIRMATION_BUDGET_ERROR}: this scheduled warmth turn requires one short concrete affirmation`);
    }
    if (context.relationshipMoveRequested === 'NONE' && (relationalMicrocuePrefix(visibleText) || warmAffirmationObserved)) {
      errors.push(`${RELATIONAL_CUE_BUDGET_ERROR}: this turn should advance directly without another prefatory relationship cue`);
    }
    if (!context.allowScaffoldedOptions && hasAiSuppliedOptions(visibleText)) {
      errors.push(`${AI_SUPPLIED_OPTIONS_ERROR}: ask the teacher to generate distinctions before supplying examples or choices`);
    }
    if (MULTI_INTENT_QUESTION_RE.test(visibleText)) {
      errors.push(`${MULTI_INTENT_QUESTION_ERROR}: ask one substantive intent instead of joining two alternatives`);
    }
    if (context.questionMode === 'INTEGRATIVE_SYNTHESIS' && !isIntegrativeQuestion(visibleText)) {
      errors.push(`${INTEGRATIVE_QUALITY_ERROR}: final new question must elicit an overall basis, tradeoff, boundary, or change condition`);
    }
    if (context.mustRelaxPressure && classifyQuestionPressure(visibleText) === 'CHALLENGE') {
      errors.push(`${CONSECUTIVE_CHALLENGE_ERROR}: follow a demanding question with a lower-pressure descriptive or reflective turn`);
    }
  }
  if (value.action === 'CLOSE' && hasEvaluativePraise(visibleText)) {
    errors.push(`${EVALUATIVE_PRAISE_ERROR}: closing text must not grade the teacher's answer or ability`);
  }
  if (visibleText.length > (context.maxQuestionChars || 140)) errors.push('output.visible_text is too long');
  if (VISIBLE_LEAK_RE.test(visibleText)) errors.push('teacher-visible text exposes protected internal information');
  return { ok: errors.length === 0, errors };
}

function assessQuestionQuality(value, context = {}) {
  const text = String(value?.visible_text || '').trim();
  const teacherTurn = String(context.teacherTurn || '');
  const quote = String(value?.understanding?.teacher_quote || '').trim();
  const duplicate = value?.action === 'ASK' ? findNearDuplicateQuestion(text, context.history) : null;
  const signals = {
    oneQuestion: value?.action !== 'ASK' || (text.match(/[?？]/g) || []).length === 1,
    concise: text.length <= (context.maxQuestionChars || 140),
    nonLeading: !LEADING_CONFIRMATION_RE.test(text),
    novel: !duplicate,
    contingentOnTeacherTurn: context.phase === 'first' || Boolean(quote && teacherTurn.includes(quote)),
    visibleChars: text.length,
    matchedTeacherQuote: quote,
    duplicateScore: duplicate ? Number(duplicate.score.toFixed(3)) : 0,
    formulaicRestatementOpening: Boolean(formulaicRestatementPrefix(text)),
    relationalMicrocueObserved: Boolean(relationalMicrocuePrefix(text) || warmAffirmationPrefix(text)),
    relationalCuePrefix: relationalMicrocuePrefix(text) || warmAffirmationPrefix(text),
    warmAffirmationObserved: hasWarmAffirmation(text),
    broadPraiseAvoided: !hasEvaluativePraise(text),
    misplacedApologyAvoided: !hasMisplacedApology(text),
    nonEvaluativeWarmth: !hasEvaluativePraise(text)
      && (!hasWarmAffirmation(text) || Boolean(context.warmAffirmationAllowed)),
    openBeforeScaffold: Boolean(context.allowScaffoldedOptions) || !hasAiSuppliedOptions(text),
    integrativeEnough: context.questionMode !== 'INTEGRATIVE_SYNTHESIS' || isIntegrativeQuestion(text),
    questionPressure: classifyQuestionPressure(text),
    pressurePacingRespected: !context.mustRelaxPressure || classifyQuestionPressure(text) !== 'CHALLENGE',
    relationshipBudgetRespected: context.relationshipMoveRequested !== 'NONE'
      || !(relationalMicrocuePrefix(text) || hasWarmAffirmation(text))
  };
  return {
    ...signals,
    passed: signals.oneQuestion
      && signals.concise
      && signals.nonLeading
      && signals.novel
      && signals.contingentOnTeacherTurn
      && signals.nonEvaluativeWarmth
      && signals.misplacedApologyAvoided
      && signals.openBeforeScaffold
      && signals.integrativeEnough
      && signals.pressurePacingRespected
      && signals.relationshipBudgetRespected
  };
}

function validateEvidenceAnalysisOutput(value, context = {}) {
  const errors = [];
  if (!exactKeys(value, new Set(['evidence_candidates']), 'output', errors)) return { ok: false, errors };
  const candidates = Array.isArray(value.evidence_candidates) ? value.evidence_candidates : [];
  if (!Array.isArray(value.evidence_candidates)) errors.push('output.evidence_candidates must be an array');
  const teacherTurn = String(context.teacherTurn || '');
  const evidencePolicyIndex = collectEvidencePolicyIndex(context.compiledCard);
  candidates.forEach((candidate, index) => {
    const path = `output.evidence_candidates[${index}]`;
    if (!exactKeys(candidate, EVIDENCE_KEYS, path, errors)) return;
    const claimId = String(candidate.evidence_claim_id || '').trim();
    const understandingId = String(candidate.understanding_id || '').trim();
    const policy = evidencePolicyIndex.get(claimId);
    if (!claimId || !policy) errors.push(`${path}.evidence_claim_id is not present in compiled_card.evidencePolicies`);
    if (!understandingId || (policy && policy.understandingId !== understandingId)) errors.push(`${path}.understanding_id does not match its evidence policy`);
    if (!EVIDENCE_RELATIONS.includes(candidate.relation)) errors.push(`${path}.relation is invalid`);
    if (!EVIDENCE_STATUSES.includes(candidate.proposed_status)) errors.push(`${path}.proposed_status is invalid`);
    if (!RESPONSE_ORIGINS.includes(candidate.response_origin)) errors.push(`${path}.response_origin must be RO0 through RO4`);
    else if (policy && policy.allowedResponseOrigins.length && !policy.allowedResponseOrigins.includes(candidate.response_origin)) errors.push(`${path}.response_origin is not allowed by its evidence policy`);
    if (typeof candidate.confidence !== 'number' || candidate.confidence < 0 || candidate.confidence > 1) errors.push(`${path}.confidence must be from 0 to 1`);
    if (!Array.isArray(candidate.spans) || !candidate.spans.length) errors.push(`${path}.spans must contain at least one exact quote`);
    for (const span of Array.isArray(candidate.spans) ? candidate.spans : []) {
      if (typeof span !== 'string' || !span || !teacherTurn.includes(span)) errors.push(`${path}.spans must quote the current teacher turn exactly`);
    }
    if (typeof candidate.rationale !== 'string') errors.push(`${path}.rationale must be a string`);
  });
  return { ok: errors.length === 0, errors };
}

function normalizeFastDialogueOutput(value, phase) {
  if (value && Array.isArray(value.evidence_candidates)) return value;
  const quote = String(value?.teacher_quote || '');
  const action = value?.action;
  return {
    action,
    visible_text: String(value?.visible_text || ''),
    direction: {
      label: String(value?.direction?.label || '继续理解教师'),
      open_thread_id: String(value?.direction?.open_thread_id || ''),
      rationale: String(value?.direction?.label || '低延时前台方向'),
      consulted_policy_ids: Array.isArray(value?.direction?.consulted_policy_ids) ? value.direction.consulted_policy_ids : []
    },
    evidence_candidates: [],
    completion_recommendation: {
      recommended: action === 'CLOSE',
      reason: action === 'CLOSE' ? '前台判断本情境可收束' : '继续开放理解教师'
    },
    boundary: value?.boundary || { kind: 'NONE', policy_id: '' },
    understanding: {
      teacher_quote: phase === 'first' ? '' : quote,
      meaning: phase === 'first' ? '尚未获得教师回答' : `教师本轮强调：${quote}`,
      confidence: phase === 'first' ? 'LOW' : 'MEDIUM'
    },
    working_hypotheses: []
  };
}

module.exports = {
  DIALOGUE_RESPONSE_SCHEMA,
  FAST_DIALOGUE_RESPONSE_SCHEMA,
  EVIDENCE_ANALYSIS_SCHEMA,
  DUPLICATE_QUESTION_ERROR,
  LEADING_QUESTION_ERROR,
  FORMULAIC_RESTATEMENT_ERROR,
  EVALUATIVE_PRAISE_ERROR,
  MISPLACED_APOLOGY_ERROR,
  WARM_AFFIRMATION_BUDGET_ERROR,
  AI_SUPPLIED_OPTIONS_ERROR,
  MULTI_INTENT_QUESTION_ERROR,
  INTEGRATIVE_QUALITY_ERROR,
  RELATIONAL_CUE_BUDGET_ERROR,
  CONSECUTIVE_CHALLENGE_ERROR,
  formulaicRestatementPrefix,
  normalizeNaturalQuestionOutput,
  exactTeacherQuote,
  normalizeDialogueGrounding,
  normalizeBroadPraisePrefix,
  normalizeMisplacedApologyPrefix,
  relationalMicrocuePrefix,
  hasEvaluativePraise,
  hasMisplacedApology,
  hasWarmAffirmation,
  warmAffirmationPrefix,
  hasAiSuppliedOptions,
  isIntegrativeQuestion,
  classifyQuestionPressure,
  validateDialogueOutput,
  assessQuestionQuality,
  validateEvidenceAnalysisOutput,
  normalizeFastDialogueOutput,
  collectEvidencePolicyIndex,
  collectDialoguePolicyIndex,
  normalizeQuestionForComparison,
  questionMove,
  questionAnchor,
  questionSimilarity,
  recentAssistantQuestions,
  findNearDuplicateQuestion,
  RESPONSE_ORIGINS,
  EVIDENCE_RELATIONS,
  EVIDENCE_STATUSES
};
