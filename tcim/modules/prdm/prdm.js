'use strict';

/**
 * PRDM V0.1 —— 专业决策后的对话策略模块（03-1 架构）。
 *
 * 位置：ProfessionalActionPlan 之后、Generator 之前。
 * 决定 HOW TO CONTINUE：Interaction Read → Local Progress → Uptake/Stance/Move → Challenge/Load/Dose。
 *
 * 边界（03-2 非协商规则）：
 *   - 只读 protected ProfessionalActionPlan；不写 Evidence；不改 target_slot/objective/probe_strategy/STOP。
 *   - Interaction Read 只分类可观察、session-local 信号；不推断稳定人格/能力。
 *   - Local Progress 只拥有微观推进（continue/reframe/narrow）；不选新专业目标。
 *   - 默认 move 是 DIRECT_PROBE；反思是 opt-in，不是默认。
 *   - challenge 0-3，受 certainty/load/repair 限幅。
 *   - PRDM ON/OFF 对同一 Teacher Turn 的 Evidence Update 必须一致（PRDM 不写 Evidence）。
 */

const VERSION = '2026-08-21-prdm-v0.1';
const STANCE_OPTIONS = ['LISTEN', 'CO_INQUIRE', 'GENTLY_CHALLENGE', 'EXPERT_SUPPORT'];
const MOVE_OPTIONS = ['DIRECT_PROBE', 'BRIEF_UPTAKE_PROBE', 'NOTICE_AND_PROBE', 'TENSION_AND_PROBE', 'GENTLE_CHALLENGE', 'REPAIR'];
const PROGRESS_OPTIONS = ['ADVANCING', 'SLOW', 'STUCK', 'COMPLETE_LOCAL'];

function isRepairSignal(text) {
  const s = String(text || '').replace(/\s+/g, '')
  return /(?:我不是这个意思|你理解错了|你误会了|不是这样|我说的是|你没听懂|我纠正一下|重新说)/.test(s)
}

function isFrustration(text) {
  const s = String(text || '').replace(/\s+/g, '')
  return /(?:烦|别问了|不要再问|不想继续|不回答了|结束吧|到这里吧)/.test(s)
}

function isLowCertainty(text) {
  const s = String(text || '')
  return /(?:不太确定|可能|也许|说不准|我也说不清|我不太清楚|没想好)/.test(s)
}

function responseDepth(text) {
  const s = String(text || '').trim()
  if (!s) return 0
  const clauses = (s.match(/[。，；、！？]/g) || []).length
  const hasDetail = /(?:因为|所以|先|然后|如果|当|看情况|根据|条件|具体|比如|例如)/.test(s)
  return { clauses, hasDetail, depth: hasDetail && clauses >= 2 ? 2 : (hasDetail ? 1 : 0) }
}

/** Interaction Read：只读 observable 信号。 */
function interactionRead(teacherTurn, recentTurns) {
  const depth = responseDepth(teacherTurn)
  const signals = {
    repair_signal: isRepairSignal(teacherTurn),
    frustration: isFrustration(teacherTurn),
    low_certainty: isLowCertainty(teacherTurn),
    response_depth: depth.depth,
    clauses: depth.clauses,
    // engagement：最近是否越答越短
    last_len: String(teacherTurn || '').length,
    prev_len: recentTurns && recentTurns.length ? String(recentTurns[recentTurns.length - 1]).length : 0,
    UNKNOWN: false
  }
  return signals
}

/** Local Progress：由本轮证据增量与对话长度判断。 */
function localProgress(evidenceUpdates, signals) {
  if (evidenceUpdates && evidenceUpdates.some((u) => u.reason === 'anchor_level_2' || u.reason === 'anchor_level_3')) return { status: 'ADVANCING', progress_tactic: 'continue' }
  if (evidenceUpdates && evidenceUpdates.length) return { status: 'ADVANCING', progress_tactic: 'continue' }
  if (signals.frustration) return { status: 'STUCK', progress_tactic: 'reframe_or_support' }
  if (signals.repair_signal) return { status: 'ADVANCING', progress_tactic: 'repair' }
  if (signals.response_depth === 0) return { status: 'SLOW', progress_tactic: 'narrow' }
  return { status: 'ADVANCING', progress_tactic: 'continue' }
}

/** Stance / Move：策略表。 */
function stanceAndMove(progress, signals, challengeAllowed) {
  if (signals.repair_signal) return { stance: 'LISTEN', move: 'REPAIR', challenge_level: 0 }
  if (signals.frustration) return { stance: 'LISTEN', move: 'BRIEF_UPTAKE_PROBE', challenge_level: 0 }
  if (progress.status === 'STUCK') return { stance: 'CO_INQUIRE', move: 'NOTICE_AND_PROBE', challenge_level: 0 }
  if (progress.status === 'SLOW') return { stance: 'CO_INQUIRE', move: 'BRIEF_UPTAKE_PROBE', challenge_level: Math.min(1, challengeAllowed) }
  // ADVANCING
  if (signals.low_certainty) return { stance: 'CO_INQUIRE', move: 'DIRECT_PROBE', challenge_level: Math.min(1, challengeAllowed) }
  if (challengeAllowed >= 2) return { stance: 'GENTLY_CHALLENGE', move: 'GENTLE_CHALLENGE', challenge_level: 2 }
  return { stance: 'CO_INQUIRE', move: 'DIRECT_PROBE', challenge_level: 1 }
}

/** Challenge/Load/Dose：受 certainty/load/repair 限幅。 */
function calibrate(progress, signals, challengeLevel) {
  let challenge = challengeLevel
  if (signals.low_certainty) challenge = Math.min(challenge, 1)
  if (signals.frustration) challenge = 0
  if (signals.repair_signal) challenge = 0
  if (signals.response_depth === 0) challenge = Math.min(challenge, 0)
  const load = signals.frustration || signals.response_depth === 0 ? 'LIGHT' : 'STANDARD'
  const dose = signals.frustration ? 'LOW' : (signals.response_depth === 0 ? 'MEDIUM' : 'STANDARD')
  return { challenge_level: challenge, question_load: load, response_dose: dose, max_questions: 1, max_chars: signals.frustration ? 40 : 80 }
}

/**
 * PRDM.plan()：输出 DialoguePlan（不含专业目标变更）。
 * @param {object} opts { protectedAction, teacherTurn, recentTurns, evidenceUpdates, allowedChallenge }
 * @returns {object} DialoguePlan
 */
function plan(opts) {
  const teacherTurn = opts.teacherTurn || ''
  const recentTurns = opts.recentTurns || []
  const signals = interactionRead(teacherTurn, recentTurns)
  const progress = localProgress(opts.evidenceUpdates, signals)
  const allowedChallenge = typeof opts.allowedChallenge === 'number' ? opts.allowedChallenge : 2
  const sm = stanceAndMove(progress, signals, allowedChallenge)
  const cal = calibrate(progress, signals, sm.challenge_level)
  return {
    module_id: 'prdm',
    module_version: VERSION,
    interaction_read: signals,
    local_progress: progress,
    uptake_mode: signals.repair_signal ? 'BRIEF' : 'NONE',
    stance: sm.stance,
    dialogue_move: sm.move,
    challenge_level: cal.challenge_level,
    question_load: cal.question_load,
    response_dose: cal.response_dose,
    max_questions: cal.max_questions,
    max_chars: cal.max_chars,
    protected_professional_action_hash: opts.protectedFingerprint || '',
    selection_reason: `progress=${progress.status}, move=${sm.move}, challenge=${cal.challenge_level}`
  }
}

module.exports = { id: 'prdm', version: VERSION, ownerNamespace: 'dialogue_state', plan, VERSION };
