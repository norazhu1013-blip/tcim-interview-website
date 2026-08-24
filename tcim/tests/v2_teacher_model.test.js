'use strict';

/**
 * TCIM V0.2 Teacher Model（A00）验收。
 * - 快照是派生只读：只引用当前 ACTIVE Belief，不保存第二套假设。
 * - RETRACTED / DIVERGED Belief 不进入 active，DIVERGED 进 competing。
 * - A00 ContextInterpretationProposal 生成可撤销 belief 候选 + uncertainty，
 *   不直接给能力/人格结论（无 G05 判定词）。
 */

const assert = require('node:assert');
const { createBeliefState, applyBeliefMutation } = require('../modules/context/belief_state.js');
const { buildTeacherModelSnapshot, buildContextInterpretationProposal } = require('../modules/context/teacher_model.js');

function main() {
  // ---- 1. 快照引用 ACTIVE belief，不复制假设 ----
  {
    const bs = createBeliefState();
    let { state, event } = applyBeliefMutation(bs, { op: 'ADD', claim: '教师判断儿童可达水平依据尚不清楚', confidence: 0.61, uncertainty: 0.6 }, 't1');
    const activeId = event.belief_id;
    ({ state } = applyBeliefMutation(state, { op: 'ADD', claim: '变量隔离可能不稳定', confidence: 0.68 }, 't1'));
    const secondId = Object.keys(state.beliefs).find((id) => id !== activeId);
    // 撤掉第二个
    ({ state } = applyBeliefMutation(state, { op: 'RETRACT', belief_id: secondId }, 't2'));

    const snap = buildTeacherModelSnapshot({ factRefs: ['AR-Q08-0008', 'PT-Q08-0041'], beliefState: state, evidenceStateRef: 'EVIDENCE-Q08-v0', turnId: 't2' });
    assert.ok(Array.isArray(snap.active_belief_refs) && snap.active_belief_refs.length === 1, '仅 ACTIVE belief 进 active');
    assert.equal(snap.active_belief_refs[0], activeId);
    assert.ok(snap.confirmed_fact_refs.includes('AR-Q08-0008'), 'fact refs 应保留');
    assert.equal(snap.builder_version, '2026-08-24-teacher-model-v1');
  }

  // ---- 2. RETRACTED 不进 active；DIVERGED 进 competing ----
  {
    const bs = createBeliefState();
    let { state, event } = applyBeliefMutation(bs, { op: 'ADD', claim: 'H', confidence: 0.5 }, 't1');
    const id = event.belief_id;
    ({ state } = applyBeliefMutation(state, { op: 'SPLIT', belief_id: id, new_claim: 'H-alt', new_confidence: 0.4 }, 't2'));
    const oldId = id;
    const snap = buildTeacherModelSnapshot({ beliefState: state });
    assert.ok(!snap.active_belief_refs.includes(oldId), 'DIVERGED 不应在 active');
    assert.ok(snap.competing_belief_refs.includes(oldId), 'DIVERGED 应进 competing');
  }

  // ---- 3. A00 ContextInterpretationProposal：可撤销 belief 候选 + uncertainty，无能力判定 ----
  {
    const prop = buildContextInterpretationProposal({
      factRefs: ['AR-Q08-0008', 'PT-Q08-0041'],
      assessmentSnapshot: { open_text: '先让幼儿继续尝试，必要时再提醒观察变化' },
      processTags: ['多次同时调整两个变量'],
      questionTitle: '引水难题'
    });
    assert.equal(prop.proposal_type, 'ContextInterpretationProposal');
    assert.ok(prop.proposed_beliefs.length >= 1, '应有 belief 候选');
    assert.ok(prop.uncertainty_candidates.length >= 1, '应有 uncertainty');
    assert.ok(!/能力|人格|动机|心理/.test(JSON.stringify(prop)), 'A00 不得含能力/人格判定');
    assert.ok(prop.fact_refs.includes('AR-Q08-0008'), '应引用 fact');
  }

  // ---- 4. evidence_state_ref 只是引用，不含第二套假设 ----
  {
    const snap = buildTeacherModelSnapshot({ beliefState: { beliefs: {} }, evidenceStateRef: 'EVIDENCE-Q08-v0' });
    assert.equal(snap.active_belief_refs.length, 0, '无 belief 时 active 为空');
    assert.equal(snap.evidence_state_ref, 'EVIDENCE-Q08-v0');
  }

  console.log('TCIM V0.2 teacher_model tests passed');
}

try { main(); } catch (e) { console.error(e); process.exit(1); }
