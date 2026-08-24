'use strict';

/**
 * prdm_v2.js —— PRDM V0.2（03-1 / 03-2）：A06 observe + A07 plan 双接口。
 *
 * PRDM 是**对话互动策略模块**，不是专业行动规划器，也不是教师可见文本生成器。
 *   - A06 observe：在 TurnResolutionSnapshot 之后、AI Planner 之前，生成会话内可观察互动信号
 *     （InteractionSignalSnapshot + LocalProgressSnapshot）。**不得**输出 target/action/SHIFT/STOP
 *     推荐，**不得**推断稳定人格/能力/动机/心理。
 *   - A07 plan：在 Action Commit + fingerprint 之后，把已提交行动映射为互动参数（DialoguePlan）。
 *     **不得**改变 primary target/objective/probe strategy/risk；**不得**生成完整句子；
 *     必须绑定 action fingerprint；无有效 Commit/fingerprint 时**不得**产出可发送的文本。
 *   - A08 Generator 是**唯一**教师可见文本生成点。PRDM 不作任何措辞改写。
 *
 * 不变量（03-2 §2）：PRDM 不写 Canonical Evidence / Contextual Belief / ProfessionalActionPlan；
 * A07 不得改变专业行动；UNKNOWN 优于无证据推断；教师明确纠正优先。
 */

const VERSION = '2026-08-24-prdm-v0.2';

const STANCE_OPTIONS = ['LISTEN', 'CO_INQUIRE', 'GENTLY_CHALLENGE', 'EXPERT_SUPPORT'];
const MOVE_OPTIONS = ['DIRECT_PROBE', 'BRIEF_UPTAKE_PROBE', 'NOTICE_AND_PROBE', 'TENSION_AND_PROBE', 'GENTLE_CHALLENGE', 'REPAIR'];
const PROGRESS_OPTIONS = ['ADVANCING', 'SLOW', 'STUCK', 'COMPLETE_LOCAL'];

// A06 禁止字段：PRDM 不输出行动/诊断/专业判断
const FORBIDDEN_OBS = ['next_target_slot', 'recommended_action_type', 'stop_decision', 'personality_label', 'ability_label', 'psychological_diagnosis'];

function isRepairSignal(text) {
  const s = String(text || '').replace(/\s+/g, '');
  return /(?:我不是这个意思|你理解错了|你误会了|不是这样|我说的是|你没听懂|我纠正一下|重新说)/.test(s);
}
function isFrustration(text) {
  const s = String(text || '').replace(/\s+/g, '');
  return /(?:烦|别问了|不要再问|不想继续|不回答了|结束吧|到这里吧)/.test(s);
}
function isLowCertainty(text) {
  const s = String(text || '');
  return /(?:不太确定|可能|也许|说不准|我也说不清|我不太清楚|没想好)/.test(s);
}
function responseDepth(text) {
  const s = String(text || '').trim();
  if (!s) return 0;
  const clauses = (s.match(/[。，；、！？]/g) || []).length;
  const hasDetail = /(?:因为|所以|先|然后|如果|当|看情况|根据|条件|具体|比如|例如)/.test(s);
  return { clauses, hasDetail, depth: hasDetail && clauses >= 2 ? 2 : (hasDetail ? 1 : 0) };
}

/**
 * A06 observe：InteractionSignalSnapshot（纯可观察、session-local，无行动/诊断/recommendation）。
 * @param {object} opts { teacherTurn, recentTurns, observedActionFingerprint }
 * @returns {InteractionSignalSnapshot}
 */
function observe(opts) {
  const teacherTurn = opts.teacherTurn || '';
  const recentTurns = opts.recentTurns || [];
  const depth = responseDepth(teacherTurn);
  const signals = {
    // 只用可观察字段；低置信不推断稳定标签
    repair: isRepairSignal(teacherTurn),
    frustration: isFrustration(teacherTurn),
    low_certainty: isLowCertainty(teacherTurn),
    response_depth: depth.depth,
    clauses: depth.clauses,
    engagement: (function () {
      const cur = String(teacherTurn || '').length;
      const prev = recentTurns.length ? String(recentTurns[recentTurns.length - 1]).length : 0;
      return prev > cur ? 'FADING' : (cur > prev + 4 ? 'DEEPENING' : 'STABLE'); // 显式可观察
    })(),
    support_request: /(?:帮帮我|教教我|该怎么做|不太会|能不能告诉我)/.test(teacherTurn),
    UNKNOWN: teacherTurn ? false : true
  };
  // Local Progress：只描述微观推进，不给换目标建议
  const local_progress = localProgress(opts.evidenceUpdates, signals);
  // 明确不含 forbidden 字段
  return {
    snapshot_id: 'OBS-' + Date.now().toString(36).slice(-6),
    mode: 'observe',
    turn_id: opts.turnId || null,
    observed_action_fingerprint: opts.observedActionFingerprint || '',
    pragmatic_move: signals.repair ? 'REPAIR' : (signals.frustration ? 'DISENGAGE' : 'INQUIRE'),
    repair: signals.repair,
    frustration: signals.frustration,
    low_certainty: signals.low_certainty,
    response_depth: signals.response_depth,
    engagement: signals.engagement,
    support_request: signals.support_request,
    local_progress,
    source_spans: teacherTurn ? [{ span_ref: 'raw_turn', quote: teacherTurn.slice(0, 60) }] : [],
    confidence_by_field: { repair: signals.repair ? 0.9 : 0.5, response_depth: 0.6, engagement: 0.5 },
    unknown_fields: teacherTurn ? [] : ['response_depth', 'engagement'],
    // 保证不含 forbidden：手动断言掉
    ...(() => { const o = {}; for (const f of FORBIDDEN_OBS) o[f] = undefined; return o; })(),
    policy_version: VERSION
  };
}

function localProgress(evidenceUpdates, signals) {
  if (evidenceUpdates && evidenceUpdates.some((u) => /anchor_level_2|anchor_level_3/.test(u.reason))) return { status: 'ADVANCING', progress_tactic: 'continue', counts: { advance: 1 } };
  if (evidenceUpdates && evidenceUpdates.length) return { status: 'ADVANCING', progress_tactic: 'continue', counts: { advance: 1 } };
  if (signals.frustration) return { status: 'STUCK', progress_tactic: 'support', counts: { stuck: 1 } };
  if (signals.repair) return { status: 'ADVANCING', progress_tactic: 'repair', counts: {} };
  if (signals.response_depth === 0) return { status: 'SLOW', progress_tactic: 'narrow', counts: { slow: 1 } };
  return { status: 'ADVANCING', progress_tactic: 'continue', counts: {} };
}

/**
 * A07 plan：把已提交 Action 映射为互动参数（DialoguePlan）。
 * 边界：必须有有效 actionFingerprint；不生成文本；不改 target/objective/probe。
 * @param {object} opts { protectedAction: {target_slot, professional_objective, probe_strategy}, dialoguePlan: {actionFingerprint, stance, ...} }
 * @returns {DialoguePlan | null} —— 无有效 Commit/fingerprint 时返回 null（门禁）
 */
function plan(opts) {
  const action = opts.protectedAction || {};
  const fingerprint = opts.actionFingerprint || action.action_fingerprint || '';
  if (!fingerprint) {
    // 门禁：无有效 Action Commit/fingerprint → 不得产出 DialoguePlan（更不生成文本）
    return null;
  }
  const teacherTurn = opts.teacherTurn || '';
  const recentTurns = opts.recentTurns || [];
  const obs = observe({ teacherTurn, recentTurns, evidenceUpdates: opts.evidenceUpdates, observedActionFingerprint: fingerprint });
  const sm = stanceAndMove(obs.local_progress, obs, opts.allowedChallenge);
  const cal = calibrate(obs, sm.challenge_level);
  // A07 只输出互动参数；不改 target/objective/probe_strategy；绑定 fingerprint
  return {
    module_id: 'prdm',
    module_version: VERSION,
    protected_action_fingerprint: fingerprint,
    target_slot: action.target_slot || null,     // 只读引用（不改变）
    professional_objective: action.professional_objective || '',
    probe_strategy: action.probe_strategy || '',
    uptake_mode: obs.repair ? 'BRIEF' : 'NONE',
    stance: sm.stance,
    dialogue_move: sm.move,
    challenge_level: cal.challenge_level,
    question_load: cal.question_load,
    response_dose: cal.response_dose,
    max_questions: 1,
    max_chars: cal.max_chars,
    selection_reason: `progress=${obs.local_progress.status}, move=${sm.move}, challenge=${cal.challenge_level}`
  };
}

function stanceAndMove(progress, signals, challengeAllowed) {
  if (signals.repair) return { stance: 'LISTEN', move: 'REPAIR', challenge_level: 0 };
  if (signals.frustration) return { stance: 'LISTEN', move: 'BRIEF_UPTAKE_PROBE', challenge_level: 0 };
  if (progress.status === 'STUCK') return { stance: 'CO_INQUIRE', move: 'NOTICE_AND_PROBE', challenge_level: 0 };
  if (progress.status === 'SLOW') return { stance: 'CO_INQUIRE', move: 'BRIEF_UPTAKE_PROBE', challenge_level: Math.min(1, challengeAllowed) };
  if (signals.low_certainty) return { stance: 'CO_INQUIRE', move: 'DIRECT_PROBE', challenge_level: Math.min(1, challengeAllowed) };
  if (challengeAllowed >= 2) return { stance: 'GENTLY_CHALLENGE', move: 'GENTLE_CHALLENGE', challenge_level: 2 };
  return { stance: 'CO_INQUIRE', move: 'DIRECT_PROBE', challenge_level: 1 };
}

function calibrate(signals, challengeLevel) {
  let challenge = challengeLevel;
  if (signals.low_certainty) challenge = Math.min(challenge, 1);
  if (signals.frustration) challenge = 0;
  if (signals.repair) challenge = 0;
  if (signals.response_depth === 0) challenge = 0;
  const load = signals.frustration || signals.response_depth === 0 ? 'LIGHT' : 'STANDARD';
  const dose = signals.frustration ? 'LOW' : (signals.response_depth === 0 ? 'MEDIUM' : 'STANDARD');
  return { challenge_level: challenge, question_load: load, response_dose: dose, max_chars: signals.frustration ? 40 : 80 };
}

module.exports = {
  id: 'prdm',
  version: VERSION,
  ownerNamespace: 'dialogue_state',
  observe,
  plan,
  FORBIDDEN_OBS,
  VERSION
};
