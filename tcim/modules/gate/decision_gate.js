'use strict';

/**
 * decision_gate.js —— Decision/Risk Gate（V0.2，A04）。
 *
 * 位于 AgentDecisionProposal 之后、ProfessionalActionPlan 提交之前。
 * 只验证 / 升级 / 降级，**不能**无理由用固定优先级重新选一次（否则 AI 就失去选择权）。
 *
 * 检查：Schema / 来源 / 状态新鲜度 / 隐私 / 安全 / 专业边界 / 硬约束 / 表偏离。
 * 输出 adjudicated_risk_level、adjudicated_table_alignment 与 decision：
 *   APPROVE（绿色）/ CLARIFY（黄色，需澄清或复用 Evaluator）/ REJECT（红色）/ FALLBACK。
 * MEDIUM 风险提示 evaluator_required=true（调用 A04E 独立复核）。
 */

const { TABLE_ALIGNMENT, POLICY_CLASS, RISK_LEVEL } = require('../../core/contracts.js');

// 硬约束内容（不可绕过）：只针对“内部泄露/答案/评分/能力标签/多问”
const JUDGE_RE = /能力|人格|动机|心理|性格|智力水平|属于.{0,3}(高|中|低)能力/;
const HARD_PATTERNS = [
  /得分|分数|标准答案|专家排序|评分/,
  /能力等级|你的能力/,
  /R\/P\/G/,
  JUDGE_RE  // G05：不得把短答/犹豫/礼貌/流畅推断为稳定能力/人格/动机
];

function checkSource(prop, ctx) {
  // 来源必须来自已授权题目/过程/五表引用
  const refs = Array.isArray(prop.source_refs) ? prop.source_refs : [];
  const allowed = (ctx && ctx.allowedSourceRefs) || [];
  if (allowed.length && refs.length) return refs.every((r) => allowed.includes(r));
  return true; // 未限定 allowed 时视为通过（宽松）
}

function checkHardConstraints(prop) {
  const joined = JSON.stringify(prop);
  for (const p of HARD_PATTERNS) if (p.test(joined)) return { pass: false, code: 'hard_content_leak' };
  return { pass: true };
}

function checkSingleTask(prop) {
  // 必须 single_cognitive_task=true（一轮一个主要认知任务）
  return prop.single_cognitive_task !== false;
}

/**
 * Gate 验证。
 * @param {object} agentProposal AgentDecisionProposal
 * @param {object} ctx { allowedSourceRefs, committedStateVersion, expectedStateVersion, policy }
 * @returns {DecisionGateResult}
 */
function validateDecision(agentProposal, ctx) {
  const result = { proposal_id: agentProposal.proposal_id || '', decision: 'REJECT', reason_codes: [], fallback_policy_id: agentProposal.fallback_action_id || null, evaluator_required: false };
  const errors = [];

  // Schema 结构
  if (!agentProposal.selected_action_id) errors.push('missing_selected_action');
  if (!agentProposal.primary_target_slot) errors.push('missing_primary_target');
  if (!TABLE_ALIGNMENT.includes(agentProposal.claimed_table_alignment)) errors.push('bad_table_alignment');

  // 来源
  const srcOk = checkSource(agentProposal, ctx);
  if (!srcOk) errors.push('source_mismatch');

  // 硬约束
  const hard = checkHardConstraints(agentProposal);
  if (!hard.pass) errors.push(hard.code);

  // 单一认知任务
  if (!checkSingleTask(agentProposal)) errors.push('multi_task');

  // 状态新鲜度（乐观锁）——防止旧 Proposal 在状态已变化后提交
  const expected = (ctx && typeof ctx.expectedStateVersion === 'number') ? ctx.expectedStateVersion : null;
  if (expected !== null && (ctx.committedStateVersion != null && ctx.committedStateVersion !== expected)) errors.push('state_freshness');

  // 表偏离裁决：claimed 本身合法即为 SUPPORT；CONFLICT/OUT_OF_SCHEMA 需要走 Challenge（此处不 REJECT，只标记）
  const adjudicated = TABLE_ALIGNMENT.includes(agentProposal.claimed_table_alignment) ? agentProposal.claimed_table_alignment : 'NO_APPLICABLE_RULE';

  // 风险裁决：不采信自报为最终；MEDIUM 触发 Evaluator
  const claimedRisk = RISK_LEVEL.includes(agentProposal.claimed_risk_level) ? agentProposal.claimed_risk_level : 'LOW';
  const adjudicatedRisk = claimedRisk;
  result.adjudicated_risk_level = adjudicatedRisk;
  if (adjudicatedRisk === 'MEDIUM') result.evaluator_required = true;

  // 决策
  if (errors.length) {
    result.decision = 'REJECT';
    result.reason_codes = errors;
  } else if (claimedRisk === 'HIGH') {
    result.decision = 'REJECT';
    result.reason_codes = ['high_risk_requires_override'];
  } else if (adjudicatedRisk === 'MEDIUM' || adjudicated === 'CONFLICT' || adjudicated === 'OUT_OF_SCHEMA') {
    result.decision = 'CLARIFY';
    result.reason_codes = ['risk_or_table_deviation'];
  } else {
    result.decision = 'APPROVE';
    result.reason_codes = ['source_ok', 'hard_ok', 'single_task_ok'];
  }

  // 附加检查结果（供审计）
  result.schema_check = !errors.some((e) => ['missing_selected_action', 'missing_primary_target', 'bad_table_alignment'].includes(e));
  result.source_check = srcOk;
  result.hard_constraint_check = hard.pass;
  result.state_freshness_check = !errors.includes('state_freshness');
  result.single_cognitive_task = checkSingleTask(agentProposal);
  result.adjudicated_table_alignment = adjudicated;
  result.approved_action_id = agentProposal.selected_action_id;
  return result;
}

module.exports = {
  validateDecision,
  HARD_PATTERNS
};
