'use strict';

/**
 * belief_state.js —— Contextual Belief State（V0.2，A02B）。
 *
 * Belief 是可撤销的情境假设，与 Canonical Evidence 并列、但**不取代** Evidence。
 * - Belief 可以表外（OUT_OF_SCHEMA）；Evidence 必须用当前 Production Slot/Anchor。
 * - Belief 不得自动升级为 Evidence / 评分 / 能力标签。
 * - Mutation Owner = Belief Manager；Core 负责原子持久化。
 *
 * 操作类型（BELIEF_OPS）：NO_CHANGE / ADD / STRENGTHEN / WEAKEN / SPLIT / RETRACT。
 *
 * 结构：
 *   BeliefState { beliefs: { [beliefId]: Belief }, version }
 *   Belief { id, claim, status: ACTIVE|RETRACTED|DIVERGED, confidence, support_refs[],
 *            conflict_refs[], alternatives[], uncertainty, source_refs[], created_turn, updated_turn }
 */

const BELIEF_OPS = Object.freeze(['NO_CHANGE', 'ADD', 'STRENGTHEN', 'WEAKEN', 'SPLIT', 'RETRACT']);
const BELIEF_STATUS = Object.freeze(['ACTIVE', 'RETRACTED', 'DIVERGED']);

const clamp01 = (n) => Math.max(0, Math.min(1, typeof n === 'number' ? n : 0));

let _beliefSeed = 0;
function nextBeliefId() {
  _beliefSeed += 1;
  return `B${Date.now().toString(36).slice(-4)}${_beliefSeed}`;
}

function createBelief(opts = {}) {
  return {
    id: opts.id || nextBeliefId(),
    claim: opts.claim || '',
    status: opts.status || 'ACTIVE',
    confidence: clamp01(opts.confidence),
    support_refs: Array.isArray(opts.support_refs) ? opts.support_refs.slice() : [],
    conflict_refs: Array.isArray(opts.conflict_refs) ? opts.conflict_refs.slice() : [],
    alternatives: Array.isArray(opts.alternatives) ? opts.alternatives.slice() : [],
    uncertainty: clamp01(opts.uncertainty),
    source_refs: Array.isArray(opts.source_refs) ? opts.source_refs.slice() : [],
    created_turn: opts.created_turn || null,
    updated_turn: opts.updated_turn || null
  };
}

function createBeliefState() {
  return { beliefs: {}, version: 0 };
}

/**
 * 校验一个 Belief mutation 是否合法（Schema 门）。
 * @param {object} mutation { op, belief_id?, claim?, confidence?, support_refs?, alternatives?, ... }
 * @param {object} state 当前 BeliefState（只读，用于 RETRACT/SPLIT/STRENGTH 校验）
 * @returns {{ ok, errors }}
 */
function validateBeliefMutation(mutation, state) {
  const errors = [];
  if (!mutation || typeof mutation !== 'object') return { ok: false, errors: ['mutation 不是对象'] };
  const op = mutation.op;
  if (!BELIEF_OPS.includes(op)) errors.push(`非法 op: ${op}`);
  if (op === 'ADD' && !mutation.claim) errors.push('ADD 需 claim');
  if (op !== 'ADD' && op !== 'NO_CHANGE' && !mutation.belief_id) errors.push(`${op} 需 belief_id`);
  if (op === 'RETRACT' || op === 'STRENGTHEN' || op === 'WEAKEN' || op === 'SPLIT') {
    if (!state.beliefs || !state.beliefs[mutation.belief_id]) errors.push(`belief_id 不存在: ${mutation.belief_id}`);
  }
  if (typeof mutation.confidence === 'number' && (mutation.confidence < 0 || mutation.confidence > 1)) errors.push('confidence 越界');
  // G05：Belief 不得包含能力/人格/动机的正式结论
  const judgeRe = /能力|人格|动机|心理|性格|智力水平|属于.{0,3}(高|中|低)能力/;
  if (judgeRe.test(JSON.stringify(mutation.claim || ''))) errors.push('G05: Belief 含能力/人格/动机正式判定');
  return { ok: errors.length === 0, errors };
}

/**
 * 应用一个合法 mutation 到 BeliefState；返回 { state, event }（不移除旧 Belief，只更新/追加）。
 * @param {object} state 当前 BeliefState（copy 后改）
 * @param {object} mutation 已校验的 mutation
 * @param {string} turnId
 * @returns {{ state, event }}
 */
function applyBeliefMutation(state, mutation, turnId) {
  const next = JSON.parse(JSON.stringify(state));
  const beliefs = next.beliefs || {};
  const event = { op: mutation.op, belief_id: null, claim: null, before: null, after: null, turn_id: turnId };
  const baseOp = mutation.op;

  if (baseOp === 'NO_CHANGE') { next.version += 1; event.op = 'NO_CHANGE'; return { state: next, event }; }

  if (baseOp === 'ADD') {
    const belief = createBelief({ claim: mutation.claim, confidence: mutation.confidence, support_refs: mutation.support_refs, alternatives: mutation.alternatives, uncertainty: mutation.uncertainty, source_refs: mutation.source_refs, created_turn: turnId, updated_turn: turnId });
    beliefs[belief.id] = belief;
    next.version += 1;
    event.belief_id = belief.id; event.claim = belief.claim; event.after = { confidence: belief.confidence, status: belief.status };
    return { state: next, event };
  }

  const b = beliefs[mutation.belief_id];
  const before = { confidence: b.confidence, status: b.status };
  if (baseOp === 'STRENGTHEN') { b.confidence = clamp01((b.confidence || 0) + (mutation.delta != null ? mutation.delta : 0.1)); b.updated_turn = turnId; }
  else if (baseOp === 'WEAKEN') { b.confidence = clamp01((b.confidence || 0) - (mutation.delta != null ? mutation.delta : 0.1)); b.updated_turn = turnId; }
  else if (baseOp === 'RETRACT') { b.status = 'RETRACTED'; b.updated_turn = turnId; }
  else if (baseOp === 'SPLIT') {
    // 分裂：原 belief 标记 DIVERGED，新建一个竞争 belief
    b.status = 'DIVERGED';
    const alt = createBelief({ claim: mutation.new_claim || b.claim, confidence: clamp01(mutation.new_confidence != null ? mutation.new_confidence : b.confidence), alternatives: [b.claim], source_refs: b.source_refs, created_turn: turnId, updated_turn: turnId });
    beliefs[alt.id] = alt;
    next.version += 2;
    event.belief_id = alt.id; event.claim = alt.claim; event.after = { confidence: alt.confidence, status: alt.status };
    return { state: next, event };
  }
  next.version += 1;
  event.belief_id = b.id; event.claim = b.claim; event.before = before; event.after = { confidence: b.confidence, status: b.status };
  return { state: next, event };
}

module.exports = {
  BELIEF_OPS,
  BELIEF_STATUS,
  createBelief,
  createBeliefState,
  validateBeliefMutation,
  applyBeliefMutation
};
