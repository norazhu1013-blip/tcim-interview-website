'use strict';

const crypto = require('crypto');
const { classifyQuestionPressure } = require('./schema');

const PROMPT_VERSION = 'tcim-dialogue-v3-low-latency-2026-09-01-r7-neutral-peer-fast';

const EXPLICIT_REPAIR_RE = /(?:不是.{0,8}(?:意思|说)|我的意思是|我说的是|你没理解|没听懂|理解错|误解|换个说法|重新说|不是这样)/u;
const HYPOTHETICAL_PREMISE_RE = /(?:(?:题目|情境).{0,8}(?:假设|设定)|没有遇到过?完全相同|并非真实经历)/u;
const PREMISE_RESISTANCE_RE = /(?:(?:现实|实际|真实情况).{0,12}(?:不会|不可能|很少|不存在)|(?:题目|情境).{0,10}(?:不合理|不成立|有问题|太假)|无法(?:按这个|这样)?判断)/u;
const PREMISE_OPT_OUT_RE = /(?:(?:不想|不愿意|没法|无法).{0,8}(?:假设|回答|讨论)|(?:这个|这题).{0,8}(?:没法回答|不想回答))/u;
const SUBSTANTIVE_JUDGMENT_RE = /(?:我会|我可能|我通常|我一般|类似情况|类似经历|平时|以前|有一次|先.{0,12}(?:看|问|听|观察|了解)|观察|留意|判断|根据|决定|考虑|取舍|调整|介入|等待|支持)/u;
const FORMULAIC_RESTATEMENT_RE = /^(?:我理解|我的理解|听起来|我听到|也就是说|您的意思是|你(?:刚才)?的意思是|您(?:刚才)?(?:说|提到)|刚才您(?:说|提到))/u;
const RELATIONAL_CUE_RE = /^(?:(?:嗯|明白|确实|这个(?:场面|情境|取舍|判断|度|平衡)|这里|这确实|您很看重|您很在意|能看出您在|不容易|可以理解)|[^?？。；]{0,24}(?:确实|不容易|不好拿捏|需要拿捏|需要掂量|要顾|都要顾))/u;
const COMPLEXITY_RE = /(?:难|纠结|担心|顾虑|不确定|拿不准|矛盾|两难|但是|不过|既要|又要|同时|取舍|权衡|冲突)/u;
const SCAFFOLD_REQUEST_RE = /(?:不清楚|不明白|没听懂|不知道(?:怎么|如何)?回答|具体问什么|解释一下|说明一下|举个例子|换个问法)/u;
const OPTION_SUGGESTION_RE = /(?:比如|例如)[^?？]{0,90}(?:、|或者|或是|还是)|(?:可能是|原因是|会不会是)[^?？]{1,48}(?:、|或者|或是)[^?？]{1,48}(?:还是|或)[^?？]{1,48}[?？]|(?:您|你)(?:会|是想|更倾向于)[^?？]{2,48}(?:还是|或者|或是)[^?？]{2,48}[?？]/u;
const EXPLANATION_RE = /(?:我是指|我的意思是|换句话说|也可以理解为|这里说的.{0,16}是指|更具体地说)/u;
function hasVisiblePreface(value) {
  const text = String(value || '').trim();
  const questionIndex = text.search(/[?？]/u);
  if (questionIndex < 0) return false;
  return /[。！!；;]/u.test(text.slice(0, questionIndex));
}

function strongerOrigin(left, right) {
  const order = ['RO0', 'RO1', 'RO2', 'RO3', 'RO4'];
  const leftIndex = order.indexOf(String(left || ''));
  const rightIndex = order.indexOf(String(right || ''));
  return order[Math.max(leftIndex, rightIndex, 1)];
}

/**
 * 回答来源不能只让模型自报。若上一问明显由 AI 给出选项或解释，程序给出
 * 不可向上漂移的来源下限，防止把“在提示后能够回应”误记成教师自主提出。
 */
function elicitationOriginGuard(elicitingQuestion) {
  const question = String(elicitingQuestion || '').trim();
  if (!question) return { enforced: false, minimum_origin: null, reason: 'no_eliciting_question' };
  if (EXPLANATION_RE.test(question)) {
    return { enforced: true, minimum_origin: 'RO4', reason: 'ai_explanation_preceded_response' };
  }
  if (OPTION_SUGGESTION_RE.test(question)) {
    return { enforced: true, minimum_origin: 'RO3', reason: 'ai_supplied_options_preceded_response' };
  }
  return { enforced: false, minimum_origin: null, reason: 'open_or_neutral_question' };
}

function applyElicitationOriginGuard(candidates, guard) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate) => {
    if (!guard?.enforced || !guard.minimum_origin) return candidate;
    return { ...candidate, response_origin: strongerOrigin(candidate?.response_origin, guard.minimum_origin) };
  });
}

const FAST_SYSTEM_PROMPT = [
  '你是 TCIM 幼儿园教师专业访谈的前台 Dialogue Agent。目标是开放理解教师的游戏支持与引导能力，并自然提出下一问。',
  '五表运行卡是专业地图和边界，不是标准答案或必问清单。由你决定如何理解、承接、转向或收束。',
  '默认直接、自然地接着教师刚才的内容问下去，不采用每轮“先复述/核实—再提问”的固定格式。ASK 必须且只能有一个问号，visible_text 不超过140字。',
  '能直接问就直接问。避免“您希望……。您怎么判断……？”“您选择……。接下来……”这类先把教师原话改写一遍、再提问的两句式。可偶尔使用“嗯”“明白”等极短承接，但不得每轮重复。',
  '面对成年专业教师，采用同行式、尊重、克制而有人情味的口吻，不幼态化、不治疗化、不居高临下。温度来自问题真正接得上和允许复杂性，不来自评价教师。',
  '不要评价教师的表达、诚实、人格、能力或做法质量。禁止“很难得、很真实、很灵活、很细致、很有分辨、很稳、很专业”等表扬，也不要说教师“愿意坦白/承认”。',
  'frontstage_response_style.relational_move 不为 NONE 时，可用零到一句4—20字的中性承接，例如“明白”“这里确实需要取舍”；随后仍只问一个问题。不要为了显得温暖强行加前缀。',
  '教师提到“这是题目假设/没有完全相同经历”时，不要机械套一句确认。先判断这句话的作用：若后面已经给出判断，直接跟随其实质内容；若只是说明经验边界，才中性确认按假设情境或类似经验讨论；若认为前提不成立，开放询问哪个条件需要改写；若不愿或无法继续，降低负担、允许换角度或收束。不要立即道歉、自责或说“是我假设过头了”。教师纠正了你对其原话的理解时，才简短修正理解。以上情况都不得描述成教师的坦白、诚实或勇气。',
  '关系承接已经点出某个关切或取舍后，紧随其后的问题不要再次换词重复同一内容；直接问更具体的行动、观察、条件或理由。',
  'teacher_quote 与内部理解字段用于后台审计，不要求也不应默认复制到 visible_text。让教师感到被理解，主要靠问题确实接得上，而不是把教师的话换一种说法再说一遍。',
  '只有教师明确纠正你、原话确有两种关键理解，或误解会显著改变后续方向时，才用一句很短的理解修复；普通轮次不要习惯性以“我理解/听起来/也就是说/您的意思是/您说或您刚才说”开头。',
  '优先跟随教师最新原话中的新区别、理由、观察、行动或条件；不得复问同一问句，也不要重复近期问题的实质落点。无新价值时可以 CLOSE。',
  'runtime_limits.question_mode=INTEGRATIVE_SYNTHESIS 时，这是本题最后一个新问题：综合整段交谈和情境目标，在内部选择最能增进整体理解、最能区分能力表现的一处，提出一个贴近情境而有整体性的问题；不要先向教师展示总结，不要多问合一，也不要诱导其认同AI的概括。',
  '遵守 frontstage_response_style.pressure_pacing：CHALLENGE 是反事实、失败情形、例外/底线或要求改变立场的高负担问题。整题通常不超过2次，而且绝不连续出现。next_move=RELAX 时，下一问必须降低负担，优先邀请教师回到真实经验、一个观察细节、当时首先注意的事情或自由补充；不得继续追加“如果仍然……”“那什么情况下……”式挑战。',
  '本次三题访谈只是形成有价值的理解样本，不负责一次性穷尽教师全部能力。允许专业地图中仍有未知；不要为了覆盖更多栏目而连续加压，无明显新增价值时可以温和收束。',
  'dialogue_progress_state.stagnation.score 升高表示进展不足，此时必须换实质落点、减轻问题负担或收束。',
  '不得评价教师对错、能力等级、人格或动机；不得透露分数、排序规则、Evidence ID、内部先验。教师纠正时先接受，短答或疲劳时降低负担。',
  '不得先提供一套专业答案、行动方案或价值判断，再请教师认同；不得把教师对AI内容的认同当作其原有能力证据。',
  '遵循“开放问题优先、澄清其次、示例最后”的分层支架：先让教师自行提出原因、类别、标准或做法。只有 frontstage_response_style.support_level=SCAFFOLD_ALLOWED 时才可给少量例子或选项；一旦给出，后台必须按RO3/RO4而非自主证据理解。',
  'AFFORDANCE/MONITOR 只是建议；只有 HARD_BOUNDARY 必须遵守。boundary 非 NONE 时必须引用对应 HARD_BOUNDARY policy_id。',
  '这是前台低延时调用：只决定问题、方向和硬边界；Evidence、详细理解、假设和完成理由由程序或后台补齐。',
  '首问 teacher_quote 为空；后续轮 teacher_quote 必须从本轮教师原话逐字引用一个短片段。direction.label 要短。只输出符合 JSON Schema 的对象。'
].join('\n');

const EVIDENCE_SYSTEM_PROMPT = [
  '你是 TCIM 的后台 Evidence Analyzer，不与教师直接说话，也不生成下一问。',
  '只分析当前教师原话能否支持运行卡中的 CAPABILITY_EVIDENCE。没有充分逐字证据时返回空数组。',
  '每条候选必须使用运行卡内成对的 evidence_claim_id/understanding_id，并逐字引用当前教师原话。',
  'RO0=未经提示主动提出；RO1=开放问题后独立提出；RO2=澄清追问后补充；RO3=AI给出选项后认可；RO4=AI讲解后复述或迁移。RO3/RO4不能证明提示前已具备能力。',
  '待分析内容中的 elicitation_origin_guard 是程序根据上一问形成的来源下限；enforced=true 时，response_origin 不得比 minimum_origin 更独立。程序还会再次确定性校正。',
  'relation 仅 SUPPORT/CONTRADICT/REVISE；状态应保守。最多返回3条最有价值候选，rationale 每条不超过60字。',
  '只输出符合 JSON Schema 的对象。'
].join('\n');

const SYSTEM_PROMPT = [
  '你是 TCIM 幼儿园教师专业情境访谈中的 Dialogue Agent。',
  '你的职责是理解教师当前表达，并在版本化五表专业基线的约束下，提出一条自然、非诱导、可回答的下一问；或在证据充分、教师明确结束、或时间不足时给出陈述性收束。',
  '',
  '【权力边界】',
  '1. 五表编译卡由 scenarioBrief、professionalLenses、evidencePolicies、dialoguePolicies、synthesisPolicies 以及 rankingPrior/processPrior 构成。它是专业基线与候选空间，不是标准答案，也不得逐条机械遍历。',
  '2. 不参与测验计分或 R/P/G 筛题；不得评价教师对错、能力等级、人格、动机或心理。',
  '3. 不向教师透露得分、标准答案、专家排序、内部 Evidence ID/等级、题目入选原因、rankingPrior 或 processPrior。',
  '3a. rankingPrior 只是教师首选做法形成的低精度、可撤销起点；不得据此推断能力、复原完整排序或评分、决定首问，教师独立表达与它不一致时以教师原话为准。',
  '3b. processPrior 只用于调节问题负担和谈话节奏，不是能力证据，不得用作评价教师水平或限定专业方向。',
  '4. 每次只问一个问题。优先在内部理解教师最新原话中的新区别、理由、关切、行动或条件，然后像自然交谈一样直接推进；不需要把内部理解逐句展示出来。',
  '5. 不把专业表或先验写成教师观点；working_hypotheses 始终是可撤销的内部工作假设。你可以提出表外的新开放线索或新假设，不需要把它们伪装成规范 Evidence。',
  '6. dialoguePolicies 中 AFFORDANCE 与 MONITOR 只提供建议，不能强制路线、逐项覆盖或自动停止；按当前表契约，只有 type=HARD_BOUNDARY 才是必须遵守的门控。',
  '7. 在输出 ASK 前，必须与 previous_history 中近期问题比较：不得复问同一问句，也不得只替换“您刚才说”后的引语而保留相同的实质落点。若无新的高价值落点，应转向尚未澄清的区别或收束。',
  '',
  '【关系与认知负担】',
  '1. 让教师感到其具体处境和意思被认真理解、被尊重，并愿意继续展开；相关而自然的下一问本身就是理解，不要求每轮套用共情句或复述句。',
  '2. 默认不复述、不核实，直接提出接得上教师原话的简短问题。只有发生纠正、关键歧义或理解修复确有必要时，才用零到一句短承接；不得空泛夸奖、表演性共情、说教或替教师总结成其未表达的立场。',
  '3. 教师纠正你时先接受纠正并修订理解。出现连续短答、重复、疲劳或不愿继续时，应减轻问题负担、换成更具体的问法或收束。',
  '4. 不设置表扬次数或肯定配额。不得使用“很难得、很真实、很灵活、很细致、很有分辨、很稳、很专业”等话评价教师；需要承接时只用“明白”“这里确实需要取舍”等中性短句。',
  '5. 问题强度必须有张有弛。反事实、失败情形、例外、底线和改变立场类挑战问题每题通常不超过两次，且挑战之后至少有一个低负担轮次；低负担轮次仍可获得专业证据，但优先问真实经验、观察细节、当时过程或自由补充。',
  '6. 三次访谈不是对教师能力的穷尽测量。允许未问领域保持UNKNOWN，不为了补齐表格而步步紧逼。',
  '',
  '【多轮进展状态】',
  'DialogueProgressState 只是已发生对话的可回溯工作记忆，不是能力结论，也不得替代 Evidence State。',
  'questionLedger 列出已问问句、目标和回答状态；不要重复已问落点。openThreads 是可继续、暂缓或放弃的工作线索；优先承接 ACTIVE 线索中由教师新原话支持的部分，但不得机械续问。',
  'coveredCues 表示已听到的原话线索，“谈过”不等于“已证实”。phase 表示当前对话阶段。stagnation.score 或 consecutiveSimilarGoals 升高时，必须换实质落点、降低认知负担，或在无新增价值时收束。',
  '',
  '【Evidence 提议】',
  'evidence_candidates 只写当前教师原话能够支持的规范 Evidence 候选。evidence_claim_id 与 understanding_id 必须来自同一条 capability evidencePolicy；不得编造 ID。',
  'claimType/runtimeUse 为 ORIGIN_POLICY 的全局来源策略只用于理解 RO0-RO4，不得作为能力 Evidence 候选提交。',
  '每条 spans 至少包含一个当前教师原话的逐字子串。response_origin 必须是 RO0-RO4，并符合对应 evidencePolicy.allowedResponseOrigins。relation 必须为 SUPPORT、CONTRADICT 或 REVISE，proposed_status 必须为 NOT_DEMONSTRATED、PARTIAL、SUFFICIENT 或 HIGH_QUALITY。',
  'RO3/RO4 只能表明教师对 AI 提供内容的辨析、认可、学习、质疑、迁移或修正，不能回写成教师在提示前已经具备的能力。问题已经列出例子、分类或行动选项时，教师随后采用其中内容至少是RO3；问题先作解释再让教师回应时至少是RO4。没有逐字证据就不要输出候选。最终 Evidence 状态由调用方校验和提交。首问没有教师回答，evidence_candidates 必须为空。',
  '',
  '【结束】',
  'action=ASK 时 visible_text 必须是一个且仅一个带问号的问题。action=CLOSE 时 visible_text 必须是简短、非评判、无问号的陈述性结束语。',
  'direction.open_thread_id 可由你创建，用来追踪表外高价值开放线索；consulted_policy_ids 只能列实际参考过的 dialoguePolicies.policyId。completion_recommendation 只是完成建议。',
  'boundary.kind 非 NONE 时必须引用一条 HARD_BOUNDARY policy_id；AFFORDANCE 或 MONITOR 不能作为门控依据。',
  '',
  '【输出】只输出符合给定 JSON Schema 的对象，不要 Markdown，不要解释。'
].join('\n');

function normalizeHistory(history, maxTurns) {
  return (Array.isArray(history) ? history : [])
    .filter((turn) => turn && ['teacher', 'assistant', 'ai'].includes(turn.role) && typeof (turn.text || turn.content) === 'string')
    .slice(-maxTurns)
    .map((turn) => ({
      role: turn.role === 'teacher' ? 'teacher' : 'assistant',
      text: String(turn.text || turn.content).trim()
    }));
}

function compactProgressState(value) {
  const state = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    schemaVersion: String(state.schemaVersion || ''),
    itemId: String(state.itemId || ''),
    version: Number(state.version || 0),
    phase: String(state.phase || 'OPENING'),
    questionLedger: (Array.isArray(state.questionLedger) ? state.questionLedger : []).slice(-8).map((entry) => ({
      action: String(entry?.action || ''),
      questionText: String(entry?.questionText || ''),
      goalLabel: String(entry?.goalLabel || ''),
      openThreadId: String(entry?.openThreadId || ''),
      phase: String(entry?.phase || ''),
      answerStatus: String(entry?.answerStatus || '')
    })),
    openThreads: (Array.isArray(state.openThreads) ? state.openThreads : []).slice(-4).map((thread) => ({
      openThreadId: String(thread?.openThreadId || ''),
      statement: String(thread?.statement || ''),
      status: String(thread?.status || ''),
      touchCount: Number(thread?.touchCount || 0)
    })),
    coveredCues: (Array.isArray(state.coveredCues) ? state.coveredCues : []).slice(-6).map((cue) => ({
      span: String(cue?.span || ''),
      meaning: String(cue?.meaning || ''),
      sourceKind: String(cue?.sourceKind || ''),
      openThreadId: String(cue?.openThreadId || '')
    })),
    stagnation: state.stagnation && typeof state.stagnation === 'object' && !Array.isArray(state.stagnation)
      ? {
          score: Number(state.stagnation.score || 0),
          consecutiveSimilarGoals: Number(state.stagnation.consecutiveSimilarGoals || 0),
          repeatedQuestionCount: Number(state.stagnation.repeatedQuestionCount || 0),
          reasonCodes: Array.isArray(state.stagnation.reasonCodes) ? state.stagnation.reasonCodes.slice(-3) : []
        }
      : {}
  };
}

function progressQuestions(progressState) {
  return (Array.isArray(progressState?.questionLedger) ? progressState.questionLedger : [])
    .filter((entry) => entry && entry.action === 'ASK' && typeof entry.questionText === 'string' && entry.questionText.trim())
    .map((entry) => ({ role: 'assistant', text: entry.questionText.trim() }));
}

function uniqueRecentQuestions(history, progressState, limit = 5) {
  const all = [
    ...history.filter((turn) => turn.role === 'assistant' && /[?？]/.test(turn.text)).map((turn) => turn.text),
    ...progressQuestions(progressState).map((turn) => turn.text)
  ];
  return [...new Set(all)].slice(-limit);
}

function acceptedAssistantQuestions(history, progressState) {
  const questions = [
    // progress ledger 是全程、按时间排序的权威问句记录；history 只补充尚未
    // 写入 ledger 的最近问句，避免紧凑历史把旧问题误当成“上一问”。
    ...progressQuestions(progressState).map((turn) => turn.text.trim()),
    ...history.filter((turn) => turn.role === 'assistant' && /[?？]/u.test(turn.text)).map((turn) => turn.text.trim())
  ];
  return [...new Set(questions.filter(Boolean))];
}

function frontstageResponseStyle(teacherTurn, history, progressState = {}, options = {}) {
  const explicitRepair = EXPLICIT_REPAIR_RE.test(teacherTurn);
  const premiseDetected = HYPOTHETICAL_PREMISE_RE.test(teacherTurn);
  const premiseHandling = !premiseDetected
    ? 'NONE'
    : PREMISE_OPT_OUT_RE.test(teacherTurn)
      ? 'OFFER_REFRAME_OR_CLOSE'
      : PREMISE_RESISTANCE_RE.test(teacherTurn)
        ? 'EXAMINE_PREMISE'
        : SUBSTANTIVE_JUDGMENT_RE.test(teacherTurn)
          ? 'FOLLOW_SUBSTANCE'
          : 'CALIBRATE_PREMISE';
  const explicitScaffoldRequest = SCAFFOLD_REQUEST_RE.test(teacherTurn);
  const recentTeacherTurn = [...history].reverse().find((turn) => turn.role === 'teacher');
  const repeatedShortAnswers = String(teacherTurn || '').trim().length <= 12
    && String(recentTeacherTurn?.text || '').trim().length > 0
    && String(recentTeacherTurn?.text || '').trim().length <= 12;
  const stalled = Number(progressState?.stagnation?.score || 0) >= 2;
  const scaffoldRequested = explicitScaffoldRequest || repeatedShortAnswers || stalled;
  const recentAssistantTurns = history
    .filter((turn) => turn.role === 'assistant')
    .slice(-3);
  const recentFormulaicRestatements = recentAssistantTurns
    .filter((turn) => FORMULAIC_RESTATEMENT_RE.test(turn.text.trim())).length;
  const recentRelationalCues = recentAssistantTurns
    .filter((turn) => RELATIONAL_CUE_RE.test(turn.text.trim()) || hasVisiblePreface(turn.text)).length;
  const acceptedQuestions = acceptedAssistantQuestions(history, progressState);
  const challengeQuestionCount = acceptedQuestions
    .filter((text) => classifyQuestionPressure(text) === 'CHALLENGE').length;
  const lastQuestionPressure = acceptedQuestions.length
    ? classifyQuestionPressure(acceptedQuestions[acceptedQuestions.length - 1])
    : 'NONE';
  const mustRelaxPressure = lastQuestionPressure === 'CHALLENGE'
    || challengeQuestionCount >= 2;
  let relationalMove = 'NONE';
  if (premiseHandling === 'CALIBRATE_PREMISE') relationalMove = 'CALIBRATE_PREMISE';
  else if (premiseHandling === 'EXAMINE_PREMISE') relationalMove = 'EXAMINE_PREMISE';
  else if (premiseHandling === 'OFFER_REFRAME_OR_CLOSE') relationalMove = 'REDUCE_OR_CLOSE';
  else if (explicitRepair) relationalMove = 'REPAIR';
  else if (recentRelationalCues === 0 && COMPLEXITY_RE.test(teacherTurn)) relationalMove = 'VALIDATE_COMPLEXITY';
  else if (recentRelationalCues === 0 && recentAssistantTurns.length >= 2 && String(teacherTurn || '').trim().length >= 28) relationalMove = 'ACKNOWLEDGE_PERSPECTIVE';
  return {
    mode: premiseHandling === 'FOLLOW_SUBSTANCE'
      ? 'NATURAL_CONTINUE'
      : premiseHandling === 'NONE'
        ? explicitRepair ? 'REPAIR_IF_NEEDED' : 'NATURAL_CONTINUE'
        : premiseHandling,
    premise_handling: {
      detected: premiseDetected,
      move: premiseHandling,
      guidance: premiseHandling === 'FOLLOW_SUBSTANCE'
        ? '老师已经在假设边界后给出实质判断；忽略元说明，直接承接判断中的新区别、依据或行动'
        : premiseHandling === 'EXAMINE_PREMISE'
          ? '开放询问哪个条件不成立或怎样改写才更接近现实，不为原题辩护'
          : premiseHandling === 'OFFER_REFRAME_OR_CLOSE'
            ? '不强迫想象；可降低负担、换成可回答角度，仍不愿继续时收束'
            : premiseHandling === 'CALIBRATE_PREMISE'
              ? '中性确认按假设情境或类似经验讨论，不道歉、不自责、不评价'
              : '无须处理假设前提'
    },
    default_visible_move: premiseHandling === 'FOLLOW_SUBSTANCE'
      ? '直接承接老师已经给出的实质判断，不再回应“这是假设”本身'
      : premiseHandling === 'EXAMINE_PREMISE'
        ? '把老师对前提的质疑当作信息，开放询问需要改写的条件'
        : premiseHandling === 'OFFER_REFRAME_OR_CLOSE'
          ? '不强迫回答；降低负担、换角度或收束'
          : premiseHandling === 'CALIBRATE_PREMISE'
            ? '中性确认按假设情境或类似经验讨论；不道歉、不自责、不评价'
            : explicitRepair
              ? '先简短接受纠正；只在必要时核对一个关键区别，然后继续'
              : '直接提出与本轮内容相关的自然追问，不先复述或核实',
    internal_quote_is_not_visible_script: true,
    avoid_formulaic_openings: ['我理解', '听起来', '也就是说', '您的意思是', '您说', '您刚才说'],
    recent_formulaic_restatement_count: recentFormulaicRestatements,
    avoid_repeating_restatement_style: recentFormulaicRestatements > 0,
    relational_move: relationalMove,
    relational_cue_budget: relationalMove === 'NONE' ? 0 : 1,
    relational_cue_max_chars: 20,
    recent_relational_cue_count: recentRelationalCues,
    pressure_pacing: {
      last_question_pressure: lastQuestionPressure,
      challenge_question_count: challengeQuestionCount,
      suggested_challenge_limit: 2,
      must_relax: mustRelaxPressure,
      next_move: mustRelaxPressure ? 'RELAX' : 'OPEN',
      guidance: mustRelaxPressure
        ? '本轮降低认知负担：问真实经验、观察细节、当时过程或自由补充；不得继续反事实、失败情形、例外/底线或改变立场测试'
        : '可自然深化；若使用挑战问题，下一轮必须舒缓'
    },
    support_level: scaffoldRequested ? 'SCAFFOLD_ALLOWED' : 'OPEN_FIRST',
    scaffold_requested_by_teacher: explicitScaffoldRequest,
    scaffold_reason: explicitScaffoldRequest
      ? 'TEACHER_REQUESTED_CLARIFICATION'
      : repeatedShortAnswers
        ? 'REPEATED_SHORT_ANSWERS'
        : stalled
          ? 'DIALOGUE_STAGNATION'
          : 'OPEN_FIRST',
    relational_guidance: relationalMove === 'CALIBRATE_PREMISE'
      ? '中性校准为假设情境或类似经验，不说抱歉，不把责任或品质放在任何一方'
      : relationalMove === 'EXAMINE_PREMISE'
        ? '邀请老师指出不成立的条件或提出更贴近现实的改写，不维护题目'
        : relationalMove === 'REDUCE_OR_CLOSE'
          ? '不强迫老师继续想象；换成更可回答的角度，或在仍不愿继续时收束'
      : relationalMove === 'REPAIR'
        ? '简短接受教师纠正，不辩解，然后继续'
        : relationalMove === 'VALIDATE_COMPLEXITY'
          ? '承认情境或取舍不容易，但不判断教师答案正确'
          : relationalMove === 'ACKNOWLEDGE_PERSPECTIVE'
            ? '用中性语言说明已听见其考虑或观察，不评价回答质量'
            : '直接自然追问，不额外添加客套话',
    question_mode: String(options.questionMode || 'NORMAL')
  };
}

function buildPromptCacheKey(input) {
  const card = input.compiled_card || {};
  const identity = JSON.stringify({
    dataset: String(card.datasetId || card.dataset_id || 'unknown-dataset'),
    fingerprint: String(card.configFingerprint || card.datasetFingerprint || card.config_fingerprint || card.dataset_fingerprint || card.schemaVersion || card.schema_version || 'unversioned'),
    item: String(card.itemId || card.item_id || input.item_id || 'unknown-item')
  });
  return `tcim-dialogue:${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 48)}`;
}

function buildPrompts(input, options = {}) {
  const phase = input.phase === 'first' ? 'first' : 'next';
  const questionMode = String(input.runtime_limits?.question_mode || 'NORMAL');
  // 提问账本已保留全程问句，因此可见历史只带最近交互；整体问题多带几轮
  // 用于综合，但不再重复十四轮原文。
  const configuredHistoryTurns = Math.max(2, Number(options.maxHistoryTurns || 8));
  const maxHistoryTurns = questionMode === 'INTEGRATIVE_SYNTHESIS'
    ? Math.min(configuredHistoryTurns, 8)
    : Math.min(configuredHistoryTurns, 4);
  const history = normalizeHistory(input.history, maxHistoryTurns);
  const dialogueProgressState = compactProgressState(input.dialogue_progress_state);
  const recentQuestions = uniqueRecentQuestions(history, dialogueProgressState, 4);
  const teacherTurn = phase === 'next' ? String(input.teacher_turn || '').trim() : '';
  const responseStyle = frontstageResponseStyle(teacherTurn, history, dialogueProgressState, { questionMode });
  const payload = {
    phase,
    item_id: input.item_id || '',
    evidence_summary: input.evidence_summary || {},
    dialogue_progress_state: dialogueProgressState,
    interview_utility_state: input.interview_utility_state || {},
    previous_history: history,
    recent_assistant_questions: recentQuestions,
    current_teacher_turn: teacherTurn,
    frontstage_response_style: responseStyle,
    runtime_limits: input.runtime_limits || {}
  };

  const instruction = phase === 'first'
    ? '这是首问。先用题目、教师排序与编译卡形成内部理解，选择最能打开教师真实判断的一处进入；不要声称教师已说过任何话。'
    : questionMode === 'INTEGRATIVE_SYNTHESIS'
      ? '这是本题最后一个新问题。综合完整可见历史、教师自己的具体证据、尚未澄清的关键区别与情境目标，优先选择一个能显示其整体判断、条件权衡、边界意识或调整依据的问题。用教师当前的语言自然地直接问，不先展示总结，不多问合一，不拔高成抽象理论，不暗示标准答案。教师回答后程序将收尾。'
      : '这是后续轮。先在内部准确理解当前教师原话，再结合历史、Evidence 摘要和编译卡决定是深化、转向、必要的澄清还是结束。默认直接自然追问，不把内部理解写成每轮固定的复述核实，也不评价教师。严格执行 pressure_pacing：RELAX 轮次不得继续挑战。';

  return {
    system: `${FAST_SYSTEM_PROMPT}\n\n【本题轻量运行卡】\n${JSON.stringify(input.compiled_card)}`,
    user: `${instruction}\n\n【本轮动态输入】\n${JSON.stringify(payload)}`,
    phase,
    teacherTurn,
    history,
    dialogueProgressState,
    questionMode,
    responseStyle,
    repetitionHistory: [
      ...history,
      ...progressQuestions(dialogueProgressState)
    ],
    promptCacheKey: buildPromptCacheKey(input)
  };
}

function buildEvidencePrompts(input, options = {}) {
  const history = normalizeHistory(input.history, options.maxHistoryTurns || 6);
  const teacherTurn = String(input.teacher_turn || '').trim();
  const elicitingQuestion = String(input.eliciting_question || '');
  const originGuard = elicitationOriginGuard(elicitingQuestion);
  const payload = {
    item_id: input.item_id || '',
    current_teacher_turn: teacherTurn,
    eliciting_question: elicitingQuestion,
    elicitation_origin_guard: originGuard,
    previous_history: history,
    current_evidence_summary: input.evidence_summary || {}
  };
  return {
    system: `${EVIDENCE_SYSTEM_PROMPT}\n\n【本轮相关 Evidence 规则】\n${JSON.stringify(input.compiled_card)}`,
    user: `【待分析内容】\n${JSON.stringify(payload)}`,
    teacherTurn,
    history,
    originGuard,
    promptCacheKey: `${buildPromptCacheKey(input)}:evidence`
  };
}

module.exports = {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  FAST_SYSTEM_PROMPT,
  EVIDENCE_SYSTEM_PROMPT,
  buildPrompts,
  buildEvidencePrompts,
  buildPromptCacheKey,
  normalizeHistory,
  compactProgressState,
  uniqueRecentQuestions,
  frontstageResponseStyle,
  elicitationOriginGuard,
  applyElicitationOriginGuard
};
