'use strict';

/**
 * planner_core.test.js —— gsyg_planner 纯逻辑层测试（无 wx-server-sdk / 无网络）。
 *
 * - 合法 AgentDecisionProposal（含 candidate_actions >= 2, selected, 单一任务）通过；
 * - G05（能力/人格判定词）、泄露（得分/标准答案）、结构缺失（无 selected）被拒；
 * - adjudicate：LOW/SUPPORT -> APPROVE；MEDIUM 或表外 -> CLARIFY + evaluator_required；HIGH -> REJECT；
 * - 表对齐/风险枚举冻结。
 */

const assert = require('node:assert');
const { normalizeDecision, validateDecision, adjudicate, TABLE_ALIGNMENT, RISK_LEVEL } = require('./planner_core.js');

const VALID = { 'Q8-S1': 1, 'Q8-S2': 1, 'Q8-S3': 1, 'Q8-S4': 1, 'Q8-S5': 1 };

function main() {
  // ---- 1. 合法决策通过 ----
  {
    const raw = {
      candidate_actions: ['C-Q8-S3', 'C-Q8-S4'],
      selected_action_id: 'C-Q8-S4',
      rejected_action_ids: ['C-Q8-S3'],
      primary_target_slot: 'Q8-S4',
      single_cognitive_task: true,
      claimed_table_alignment: 'SUPPORT',
      claimed_risk_level: 'LOW',
      why_this_now: '变量比较更能区分信念',
      source_refs: ['T1']
    };
    const v = validateDecision(raw, { validSlotIds: new Set(Object.keys(VALID)) });
    assert.equal(v.ok, true, '合法决策应通过: ' + JSON.stringify(v.errors));
    assert.equal(v.proposal.selected_action_id, 'C-Q8-S4');
  }

  // ---- 2. G05 判定词被拒 ----
  {
    const raw = { selected_action_id: 'C-Q8-S3', primary_target_slot: 'Q8-S3', claimed_table_alignment: 'SUPPORT', claimed_risk_level: 'LOW', source_refs: [], why_this_now: '教师能力是低' };
    const v = validateDecision(raw, { validSlotIds: new Set(Object.keys(VALID)) });
    assert.equal(v.ok, false, 'G05 应被拒');
    assert.ok(v.errors.includes('G05_able_judge'));
  }

  // ---- 3. 泄露得分/标准答案被拒 ----
  {
    const raw = { selected_action_id: 'C-Q8-S3', primary_target_slot: 'Q8-S3', claimed_table_alignment: 'SUPPORT', claimed_risk_level: 'LOW', source_refs: [], why_this_now: '按标准答案打分' };
    const v = validateDecision(raw, { validSlotIds: new Set(Object.keys(VALID)) });
    assert.equal(v.ok, false, '泄露应被拒');
    assert.ok(v.errors.includes('leak_score_answer'));
  }

  // ---- 4. 结构缺失（无 selected）被拒 ----
  {
    const raw = { candidate_actions: [], selected_action_id: null, primary_target_slot: null, claimed_table_alignment: 'SUPPORT', claimed_risk_level: 'LOW' };
    const v = validateDecision(raw, {});
    assert.equal(v.ok, false);
    assert.ok(v.errors.includes('missing_selected_action'));
  }

  // ---- 5. Gate 裁决：LOW/SUPPORT -> APPROVE ----
  {
    const d = normalizeDecision({ selected_action_id: 'C-Q8-S4', primary_target_slot: 'Q8-S4', claimed_table_alignment: 'SUPPORT', claimed_risk_level: 'LOW', single_cognitive_task: true, source_refs: [] });
    const g = adjudicate(d, {});
    assert.equal(g.decision, 'APPROVE');
    assert.equal(g.adjudicated_risk_level, 'LOW');
    assert.equal(g.evaluator_required, false);
  }

  // ---- 6. Gate 裁决：MEDIUM -> CLARIFY + evaluator_required ----
  {
    const d = normalizeDecision({ selected_action_id: 'C-Q8-S4', primary_target_slot: 'Q8-S4', claimed_table_alignment: 'PARTIAL', claimed_risk_level: 'MEDIUM', single_cognitive_task: true, source_refs: [] });
    const g = adjudicate(d, {});
    assert.equal(g.decision, 'CLARIFY');
    assert.equal(g.evaluator_required, true);
  }

  // ---- 7. Gate 裁决：HIGH -> REJECT；表外 -> CLARIFY ----
  {
    const hi = normalizeDecision({ selected_action_id: 'C-Q8-S4', primary_target_slot: 'Q8-S4', claimed_table_alignment: 'SUPPORT', claimed_risk_level: 'HIGH', single_cognitive_task: true, source_refs: [] });
    assert.equal(adjudicate(hi, {}).decision, 'REJECT');
    const out = normalizeDecision({ selected_action_id: 'C-Q8-S4', primary_target_slot: 'Q8-S4', claimed_table_alignment: 'OUT_OF_SCHEMA', claimed_risk_level: 'LOW', single_cognitive_task: true, source_refs: [] });
    assert.equal(adjudicate(out, {}).decision, 'CLARIFY');
  }

  // ---- 8. 枚举冻结 ----
  assert.deepEqual(TABLE_ALIGNMENT, ['SUPPORT', 'PARTIAL', 'CONFLICT', 'OUT_OF_SCHEMA', 'NO_APPLICABLE_RULE']);
  assert.deepEqual(RISK_LEVEL, ['LOW', 'MEDIUM', 'HIGH']);

  console.log('gsyg_planner planner_core tests passed');
}

try { main(); } catch (e) { console.error(e); process.exit(1); }
