'use strict';

/**
 * planner_core.js —— gsyg_planner 纯逻辑层（无 wx-server-sdk / 无网络 I/O）。
 *
 * 承担 A03（Agent Planner）+ A04（Decision/Risk Gate）的确定性部分：
 *  - planFromLLM：把 LLM 的 AgentDecisionProposal 规范化 + 校验（G05/泄露/表对齐/风险/单一任务）。
 *  - adjudicate：基于 proposals 用确定性 Risk Gate 裁决（无理由不重做选择，只验证/升级/降级）。
 *
 * 让「LLM 结构化输出 → 校验 → Gate 裁决 → Proposal」可脱离云端在本机验证。
 */

const TABLE_ALIGNMENT = ['SUPPORT', 'PARTIAL', 'CONFLICT', 'OUT_OF_SCHEMA', 'NO_APPLICABLE_RULE'];
const RISK_LEVEL = ['LOW', 'MEDIUM', 'HIGH'];
const JUDGE_RE = /能力|人格|动机|心理|性格|智力水平|属于.{0,3}(高|中|低)能力/;
const LEAK_RE = /得分|分数|标准答案|专家排序|评分|R\/P\/G/;

const EMPTY_DECISION = Object.freeze({
  proposal_type: 'AgentDecisionProposal',
  candidate_actions: [],
  selected_action_id: null,
  primary_target_slot: null,
  claimed_table_alignment: 'SUPPORT',
  claimed_risk_level: 'LOW',
  single_cognitive_task: true,
  rejected_action_ids: [],
  why_this_now: '',
  source_refs: [],
  fallback_action_id: null
});

function emptyDecision() {
  return { ...EMPTY_DECISION };
}

function normalizeDecision(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    proposal_type: 'AgentDecisionProposal',
    candidate_actions: Array.isArray(p.candidate_actions) ? p.candidate_actions : [],
    selected_action_id: p.selected_action_id || null,
    primary_target_slot: p.primary_target_slot || null,
    supporting_slot_refs: Array.isArray(p.supporting_slot_refs) ? p.supporting_slot_refs : [],
    single_cognitive_task: p.single_cognitive_task !== false,
    cognitive_task_code: p.cognitive_task_code || null,
    claimed_table_alignment: TABLE_ALIGNMENT.includes(p.claimed_table_alignment) ? p.claimed_table_alignment : 'SUPPORT',
    claimed_risk_level: RISK_LEVEL.includes(p.claimed_risk_level) ? p.claimed_risk_level : 'LOW',
    rejected_action_ids: Array.isArray(p.rejected_action_ids) ? p.rejected_action_ids : [],
    why_this_now: p.why_this_now || '',
    prior_disposition: p.prior_disposition || 'NEUTRAL',
    fallback_action_id: p.fallback_action_id || null,
    exit_condition: p.exit_condition || null,
    source_refs: Array.isArray(p.source_refs) ? p.source_refs : [],
    model_prompt_schema_versions: Array.isArray(p.model_prompt_schema_versions) ? p.model_prompt_schema_versions : ['agent-planner-v0.2']
  };
}

/**
 * G05/泄露/结构校验（服务端保险，不信任 LLM 自由输出）。
 * @param {object} raw LLM 原始输出
 * @param {object} ctx { validSlotIds, allowedSourceRefs? }
 * @returns {{ ok, errors, proposal }}
 */
function validateDecision(raw, ctx) {
  const errors = [];
  const normalized = normalizeDecision(raw);
  const validSlotIds = (ctx && ctx.validSlotIds) || null;

  // 结构
  if (!normalized.selected_action_id) errors.push('missing_selected_action');
  if (!normalized.primary_target_slot) errors.push('missing_primary_target');
  else if (validSlotIds && !validSlotIds.has(normalized.primary_target_slot)) errors.push('target_slot_not_in_item');

  // G05 / 泄露（对整个 proposal JSON 扫描）
  const joined = JSON.stringify(normalized);
  if (JUDGE_RE.test(joined)) errors.push('G05_able_judge');
  if (LEAK_RE.test(joined)) errors.push('leak_score_answer');

  // 表对齐 / 风险合法
  if (!TABLE_ALIGNMENT.includes(normalized.claimed_table_alignment)) errors.push('bad_table_alignment');
  if (!RISK_LEVEL.includes(normalized.claimed_risk_level)) errors.push('bad_risk_level');

  // 来源（若给定 allowed 列表）
  const allowed = (ctx && ctx.allowedSourceRefs) || [];
  if (allowed.length && normalized.source_refs.length) {
    if (!normalized.source_refs.every((r) => allowed.includes(r))) errors.push('source_mismatch');
  }

  return { ok: errors.length === 0, errors, proposal: normalized };
}

/**
 * Risk Gate 裁决（A04）：只验证/升级/降级，不重做选择。APPROVE/CLARIFY/REJECT + adjudicated 值。
 */
function adjudicate(proposal, gateInput) {
  const result = { proposal_id: proposal.selected_action_id || '', decision: 'REJECT', reason_codes: [], evaluator_required: false };
  const hardOk = !JUDGE_RE.test(JSON.stringify(proposal)) && !LEAK_RE.test(JSON.stringify(proposal));
  const oneTask = proposal.single_cognitive_task !== false;
  const risk = proposal.claimed_risk_level;
  const alignment = proposal.claimed_table_alignment;

  result.adjudicated_risk_level = risk;
  result.adjudicated_table_alignment = alignment;

  if (!hardOk) { result.decision = 'REJECT'; result.reason_codes = ['hard_constraint']; }
  else if (!oneTask) { result.decision = 'REJECT'; result.reason_codes = ['multi_task']; }
  else if (risk === 'HIGH') { result.decision = 'REJECT'; result.reason_codes = ['high_risk']; }
  else if (risk === 'MEDIUM' || ['CONFLICT', 'OUT_OF_SCHEMA'].includes(alignment)) { result.decision = 'CLARIFY'; result.evaluator_required = true; result.reason_codes = ['risk_or_table_deviation']; }
  else { result.decision = 'APPROVE'; result.reason_codes = ['source_ok', 'hard_ok', 'single_task_ok']; }

  result.approved_action_id = proposal.selected_action_id || null;
  result.single_cognitive_task = oneTask;
  result.hard_constraint_check = hardOk;
  return result;
}

module.exports = {
  TABLE_ALIGNMENT,
  RISK_LEVEL,
  EMPTY_DECISION,
  emptyDecision,
  normalizeDecision,
  validateDecision,
  adjudicate
};
