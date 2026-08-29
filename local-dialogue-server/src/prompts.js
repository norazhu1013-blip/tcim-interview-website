'use strict';

const crypto = require('crypto');

const PROMPT_VERSION = 'tcim-dialogue-v2-five-tables-2026-08-29-r2';

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
  '',
  '【关系与认知负担】',
  '1. 让教师感到其具体处境和意思被认真理解、被尊重，并愿意继续展开；不要求每轮套用共情句。',
  '2. 可以先用零到一句准确承接教师原意，再提出一个简短问题；不得空泛夸奖、表演性共情、说教或替教师总结成其未表达的立场。',
  '3. 教师纠正你时先接受纠正并修订理解。出现连续短答、重复、疲劳或不愿继续时，应减轻问题负担、换成更具体的问法或收束。',
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
  const maxHistoryTurns = options.maxHistoryTurns || 40;
  const history = normalizeHistory(input.history, maxHistoryTurns);
  const teacherTurn = phase === 'next' ? String(input.teacher_turn || '').trim() : '';
  const payload = {
    phase,
    session_id: input.session_id || '',
    item_id: input.item_id || '',
    teacher_context: input.teacher_context || {},
    evidence_summary: input.evidence_summary || {},
    previous_history: history,
    current_teacher_turn: teacherTurn,
    runtime_limits: input.runtime_limits || {}
  };

  const instruction = phase === 'first'
    ? '这是首问。先用题目、教师排序与编译卡形成内部理解，选择最能打开教师真实判断的一处进入；不要声称教师已说过任何话。'
    : '这是后续轮。先准确理解当前教师原话，再结合历史、Evidence 摘要和编译卡决定是澄清、深化、转向还是结束；不得跳过教师刚提出的新信息。';

  return {
    system: `${SYSTEM_PROMPT}\n\n【本题静态五表编译卡】\n${JSON.stringify(input.compiled_card)}`,
    user: `${instruction}\n\n【本轮动态输入】\n${JSON.stringify(payload)}`,
    phase,
    teacherTurn,
    history,
    promptCacheKey: buildPromptCacheKey(input)
  };
}

module.exports = { PROMPT_VERSION, SYSTEM_PROMPT, buildPrompts, buildPromptCacheKey, normalizeHistory };
