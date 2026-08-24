'use strict';

/**
 * TCIM V0.2 双状态运行时链（A01→A02 Evidence→A02B Belief→Teacher Model→A03 Planner→A04 Gate）验收。
 *
 * 用一个「合法 LLM Proposal + 一条 uncertainty」驱动的教师轮次，走完整个语义主路径：
 *  - Evidence 由 Committer 受控更新（Q1-S1 -> 2）
 *  - Belief 由 uncertainty 产生 ADD 事件（进 diagnostics）
 *  - Teacher Model 快照引用该 Belief
 *  - Planner 产 selected_action（引用 evidence gap）
 *  - Gate 裁决 APPROVE（绿色）
 *  - 且不写 contextual_belief_state（契约：Belief 由独立 Belief Manager 写）
 * disabled 基线仍 6/720（规则对照）。
 */

const assert = require('node:assert');
const path = require('node:path');
const { createCore } = require('../core/index.js');
const { loadGameSupportData } = require('../professional_data/game_support/loader.js');
const { setSemanticMode } = require('../modules/ontology/game_support_ontology.js');
const { setProvider } = require('../modules/evidence_semantic/evidence_semantic.js');

const data = loadGameSupportData(path.join(__dirname, '..', 'professional_data', 'game_support'));

function makeInput(qid, teacherTurn, turnNo = 0) {
  const core = createCore();
  core.setOntologyData(data.items);
  return {
    input: {
      session_id: 'v2', turn_id: `t${turnNo}`, question_id: qid,
      turn_context: { teacher_turn: teacherTurn, teacher_ranking: ['A', 'C', 'B', 'D'], question_id: qid, item_package: data.items[qid], turn_no: turnNo, process_tags: [] }, module_config: {}
    }, core
  };
}

async function run(core, input) {
  core.shared.ontology_state.evidence_state = {};
  // 注入 belief 初始
  if (!core.shared.contextual_belief_state) core.shared.contextual_belief_state = { beliefs: {}, version: 0 };
  const { results, errors } = await core.runModules(input, ['ontology_game_support']);
  assert.equal(errors.length, 0, `运行错误: ${JSON.stringify(errors)}`);
  return results[0];
}

async function main() {
  // ---- 双状态链：fallback_allowed + 合法 LLM Proposal（含 uncertainty）----
  setSemanticMode('fallback_allowed');
  setProvider(() => ({
    candidate_spans: [{ text: '我会先判断幼儿是不是真的在玩一个游戏', candidate_slots: ['Q1-S1'] }],
    slot_evidence_proposals: [{ slot_id: 'Q1-S1', proposed_level: 2, confidence: 0.9, supporting_spans: ['我会先判断幼儿是不是真的在玩一个游戏'] }],
    uncertainty: ['我还想知道教师依据什么现象决定是否介入'],
    conflict_candidates: [], no_change_reasons: []
  }));
  {
    const { input, core } = makeInput('Q1', '我会先判断幼儿是不是真的在玩一个游戏。他们把篮球架变成了粉刷和接水的场地，这是幼儿自主生成的玩法。', 0);
    const result = await run(core, input);
    const ev = result.state_updates.ontology_state.evidence_state;
    // 1) Evidence 受控更新
    assert.equal(ev['Q1-S1'].level, 2, 'Evidence Q1-S1 应升到 2');
    const diag = result.diagnostics || [];
    // 2) Belief ADD 事件（进 diagnostics，不写 state_updates）
    assert.ok(diag.some((d) => d.reason === 'belief_ADD'), '应有 belief_ADD 观察');
    // 3) Teacher Model 快照
    assert.ok(diag.some((d) => d.reason === 'teacher_model_snapshot' && Array.isArray(d.active_belief_refs)), '应有 teacher_model_snapshot');
    // 4) Planner 选择
    assert.ok(diag.some((d) => d.reason === 'agent_decision' && d.selected_action_id), '应有 agent_decision');
    // 5) Gate 裁决绿色 APPROVE
    assert.ok(diag.some((d) => d.reason === 'gate_result' && d.decision === 'APPROVE'), '绿色应 APPROVE');
    // 6) 不写 contextual_belief_state（契约）
    assert.ok(!result.state_updates.contextual_belief_state, '本模块不得写 belief namespace');
    // 7) decision_summary 含 belief/planner/gate
    assert.ok(/mode=fallback_allowed/.test(result.decision_summary));
    assert.ok(/belief=1/.test(result.decision_summary), 'belief 数应为 1');
  }

  setSemanticMode('disabled');
  setProvider(null);
  console.log('TCIM V0.2 double-state chain tests passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
