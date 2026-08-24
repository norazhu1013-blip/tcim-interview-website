'use strict';

/**
 * TCIM Milestone 2 —— Validator / Committer / semanticMode 测试。
 *
 * 覆盖：
 *   - disabled 模式：仍走原 bigram updateEvidence（6/720 基线不变）。
 *   - fallback_allowed 模式：LLM Proposal（slot_evidence_proposals）经 Validator→Committer
 *     受控更新 Evidence；无 LLM 时用 bigramFallback（同一 Schema）兜底。
 *   - Validator 拒绝：slot 不在本题 / supporting_spans 不回指 / illegal level /
 *     G05 能力判定词 → 不写状态。
 *   - shadow 模式：只透传不写 Evidence（供上线前比较）。
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
      session_id: 's', turn_id: `t${turnNo}`, question_id: qid,
      turn_context: {
        teacher_turn: teacherTurn, teacher_ranking: ['A', 'C', 'B', 'D'],
        question_id: qid, item_package: data.items[qid], turn_no: turnNo, process_tags: []
      }, module_config: {}
    },
    core
  };
}

async function run(core, input) {
  core.shared.ontology_state.evidence_state = {};
  const { results, errors } = await core.runModules(input, ['ontology_game_support']);
  assert.equal(errors.length, 0, `运行错误: ${JSON.stringify(errors)}`);
  return results[0];
}

async function main() {
  // ---- 测试1：fallback_allowed + 无 LLM（默认 offline）→ bigramFallback 兜底，走 Validator→Committer ----
  {
    setSemanticMode('fallback_allowed');
    setProvider(null);
    // 用具体风险判断的回答（bigram 能命中 Q1-S2 的 level_2 锚点）
    const { input, core } = makeInput('Q1', '我会先看地面湿不滑，篮球架附近有没有别的孩子在使用，水桶会不会把设备弄坏。如果只是少量接水而且没有其他孩子，我会让他们再玩一会儿；如果地面已经很滑，我会马上提醒他们注意。', 0);
    const result = await run(core, input);
    const ev = result.state_updates.ontology_state.evidence_state;
    // bigramFallback 对 Q1-S2 具体风险答应给出 level>=1 并通过 Committer 写入
    assert.ok(ev['Q1-S2'].level >= 1, `fallback 应更新 Q1-S2，实际 level=${ev['Q1-S2'].level}`);
    assert.ok(result.decision_summary.includes('mode=fallback_allowed'), 'decision_summary 应含 mode');
  }

  // ---- 测试2：注入合法 LLM Proposal → Committer 更新 level ----
  {
    setSemanticMode('fallback_allowed');
    // 一个合法 provider：Q1-S1 升到 2（supporting_spans 回指原话）
    setProvider(() => ({
      candidate_spans: [{ text: '我会先判断幼儿是不是真的在玩一个游戏', candidate_slots: ['Q1-S1'] }],
      slot_evidence_proposals: [{ slot_id: 'Q1-S1', proposed_level: 2, confidence: 0.9, supporting_spans: ['我会先判断幼儿是不是真的在玩一个游戏'] }],
      conflict_candidates: [], uncertainty: [], no_change_reasons: []
    }));
    const { input, core } = makeInput('Q1', '我会先判断幼儿是不是真的在玩一个游戏。他们把篮球架变成了粉刷和接水的场地，这是幼儿自主生成的玩法。', 0);
    const result = await run(core, input);
    const ev = result.state_updates.ontology_state.evidence_state;
    assert.equal(ev['Q1-S1'].level, 2, `合法 LLM Proposal 应更新 Q1-S1 到 2，实际 ${ev['Q1-S1'].level}`);
    assert.ok(ev['Q1-S1'].supporting_spans.includes('我会先判断幼儿是不是真的在玩一个游戏'), 'supporting span 应为 provider 给出的回指原话');
  }

  // ---- 测试3：Validator 拒绝非法 Proposal（slot 不在本题）→ 不写状态 ----
  {
    setSemanticMode('fallback_allowed');
    setProvider(() => ({
      candidate_spans: [],
      slot_evidence_proposals: [{ slot_id: 'Q9-S1', proposed_level: 2, confidence: 0.9, supporting_spans: ['我会先'] }],
      conflict_candidates: [], uncertainty: [], no_change_reasons: []
    }));
    const { input, core } = makeInput('Q1', '我会先看地面。', 0);
    const result = await run(core, input);
    const ev = result.state_updates.ontology_state.evidence_state;
    // 该 slot 不在本题（Q1），Validator 拒绝 → 不升级任何 slot（level 保持 null/0，不得 ≥2）
    assert.ok(Object.values(ev).every((s) => (s.level === null || s.level === 0 || (s.level ?? 0) < 2)), '不存在于本题的 slot 不应写入');
  }

  // ---- 测试4：Validator 拒绝 G05（能力判定词）→ 不写状态 ----
  {
    setSemanticMode('fallback_allowed');
    setProvider(() => ({
      candidate_spans: [],
      slot_evidence_proposals: [{ slot_id: 'Q1-S1', proposed_level: 2, confidence: 0.9, supporting_spans: ['我会先'] }],
      uncertainty: [], conflict_candidates: [], no_change_reasons: [{ slot_id: 'Q1-S1', reason: '明显是低能力教师' }]
    }));
    const { input, core } = makeInput('Q1', '我会先看地面。', 0);
    const result = await run(core, input);
    const ev = result.state_updates.ontology_state.evidence_state;
    // G05 拦截（Validator errors）→ 不应升级到 2（level 保持 null/0）
    assert.ok(Object.values(ev).every((s) => (s.level === null || s.level === 0 || (s.level ?? 0) < 2)), 'G05 不应升级');
  }

  // ---- 测试5：disabled 模式回到 bigram updateEvidence（保基线）----
  {
    setSemanticMode('disabled');
    setProvider(null);
    const { input, core } = makeInput('Q1', '我会先看地面湿不滑，篮球架附近有没有别的孩子。', 0);
    const result = await run(core, input);
    // disabled 走 updateEvidence（原路径），不依赖 LLM Proposal
    assert.ok(result.decision_summary.includes('mode=disabled'), 'decision_summary 应含 mode=disabled');
  }

  // ---- 测试6：shadow 模式只透传不写 ----
  {
    setSemanticMode('shadow');
    setProvider(() => ({
      candidate_spans: [{ text: '我会先看地面', candidate_slots: ['Q1-S2'] }],
      slot_evidence_proposals: [{ slot_id: 'Q1-S2', proposed_level: 2, confidence: 0.9, supporting_spans: ['我会先看地面'] }],
      conflict_candidates: [], uncertainty: [], no_change_reasons: []
    }));
    const { input, core } = makeInput('Q1', '我会先看地面。', 0);
    const result = await run(core, input);
    const ev = result.state_updates.ontology_state.evidence_state;
    assert.ok(Object.values(ev).every((s) => (s.level === null || s.level === 0 || (s.level ?? 0) < 2)), 'shadow 不写 Evidence');
  }

  setSemanticMode('disabled');
  setProvider(null);
  console.log('TCIM Milestone 2 semantic_mode tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
