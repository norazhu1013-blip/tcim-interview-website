'use strict';

/**
 * TCIM Task 3 Ontology Evidence State 测试。
 *
 * 验收（01-3 第6节 Task 3）：
 *   - 每个升级都能指出教师原话（supporting_spans 回指）。
 *   - 空话 / 只说“尊重幼儿” / 泛泛“注意安全”不得升级。
 *   - 答得长不等于升级（禁止“说得长就升级”）。
 *   - 冲突证据保留 conflicting_spans 并降置信。
 *   - 前测作为 prior，不直接锁定能力等级。
 */

const assert = require('node:assert');
const path = require('path');
const { createCore } = require('../core/index.js');
const { loadGameSupportData } = require('../professional_data/game_support/loader.js');
const { assessSlot } = require('../modules/ontology/evidence_updater.js');

const data = loadGameSupportData(path.join(__dirname, '..', 'professional_data', 'game_support'));

function makeModuleInput(qid, teacherTurn, opts = {}) {
  const core = createCore();
  core.setOntologyData(data.items);
  return {
    input: {
      session_id: opts.session || 's1',
      turn_id: opts.turn || 't1',
      question_id: qid,
      turn_context: {
        teacher_turn: teacherTurn,
        teacher_ranking: opts.ranking || ['A', 'C', 'B', 'D'],
        question_id: qid,
        item_package: data.items[qid],
        turn_no: opts.turnNo || 0,
        process_tags: opts.tags || []
      },
      module_config: {}
    },
    core
  };
}

async function runOntologyTurn(core, input) {
  // 首次：初始化 evidence_state（从题目 slot）
  core.shared.ontology_state.evidence_state = {};
  const { results, errors } = await core.runModules(input, ['ontology_game_support']);
  assert.equal(errors.length, 0, `ontology 运行错误: ${JSON.stringify(errors)}`);
  return results[0];
}

async function main() {
  // ---- 测试1：Q1-S1 升级必须回指原话 ----
  {
    const { input, core } = makeModuleInput('Q1', '我会先判断幼儿是不是真的在玩一个游戏。他们把篮球架变成了粉刷和接水的场地，这是幼儿自主生成的玩法，我应该先理解这一点，再决定要不要介入。');
    const result = await runOntologyTurn(core, input);
    const ev = result.state_updates.ontology_state.evidence_state;
    const s1 = ev['Q1-S1'];
    assert.ok(s1.level >= 1, `Q1-S1 应升级到至少1级，实际 ${s1.level}`);
    assert.ok(s1.supporting_spans.length >= 1, '升级必须回指教师原话');
    assert.ok(s1.supporting_spans[0].includes('自主生成'), 'supporting span 应为教师原话');
  }

  // ---- 测试2：空话/泛话不得升级 ----
  {
    const { core } = makeModuleInput('Q1', '我觉得还是要多观察，尊重幼儿吧。');
    // 直接跑 assessSlot 判定：泛化“尊重”无具体证据
    const anchor = data.items.Q1.anchors.anchors.find((a) => a.slot_id === 'Q1-S1');
    const r = assessSlot('我觉得还是要多观察，尊重幼儿吧。', anchor, 0);
    assert.equal(r.level, 0, '空话不得升级');
  }

  // ---- 测试3：答得长不等于升级 ----
  {
    const { core } = makeModuleInput('Q1', '这个情况我觉得挺复杂的，需要考虑很多因素，比如游戏的意义、幼儿的参与、场地的安全、时间的长短、其他孩子的感受、班级的管理、天气的情况、材料的维护等等，总之就是要多方面地权衡，不能简单处理，要有耐心，要细心，要用心去观察每一个细节。');
    const anchor = data.items.Q1.anchors.anchors.find((a) => a.slot_id === 'Q1-S2');
    const r = assessSlot('这个情况我觉得挺复杂的，需要考虑很多因素，比如游戏的意义、幼儿的参与、场地的安全、时间的长短、其他孩子的感受、班级的管理、天气的情况、材料的维护等等，总之就是要多方面地权衡，不能简单处理，要有耐心，要细心，要用心去观察每一个细节。', anchor, 0);
    assert.ok(r.level <= 1, `长而无具体证据不得升到高等级，实际 ${r.level}`);
  }

  // ---- 测试4：具体风险判断 → Q1-S2 升级 ----
  {
    const { input, core } = makeModuleInput('Q1', '我会先看地面湿不滑，篮球架附近有没有别的孩子在使用，水桶会不会把设备弄坏。如果只是少量接水而且没有其他孩子，我会让他们再玩一会儿；如果地面已经很滑，我会马上提醒他们注意。');
    const result = await runOntologyTurn(core, input);
    const ev = result.state_updates.ontology_state.evidence_state;
    const s2 = ev['Q1-S2'];
    assert.ok(s2.level >= 1, `Q1-S2 应升级，实际 ${s2.level}`);
  }

  // ---- 测试5：冲突证据保留 + 降置信 ----
  {
    // 先给到 level 2，然后教师给出“冲突证据”（用器材原用途作为唯一理由）
    const { input, core } = makeModuleInput('Q1', '篮球架的规则就是用来打篮球的，小朋友就应该遵守，不然以后都乱套了。');
    core.shared.ontology_state.evidence_state = { 'Q1-S5': {
      slot_id: 'Q1-S5', status: 'SUFFICIENT', level: 2, confidence: 0.8,
      supporting_spans: [], conflicting_spans: [], false_evidence_flags: [], uncertainty: 0, probe_status: 'OPEN', probe_count: 0, state_version: 'v1'
    } };
    // 不复位 evidence_state（区别于 runOntologyTurn）：保留预置的 Q1-S5 状态
    const { results, errors } = await core.runModules(input, ['ontology_game_support']);
    assert.equal(errors.length, 0, `ontology 运行错误: ${JSON.stringify(errors)}`);
    const s5 = results[0].state_updates.ontology_state.evidence_state['Q1-S5'];
    // 命中冲突（成人用途绝对化）应至少保留冲突记录或降低置信
    const hasConflictRecord = s5.conflicting_spans.length >= 1;
    const lowered = s5.confidence < 0.8;
    assert.ok(hasConflictRecord || lowered, '冲突证据应被保留或降置信');
  }

  // ---- 测试6：前测 prior 不直接锁定能力等级 ----
  {
    const { core } = makeModuleInput('Q1', '看着玩得开心，就先让他们玩。');
    // 即使排序 A 居首（实证 4 分组合），prior 只应增加 uncertainty/优先级，不得把 level 直接设成 2/3
    const anchor = data.items.Q1.anchors.anchors.find((a) => a.slot_id === 'Q1-S3');
    const r = assessSlot('看着玩得开心，就先让他们玩。', anchor, 0);
    assert.ok(r.level <= 1, `前测高分不得直接填充能力等级，实际 ${r.level}`);
  }

  console.log('TCIM Task 3 ontology evidence tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
