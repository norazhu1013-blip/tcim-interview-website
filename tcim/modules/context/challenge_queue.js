'use strict';

/**
 * challenge_queue.js —— 专业表异议候选队列（V0.2，A12）。
 *
 * 当 AI 的 Proposal 出现 table_alignment = CONFLICT / OUT_OF_SCHEMA / NO_APPLICABLE_RULE，
 * 或对五表默认 Prior/Probe/Stop 提出有理由的偏离时，把「挑战」记入队列（ChallengeQueue）。
 *
 * 边界：Challenge 只能进入 Replay + 专业审核，**不能直接改 Production 五表/知识/策略**。
 * 每个候选保存 source_refs、被挑战的 rule_id、claimed/adjudicated alignment、风险与理由。
 */

const { TABLE_ALIGNMENT } = require('../../core/contracts.js');

let _queueId = 0;

function createChallengeQueue() {
  return { challenges: [], version: 0 };
}

function nextChallengeId() {
  _queueId += 1;
  return `CHAL-${Date.now().toString(36).slice(-4)}-${_queueId}`;
}

/**
 * 登记一条挑战候选。
 * @param {object} opts { challenge_type, rule_id, slot_id, claimed_alignment, adjudicated_alignment?, reason, source_refs, risk_level? }
 * @returns {ChallengeCandidate}
 */
function addChallenge(queue, opts = {}) {
  const candidate = {
    id: nextChallengeId(),
    challenge_type: opts.challenge_type || 'TABLE_DEVIATION', // TABLE_DEVIATION | OUT_OF_SCHEMA | CONFLICT | EXPERT_REVIEW
    rule_id: opts.rule_id || null,
    slot_id: opts.slot_id || null,
    claimed_alignment: TABLE_ALIGNMENT.includes(opts.claimed_alignment) ? opts.claimed_alignment : 'NO_APPLICABLE_RULE',
    adjudicated_alignment: TABLE_ALIGNMENT.includes(opts.adjudicated_alignment) ? opts.adjudicated_alignment : undefined,
    reason: opts.reason || '',
    source_refs: Array.isArray(opts.source_refs) ? opts.source_refs.slice() : [],
    risk_level: opts.risk_level || 'LOW',
    status: 'DRAFT',  // DRAFT | IN_REVIEW | ACCEPTED | REJECTED（人工审核后决定）
    created_at: Date.now(),
    updated_at: Date.now()
  };
  queue.challenges.push(candidate);
  queue.version += 1;
  return candidate;
}

/** 把某轮 agent decision 的表偏离转成挑战候选（Planner/Gate 已给出 alignment 时调用）。 */
function challengeFromDecision(queue, agentDecision, gateResult) {
  const claimed = agentDecision && agentDecision.claimed_table_alignment;
  const adjudicated = gateResult && gateResult.adjudicated_table_alignment;
  // 仅当出现偏离/表外/无适用规则才登记
  if (!claimed || ['SUPPORT', 'PARTIAL'].includes(claimed)) return null;
  return addChallenge(queue, {
    challenge_type: claimed === 'OUT_OF_SCHEMA' ? 'OUT_OF_SCHEMA' : (adjudicated ? 'TABLE_DEVIATION' : 'CONFLICT'),
    rule_id: agentDecision.fallback_action_id || agentDecision.prior_reason || null,
    slot_id: agentDecision.primary_target_slot || null,
    claimed_alignment: claimed,
    adjudicated_alignment: adjudicated,
    reason: agentDecision.why_this_now || '',
    source_refs: agentDecision.source_refs || [],
    risk_level: (gateResult && gateResult.adjudicated_risk_level) || agentDecision.claimed_risk_level || 'LOW'
  });
}

module.exports = {
  createChallengeQueue,
  addChallenge,
  challengeFromDecision
};
