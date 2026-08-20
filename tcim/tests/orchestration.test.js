'use strict';

/**
 * TCIM Task 4 Orchestration + ReRank + protected action 测试（01-2 第13节）。
 *
 * 验收：
 *   1. Ontology 输出 Top Action Proposals；Orchestrator 产出唯一 ProfessionalActionPlan。
 *   2. ReRank 用可解释规则：professional priority + evidence gap + pretest uncertainty + conflict bonus - probe cost。
 *   3. protected action fingerprint 锁定专业目标；PRDM/Generator 改目标即指纹不匹配。
 *   4. FakeUtility 接入不改变 Ontology 的专业选择。
 *   5. knowledge_need：RAG 未启用时恒 false。
 *   6. 冲突奖金：出现冲突证据的 slot 优先提升。
 */

const assert = require('node:assert');
const path = require('node:path');
const { createCore } = require('../core/index.js');
const { loadGameSupportData } = require('../professional_data/game_support/loader.js');
const { fingerprintActionPlan } = require('../core/contracts.js');

const data = loadGameSupportData(path.join(__dirname, '..', 'professional_data', 'game_support'));

function turn(qid, teacherTurn, ranking, tags, turnNo) {
  return {
    session_id: 's1', turn_id: `t${turnNo || 0}`, question_id: qid,
    turn_context: {
      teacher_turn: teacherTurn, teacher_ranking: ranking || ['A', 'C', 'B', 'D'],
      question_id: qid, item_package: data.items[qid], turn_no: turnNo || 0, process_tags: tags || []
    },
    module_config: {}
  };
}

async function main() {
  // ---- 1) 单一 PROBE plan + fingerprint ----
  {
    const core = createCore();
    core.setOntologyData(data.items);
    const { results, errors } = await core.runModules(turn('Q1', '我会先判断幼儿是不是真的在玩一个游戏。他们把篮球架变成了粉刷和接水的场地，这是幼儿自主生成的玩法，我应该先理解这一点，再决定要不要介入。'), ['ontology_game_support']);
    assert.equal(errors.length, 0);
    const out = core.orchestrator.orchestrate(results, core.shared.ontology_state.evidence_state || {}, core.flags(), {});
    assert.ok(out.plan, '必须产出唯一 plan');
    assert.ok(out.plan.action_fingerprint, '必须锁定 fingerprint');
    assert.ok(out.plan.target_slot.startsWith('Q1-S'), `target 应为 Q1 槽: ${out.plan.target_slot}`);
    assert.equal(out.knowledge_need, false, 'RAG 未启用 knowledge_need 应为 false');
    // 同 plan 指纹稳定；改目标指纹必变
    assert.equal(fingerprintActionPlan({ action_type: 'PROBE', target_slot: 'Q1-S2', professional_objective: 'x', probe_strategy: 'y' }), fingerprintActionPlan({ action_type: 'PROBE', target_slot: 'Q1-S2', professional_objective: 'x', probe_strategy: 'y' }));
    assert.notEqual(fingerprintActionPlan({ action_type: 'PROBE', target_slot: 'Q1-S2', professional_objective: 'x', probe_strategy: 'y' }), fingerprintActionPlan({ action_type: 'PROBE', target_slot: 'Q1-S3', professional_objective: 'x', probe_strategy: 'y' }));
  }

  // ---- 2) FakeUtility 接入不改变 Ontology 选择 ----
  {
    const core = createCore();
    core.setOntologyData(data.items);
    core.setModuleEnabled('utility', true);
    const { results, errors } = await core.runModules(turn('Q1', '我会先看地面湿不滑，篮球架附近有没有别的孩子在使用，水桶会不会把设备弄坏。'), ['ontology_game_support', 'utility']);
    assert.equal(errors.length, 0, `模块运行出错: ${JSON.stringify(errors)}`);
    const outNoUtility = core.orchestrator.orchestrate(results.filter((r) => r.module_id === 'ontology_game_support'), core.shared.ontology_state.evidence_state || {}, core.flags(), {});
    const outWithUtility = core.orchestrator.orchestrate(results, core.shared.ontology_state.evidence_state || {}, core.flags(), {});
    // 两个 plan 的 target_slot / objective 必须一致（FakeUtility 只加极低权重，不抢占）
    assert.equal(outNoUtility.plan.target_slot, outWithUtility.plan.target_slot);
    assert.equal(outNoUtility.plan.professional_objective, outWithUtility.plan.professional_objective);
  }

  // ---- 3) 冲突奖金：有冲突证据的 slot 优先级提升 ----
  {
    const core = createCore();
    core.setOntologyData(data.items);
    // 预置 Q1-S2 有冲突证据，Q1-S3 无冲突但同为 P1/level0
    core.shared.ontology_state.evidence_state = {
      'Q1-S2': { slot_id: 'Q1-S2', level: 0, confidence: 0.5, conflicting_spans: ['教师前后矛盾'], supporting_spans: [], uncertainty: 0.3, probe_status: 'OPEN', probe_count: 0 },
      'Q1-S3': { slot_id: 'Q1-S3', level: 0, confidence: 0.5, conflicting_spans: [], supporting_spans: [], uncertainty: 0.3, probe_status: 'OPEN', probe_count: 0 }
    };
    const { results } = await core.runModules(turn('Q1', '看看情况再说吧。'), ['ontology_game_support']);
    const out = core.orchestrator.orchestrate(results, core.shared.ontology_state.evidence_state, core.flags(), {});
    // 冲突 bonus 使 Q1-S2 的 rank 高于 Q1-S3（若两者优先级相同）
    const ranked = out.ranked;
    const s2 = ranked.find((p) => p.target_slot === 'Q1-S2');
    const s3 = ranked.find((p) => p.target_slot === 'Q1-S3');
    assert.ok(s2.score > s3.score, `冲突 bonus 应提升 Q1-S2 排名: s2=${s2.score.toFixed(3)} s3=${s3.score.toFixed(3)}`);
  }

  // ---- 4) 高优先级 slot 在无冲突时胜出（evidence gap + 默认优先级） ----
  {
    const core = createCore();
    core.setOntologyData(data.items);
    // 无任何教师回答（空话），靠默认优先级排序：P1 > P2 > P3
    const { results } = await core.runModules(turn('Q1', '嗯，我再想想。'), ['ontology_game_support']);
    const out = core.orchestrator.orchestrate(results, core.shared.ontology_state.evidence_state || {}, core.flags(), {});
    assert.ok(out.plan.target_slot, '应产出目标槽');
    const defaultPriorities = { 'Q1-S1': 0.9, 'Q1-S2': 0.9, 'Q1-S3': 0.9, 'Q1-S4': 0.6, 'Q1-S5': 0.6 };
    assert.ok(defaultPriorities[out.plan.target_slot] >= 0.6, `plan 应为 P1/P2 槽，实际 ${out.plan.target_slot}`);
  }

  console.log('TCIM Task 4 orchestration tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
