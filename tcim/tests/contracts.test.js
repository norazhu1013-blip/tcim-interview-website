'use strict';

/**
 * TCIM Task 0 Contract Tests（01-2 第13节）。
 *
 * Gate 验收：
 *   1. 以后加 Utility，不需要改 Ontology 内部代码（FakeUtility 可无侵入接入）。
 *   2. 谁拥有最终 ProfessionalActionPlan？Decision Orchestrator。
 *   3. Ontology 能直接给教师发问吗？不能。
 *   4. Evidence State 谁能写？Ontology owner。
 *   5. PRDM/RAG 以后如何关闭做实验？Registry/feature flag，不是删代码。
 */

const assert = require('node:assert');
const path = require('node:path');
const { createCore } = require('../core/index.js');
const {
  validateModuleResult,
  validateProfessionalActionPlan,
  fingerprintActionPlan,
  ACTION_TYPES
} = require('../core/contracts.js');
const { createEmptyState, applyStateUpdates } = require('../core/shared_state.js');
const { buildTurnContext } = require('../core/turn_context.js');
const { orchestrate } = require('../core/orchestrator.js');
const { loadGameSupportData } = require('../professional_data/game_support/loader.js');

async function main() {
  // 1) FakeUtility 可无侵入接入：先建 core，注入真实 ontology 数据 + 启用 utility
  const core = createCore();
  const data = loadGameSupportData(path.join(__dirname, '..', 'professional_data', 'game_support'));
  core.setOntologyData(data.items);
  core.setModuleEnabled('utility', true); // 假模块接入，不修改 ontology 内部

  // 2) 运行模块（ontology + utility），确认两者结果都能被 Runner 接受
  const input = buildTurnContext({
    session_id: 's1',
    question_id: 'Q1',
    teacher_turn: '我会先看看地面是否湿滑，再决定要不要马上介入。',
    teacher_ranking: ['A', 'C', 'B', 'D'],
    evidence_state: {},
    item_package: data.items.Q1
  });
  const { results, errors } = await core.runModules(input, ['ontology_game_support', 'utility']);
  assert.equal(errors.length, 0, `模块运行出错: ${JSON.stringify(errors)}`);
  const ids = results.map((r) => r.module_id).sort();
  assert.deepEqual(ids, ['ontology_game_support', 'utility']);

  // 3) Orchestrator 拥有最终 ProfessionalActionPlan
  const orchestrated = orchestrate(results, {}, core.flags(), { sourceModuleVersions: ['ontology_game_support@' + data.version] });
  assert.ok(orchestrated.plan, 'orchestrator 未产出 plan');
  assert.equal(orchestrated.plan.action_fingerprint, orchestrated.action_fingerprint);
  // 目标 slot 必须是 Q1 真实存在的核心槽
  const q1Slots = data.items.Q1.ontology.slots.map((s) => s.slot_id);
  assert.ok(q1Slots.includes(orchestrated.plan.target_slot), `target_slot ${orchestrated.plan.target_slot} 不在 Q1 slots 中`);
  const planValid = validateProfessionalActionPlan(orchestrated.plan);
  assert.ok(planValid.ok, `ProfessionalActionPlan 非法: ${planValid.errors.join('; ')}`);
  assert.ok(ACTION_TYPES.includes(orchestrated.plan.action_type));

  // 4) Ontology 不能直接给教师发问：ModuleResult 只能有 proposals，不能有 teacher_visible_text
  assert.equal(results[0].teacher_visible_text, undefined, 'Ontology 不得直接生成教师可见文本');

  // 5) Evidence State 只有 Ontology owner 可写：Utility 尝试写 ontology_state 会被拒绝
  const badResult = {
    module_id: 'utility',
    module_version: '0.0.0-test',
    action_proposals: [],
    state_updates: { ontology_state: { hacked: true } }  // 越权
  };
  const rejected = validateModuleResult(badResult, 'utility');
  assert.equal(rejected.ok, false, 'Utility 越权写 ontology_state 必须被拒绝');
  assert.ok(rejected.errors[0].includes('ontology_state'));

  // 6) PRDM/RAG 关闭做实验：feature flag，不是删代码
  core.setFlag('prdm_v01', false);
  core.setFlag('rag_v01', false);
  assert.equal(core.flags().prdm_v01, false);
  assert.equal(core.flags().rag_v01, false);

  // 7) fingerprint 锁定：同 plan 相同指纹，改目标则指纹变
  const p1 = { action_type: 'PROBE', target_slot: 'Q1-S1', professional_objective: 'x', probe_strategy: 'y' };
  const p2 = { action_type: 'PROBE', target_slot: 'Q1-S2', professional_objective: 'x', probe_strategy: 'y' };
  assert.notEqual(fingerprintActionPlan(p1), fingerprintActionPlan(p2));
  assert.equal(fingerprintActionPlan(p1), fingerprintActionPlan({ ...p1 }));

  // 8) state owner 强制：ontology 模块不能写 dialogue_state
  assert.throws(() => applyStateUpdates(createEmptyState(), 'ontology', { dialogue_state: {} }));

  console.log('TCIM Task 0 contract tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
