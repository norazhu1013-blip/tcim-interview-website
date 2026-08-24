'use strict';

/**
 * TCIM A01 语义预筛模块测试（Step 1：LLM 只做 Proposal，裁决权仍在确定性 EvidenceUpdater）。
 *
 * 验收（责任表 A01 + Step 1 边界）：
 *   - 离线默认：analyze() 返回空 Proposal，语义层不产生任何信号（行为与未接入等价）。
 *   - Schema 门（G03）：provider 输出越界（span 不在原话、能力/人格判定词）→ 降级空 Proposal。
 *   - 语义信号透传：合法的 candidate_spans / conflict_candidates 出现在 diagnostics，但
 *     不改变 evidence_state 的 level/confidence。
 *   - 红线（G04/G05）：即使 provider「幻觉」出高能力证据，低能力教师也不得因此升级。
 */

const assert = require('node:assert');
const path = require('node:path');
const { createCore } = require('../core/index.js');
const { loadGameSupportData } = require('../professional_data/game_support/loader.js');
const { setSemanticMode } = require('../modules/ontology/game_support_ontology.js');
const {
  analyze, setProvider, getProvider, offlineProvider, validateProposal
} = require('../modules/evidence_semantic/evidence_semantic.js');

const data = loadGameSupportData(path.join(__dirname, '..', 'professional_data', 'game_support'));

async function runOntologyTurn(core, input) {
  core.shared.ontology_state.evidence_state = {};
  const { results, errors } = await core.runModules(input, ['ontology_game_support']);
  assert.equal(errors.length, 0, `ontology 运行错误: ${JSON.stringify(errors)}`);
  return results[0];
}

function lowTeacherInput(qid, turn, turnNo) {
  const core = createCore();
  core.setOntologyData(data.items);
  return {
    input: {
      session_id: 'sem-test', turn_id: `t${turnNo}`, question_id: qid,
      turn_context: {
        teacher_turn: turn, teacher_ranking: ['A', 'C', 'B', 'D'],
        question_id: qid, item_package: data.items[qid], turn_no: turnNo, process_tags: []
      },
      module_config: {}
    },
    core
  };
}

async function main() {
  // ---- 测试1：离线默认 = 空 Proposal（无任何增益） ----
  {
    setProvider(null);
    const r = await analyze('我会先看地面湿不滑，再看别的孩子。', { itemId: 'Q1' });
    assert.equal(r.provider, 'offline');
    assert.equal(r.ok, true);
    assert.equal(r.proposal.candidate_spans.length, 0);
    assert.equal(r.proposal.conflict_candidates.length, 0);
    assert.equal(r.proposal.no_change_reasons.length, 0);
  }

  // ---- 测试2：Schema 门 —— span 不在教师原话 → 降级空 Proposal ----
  {
    setProvider(() => ({ candidate_spans: [{ text: '这根本不在这句话里', slot_id: 'Q1-S1' }] }));
    const r = await analyze('我会先看地面湿不滑。', { itemId: 'Q1' });
    assert.equal(r.ok, false, 'span 不在原话应被视为非法');
    assert.equal(r.proposal.candidate_spans.length, 0, '非法内容应降级为空 Proposal');
    setProvider(null);
  }

  // ---- 测试3：Schema 门 —— G05 能力/人格判定词 → 降级空 Proposal ----
  {
    setProvider(() => ({ candidate_spans: [{ text: '我看得出这是高能力教师', slot_id: 'Q1-S1' }] }));
    const r = await analyze('我看得出这是高能力教师', { itemId: 'Q1' });
    assert.equal(r.ok, false, 'G05 能力判定应被拦截');
    assert.equal(r.proposal.candidate_spans.length, 0);
    setProvider(null);
  }

  // ---- 测试4：合法语义信号透传，但不改 evidence_state 的 level ----
  // 需启用语义主路径（fallback_allowed）才能让 analyze() 透传到 diagnostics
  setSemanticMode('fallback_allowed');
  {
    const teacherTurn = '我会先看地面湿不滑，篮球架附近有没有别的孩子。';
    const { core, input } = lowTeacherInput('Q1', teacherTurn, 0);
    // 注入一个「合法」的语义 provider：给出 candidate_span（回指原话）+ slot_evidence_proposal，但 level 由确定性引擎裁决
    setProvider(() => ({
      candidate_spans: [{ text: '地面湿不滑', candidate_slots: ['Q1-S2'] }],
      slot_evidence_proposals: [{ slot_id: 'Q1-S2', proposed_level: 1, confidence: 0.6, supporting_spans: ['地面湿不滑'] }],
      no_change_reasons: [{ slot_id: 'Q1-S1', reason: '未提代际关系' }]
    }));
    const result = await runOntologyTurn(core, input);
    // 语义信号应出现在 diagnostics（semantic_ 前缀）
    const hasSemanticSpan = (result.diagnostics || []).some((d) => d.reason === 'semantic_span');
    const hasSlotProposal = (result.diagnostics || []).some((d) => d.reason === 'semantic_slot_proposal' && d.proposed_level === 1);
    assert.ok(hasSemanticSpan, '语义 span 应透传到 diagnostics');
    assert.ok(hasSlotProposal, 'slot_evidence_proposal 应透传到 diagnostics');
    // 但 evidence_state 的 level 仍由确定性引擎决定：这条回答过于笼统，Q1-S2 不应被抬到 2
    const ev = result.state_updates.ontology_state.evidence_state;
    // teacherTurn 只回了「地面湿不滑」+ 别的小孩，未到确定性 2 级所需的完整阈值 → 不因此升级
    assert.ok(ev['Q1-S2'].level <= 1, `语义信号不得把确定性 level 抬到高等级，实际 ${ev['Q1-S2'].level}`);
    setProvider(null);
  }

  // ---- 测试5：红线 —— 低能力教师即使被 provider「幻觉」谓高能力也不得升级 ----
  {
    const core = createCore();
    core.setOntologyData(data.items);
    core.shared.ontology_state.evidence_state = {};
    // 一个「幻觉」的 provider：无中生有给出 span + candidate_slot，想抬高等级
    setProvider(() => ({
      candidate_spans: [{ text: '教师注重自主生成和规则协商', candidate_slots: ['Q1-S1'] }],
      slot_evidence_proposals: [{ slot_id: 'Q1-S1', proposed_level: 2, confidence: 0.9, supporting_spans: [] }]
    }));
    let upgraded = false;
    for (let i = 0; i < 4; i += 1) {
      const lowAnswer = i === 0 ? '今天天气不错。' : (i === 1 ? '看情况吧。' : (i === 2 ? '直接叫他们回去。' : '也许吧。'));
      const { input, core: c2 } = lowTeacherInput('Q1', lowAnswer, i);
      c2.shared.ontology_state.evidence_state = core.shared.ontology_state.evidence_state;
      const { results, errors } = await c2.runModules(input, ['ontology_game_support']);
      assert.equal(errors.length, 0, `低能力教师运行错误: ${JSON.stringify(errors)}`);
      const ev = results[0].state_updates.ontology_state.evidence_state;
      for (const [sid, st] of Object.entries(ev)) {
        if (st.level >= 2) upgraded = true;
      }
      core.shared.ontology_state.evidence_state = ev;
      setProvider(() => ({
        candidate_spans: [{ text: '教师注重自主生成', candidate_slots: ['Q1-S1'] }],
        slot_evidence_proposals: [{ slot_id: 'Q1-S1', proposed_level: 2, confidence: 0.9, supporting_spans: [] }]
      }));
    }
    assert.equal(upgraded, false, '低能力教师即使有语义幻觉也不得被升级到高等级');
    setProvider(null);
  }

  setSemanticMode('disabled');
  console.log('TCIM A01 evidence-semantic tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
