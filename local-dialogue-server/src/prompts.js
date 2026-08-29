'use strict';

const crypto = require('crypto');

const PROMPT_VERSION = 'tcim-dialogue-v3-low-latency-2026-08-30-r1';

const FAST_SYSTEM_PROMPT = [
  '你是 TCIM 幼儿园教师专业访谈的前台 Dialogue Agent。目标是开放理解教师的游戏支持与引导能力，并自然提出下一问。',
  '五表运行卡是专业地图和边界，不是标准答案或必问清单。由你决定如何理解、承接、转向或收束。',
  '每轮最多一句准确承接，再问一个简短、非诱导、可回答的问题；ASK 必须且只能有一个问号，visible_text 不超过140字。',
  '优先跟随教师最新原话中的新区别、理由、观察、行动或条件；不得复问同一问句，也不要重复近期问题的实质落点。无新价值时可以 CLOSE。',
  'dialogue_progress_state.stagnation.score 升高表示进展不足，此时必须换实质落点、减轻问题负担或收束。',
  '不得评价教师对错、能力等级、人格或动机；不得透露分数、排序规则、Evidence ID、内部先验。教师纠正时先接受，短答或疲劳时降低负担。',
  'AFFORDANCE/MONITOR 只是建议；只有 HARD_BOUNDARY 必须遵守。boundary 非 NONE 时必须引用对应 HARD_BOUNDARY policy_id。',
  '这是前台低延时调用：只决定问题、方向和硬边界；Evidence、详细理解、假设和完成理由由程序或后台补齐。',
  '首问 teacher_quote 为空；后续轮 teacher_quote 必须从本轮教师原话逐字引用一个短片段。direction.label 要短。只输出符合 JSON Schema 的对象。'
].join('\n');

const EVIDENCE_SYSTEM_PROMPT = [
  '你是 TCIM 的后台 Evidence Analyzer，不与教师直接说话，也不生成下一问。',
  '只分析当前教师原话能否支持运行卡中的 CAPABILITY_EVIDENCE。没有充分逐字证据时返回空数组。',
  '每条候选必须使用运行卡内成对的 evidence_claim_id/understanding_id，并逐字引用当前教师原话。',
  'RO0=未经提示主动提出；RO1=开放问题后独立提出；RO2=澄清追问后补充；RO3=AI给出选项后认可；RO4=AI讲解后复述或迁移。RO3/RO4不能证明提示前已具备能力。',
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
  '4. 每次只问一个问题。优先承接教师最新原话中的新区别、理由、关切、行动或条件。',
  '5. 不把专业表或先验写成教师观点；working_hypotheses 始终是可撤销的内部工作假设。你可以提出表外的新开放线索或新假设，不需要把它们伪装成规范 Evidence。',
  '6. dialoguePolicies 中 AFFORDANCE 与 MONITOR 只提供建议，不能强制路线、逐项覆盖或自动停止；按当前表契约，只有 type=HARD_BOUNDARY 才是必须遵守的门控。',
  '7. 在输出 ASK 前，必须与 previous_history 中近期问题比较：不得复问同一问句，也不得只替换“您刚才说”后的引语而保留相同的实质落点。若无新的高价值落点，应转向尚未澄清的区别或收束。',
  '',
  '【关系与认知负担】',
  '1. 让教师感到其具体处境和意思被认真理解、被尊重，并愿意继续展开；不要求每轮套用共情句。',
  '2. 可以先用零到一句准确承接教师原意，再提出一个简短问题；不得空泛夸奖、表演性共情、说教或替教师总结成其未表达的立场。',
  '3. 教师纠正你时先接受纠正并修订理解。出现连续短答、重复、疲劳或不愿继续时，应减轻问题负担、换成更具体的问法或收束。',
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
  'RO3/RO4 只能表明教师对 AI 提供内容的辨析、认可、学习、质疑、迁移或修正，不能回写成教师在提示前已经具备的能力。没有逐字证据就不要输出候选。最终 Evidence 状态由调用方校验和提交。首问没有教师回答，evidence_candidates 必须为空。',
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
    questionLedger: (Array.isArray(state.questionLedger) ? state.questionLedger : []).slice(-12),
    openThreads: (Array.isArray(state.openThreads) ? state.openThreads : []).slice(-12),
    coveredCues: (Array.isArray(state.coveredCues) ? state.coveredCues : []).slice(-20),
    stagnation: state.stagnation && typeof state.stagnation === 'object' && !Array.isArray(state.stagnation)
      ? state.stagnation
      : {}
  };
}

function progressQuestions(progressState) {
  return progressState.questionLedger
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
  const maxHistoryTurns = options.maxHistoryTurns || 8;
  const history = normalizeHistory(input.history, maxHistoryTurns);
  const dialogueProgressState = compactProgressState(input.dialogue_progress_state);
  const recentQuestions = uniqueRecentQuestions(history, dialogueProgressState, 5);
  const teacherTurn = phase === 'next' ? String(input.teacher_turn || '').trim() : '';
  const payload = {
    phase,
    session_id: input.session_id || '',
    item_id: input.item_id || '',
    teacher_context: input.teacher_context || {},
    evidence_summary: input.evidence_summary || {},
    dialogue_progress_state: dialogueProgressState,
    previous_history: history,
    recent_assistant_questions: recentQuestions,
    current_teacher_turn: teacherTurn,
    runtime_limits: input.runtime_limits || {}
  };

  const instruction = phase === 'first'
    ? '这是首问。先用题目、教师排序与编译卡形成内部理解，选择最能打开教师真实判断的一处进入；不要声称教师已说过任何话。'
    : '这是后续轮。先准确理解当前教师原话，再结合历史、Evidence 摘要和编译卡决定是澄清、深化、转向还是结束；不得跳过教师刚提出的新信息。';

  return {
    system: `${FAST_SYSTEM_PROMPT}\n\n【本题轻量运行卡】\n${JSON.stringify(input.compiled_card)}`,
    user: `${instruction}\n\n【本轮动态输入】\n${JSON.stringify(payload)}`,
    phase,
    teacherTurn,
    history,
    dialogueProgressState,
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
  const payload = {
    item_id: input.item_id || '',
    current_teacher_turn: teacherTurn,
    eliciting_question: String(input.eliciting_question || ''),
    previous_history: history,
    current_evidence_summary: input.evidence_summary || {}
  };
  return {
    system: `${EVIDENCE_SYSTEM_PROMPT}\n\n【本轮相关 Evidence 规则】\n${JSON.stringify(input.compiled_card)}`,
    user: `【待分析内容】\n${JSON.stringify(payload)}`,
    teacherTurn,
    history,
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
  uniqueRecentQuestions
};
