'use strict';

/**
 * TCIM V0.2 AI Agent Planner（A03）+ Decision/Risk Gate（A04）验收。
 *
 * - Planner 用真实 Q8 数据生成至少 3 个候选并选 selected_action（引用 Evidence 缺口 + 单一任务）。
 * - 可插拔 chooseAction 让 AI（模拟）优先选非默认 slot（证明 AI 有真实选择权，不是机械取最高）。
 * - Gate 对合法绿色 Proposal -> APPROVE；对含能力/答案泄露 -> REJECT；
 *   对 MEDIUM 风险 -> CLARIFY + evaluator_required；不重做选择（不采信自报为最终）。
 * - adjudicated_risk / table_alignment 独立给值。
 */

const assert = require('node:assert');
const path = require('node:path');
const { loadGameSupportData } = require('../professional_data/game_support/loader.js');
const { planDecision, defaultCandidateActions } = require('../modules/planner/agent_planner.js');
const { validateDecision } = require('../modules/gate/decision_gate.js');
const { TABLE_ALIGNMENT, RISK_LEVEL, POLICY_CLASS } = require('../core/contracts.js');

const data = loadGameSupportData(path.join(__dirname, '..', 'professional_data', 'game_support'));
const item = data.items.Q8;

function main() {
  // ---- 1. Planner 用真实 Q8 生成 >=3 候选，选最高 gap（确定性默认）----
  {
    const evidence = {}; // 全 null
    const proposal = planDecision({ item, evidence, teacherModel: { active_belief_refs: [], source_refs: [] } });
    assert.equal(proposal.proposal_type, 'AgentDecisionProposal');
    assert.ok(proposal.candidate_actions.length >= 3, '应有 >=3 候选');
    assert.ok(proposal.selected_action_id, '应有 selected_action');
    assert.ok(proposal.rejected_action_ids.length >= 2, '应有 rejected_actions');
    assert.equal(proposal.single_cognitive_task, true);
    assert.ok(TABLE_ALIGNMENT.includes(proposal.claimed_table_alignment));
    assert.ok(RISK_LEVEL.includes(proposal.claimed_risk_level));
  }

  // ---- 2. 可插拔 chooseAction：AI（模拟）选择非 gap 最高，证明有真实选择权 ----
  {
    const candidates = defaultCandidateActions(item, {});
    // 人为让 AI 选最后一个（低 gap）——证明 Planner 不机械取最高
    const proposal = planDecision({
      item,
      evidence: {},
      teacherModel: { active_belief_refs: ['H1'] },
      candidateActions: candidates,
      chooseAction: (cands) => ({ selected: cands[cands.length - 1], why_this_now: 'ai_override_for_belief' })
    });
    assert.ok(proposal.why_this_now === 'ai_override_for_belief', 'AI override 应被采纳');
    assert.equal(proposal.selected_action_id, candidates[candidates.length - 1].action_id);
    assert.equal(proposal.candidate_hypotheses[0], 'H1', 'teacher_model belief refs 应进 hypotheses');
  }

  // ---- 3. Gate：合法绿色 -> APPROVE ----
  {
    const proposal = planDecision({ item, evidence: {}, teacherModel: { active_belief_refs: [], source_refs: [] } });
    const gate = validateDecision(proposal, { expectedStateVersion: 0, committedStateVersion: 0 });
    assert.equal(gate.decision, 'APPROVE', '合法 green 应 APPROVE: ' + gate.reason_codes.join(','));
    assert.ok(gate.adjudicated_risk_level === 'LOW');
    assert.equal(gate.approved_action_id, proposal.selected_action_id);
    assert.equal(gate.evaluator_required, false);
  }

  // ---- 4. Gate：含能力/答案泄露 -> REJECT（硬约束）----
  {
    const proposal = planDecision({ item, evidence: {}, teacherModel: {}, candidateActions: defaultCandidateActions(item, {}) });
    const leaky = Object.assign({}, proposal, { source_refs: [], interpretation: '教师是低能力' });
    const gate = validateDecision(leaky, {});
    assert.equal(gate.decision, 'REJECT', '泄露应 REJECT');
    assert.equal(gate.hard_constraint_check, false);
  }

  // ---- 5. Gate：MEDIUM risk -> CLARIFY + evaluator_required ----
  {
    const proposal = planDecision({ item, evidence: {}, teacherModel: {}, candidateActions: defaultCandidateActions(item, {}) });
    const medium = Object.assign({}, proposal, { claimed_risk_level: 'MEDIUM' });
    const gate = validateDecision(medium, { expectedStateVersion: 0, committedStateVersion: 0 });
    assert.equal(gate.decision, 'CLARIFY', 'MEDIUM 应 CLARIFY: ' + gate.reason_codes.join(','));
    assert.equal(gate.evaluator_required, true);
    assert.equal(gate.adjudicated_risk_level, 'MEDIUM');
  }

  // ---- 6. Gate：表偏离 OUT_OF_SCHEMA -> CLARIFY + adjudicated 保留 ----
  {
    const proposal = planDecision({ item, evidence: {}, teacherModel: {}, candidateActions: defaultCandidateActions(item, {}) });
    const out = Object.assign({}, proposal, { claimed_table_alignment: 'OUT_OF_SCHEMA' });
    const gate = validateDecision(out, {});
    assert.equal(gate.adjudicated_table_alignment, 'OUT_OF_SCHEMA');
    assert.equal(gate.decision, 'CLARIFY', '表偏离应 CLARIFY');
  }

  // ---- 7. 枚举冻结 ----
  assert.deepEqual(TABLE_ALIGNMENT, ['SUPPORT', 'PARTIAL', 'CONFLICT', 'OUT_OF_SCHEMA', 'NO_APPLICABLE_RULE']);
  assert.deepEqual(RISK_LEVEL, ['LOW', 'MEDIUM', 'HIGH']);
  assert.deepEqual(POLICY_CLASS, ['HARD', 'SOFT', 'PRIOR', 'ADVISORY']);

  console.log('TCIM V0.2 planner + gate tests passed');
}

try { main(); } catch (e) { console.error(e); process.exit(1); }
