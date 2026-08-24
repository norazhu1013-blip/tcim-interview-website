'use strict';

/**
 * TCIM V0.2 Belief State（A02B）验收。
 * 覆盖：create / validate（Schema 门 + G05）/ apply(ADD/STRENGTH/WEAKEN/RETRACT/SPLIT/NO_CHANGE) /
 * 不自动升级 Evidence（Belief 与 Evidence 是独立 namespace）。
 */

const assert = require('node:assert');
const {
  createBeliefState, validateBeliefMutation, applyBeliefMutation, BELIEF_OPS
} = require('../modules/context/belief_state.js');
const { createEmptyState } = require('../core/shared_state.js');
const { STATE_OWNERS } = require('../core/contracts.js');

function main() {
  // ---- 1. namespace 已注册且 owner = belief_manager ----
  assert.equal(STATE_OWNERS.contextual_belief_state, 'belief_manager', 'belief namespace owner 应为 belief_manager');
  const state = createEmptyState();
  assert.ok(state.contextual_belief_state && state.contextual_belief_state.beliefs, '空状态应含 contextual_belief_state');

  // ---- 2. ADD 合法 mutation ----
  {
    const bs = createBeliefState();
    const mut = { op: 'ADD', claim: '教师尚未说明判断儿童当前可达水平的依据', confidence: 0.61, source_refs: ['PT-Q08-0041'], alternatives: ['PROCESS_EVENT_MAY_BE_CONTEXT_SPECIFIC'] };
    const v = validateBeliefMutation(mut, bs);
    assert.equal(v.ok, true, 'ADD 应通过校验: ' + JSON.stringify(v.errors));
    const { state: next, event } = applyBeliefMutation(bs, mut, 't1');
    assert.equal(Object.keys(next.beliefs).length, 1, 'ADD 后应有 1 个 belief');
    assert.equal(event.belief_id && next.beliefs[event.belief_id].claim, mut.claim);
    assert.equal(next.version, 1);
  }

  // ---- 3. STRENGTH / WEAKEN / RETRACT ----
  {
    const bs = createBeliefState();
    let { state: s, event } = applyBeliefMutation(bs, { op: 'ADD', claim: 'H1', confidence: 0.5 }, 't1');
    const id = event.belief_id;
    ({ state: s } = applyBeliefMutation(s, { op: 'STRENGTHEN', belief_id: id, delta: 0.2 }, 't2'));
    assert.ok(s.beliefs[id].confidence > 0.5, 'STRENGTH 应提高置信');
    ({ state: s } = applyBeliefMutation(s, { op: 'WEAKEN', belief_id: id, delta: 0.1 }, 't3'));
    assert.ok(s.beliefs[id].confidence < 0.7, 'WEAKEN 应降低置信');
    ({ state: s } = applyBeliefMutation(s, { op: 'RETRACT', belief_id: id }, 't4'));
    assert.equal(s.beliefs[id].status, 'RETRACTED');
  }

  // ---- 4. SPLIT 产生竞争 belief ----
  {
    const bs = createBeliefState();
    let { state: s, event } = applyBeliefMutation(bs, { op: 'ADD', claim: 'H', confidence: 0.6 }, 't1');
    const id = event.belief_id;
    ({ state: s, event } = applyBeliefMutation(s, { op: 'SPLIT', belief_id: id, new_claim: 'H-alt', new_confidence: 0.4 }, 't2'));
    assert.equal(s.beliefs[id].status, 'DIVERGED', '原 belief 应 DIVERGED');
    assert.ok(Object.keys(s.beliefs).length === 2, 'SPLIT 应产生第二个 belief');
    assert.equal(event.claim, 'H-alt');
  }

  // ---- 5. 非法 op / 越界 confidence / G05 ----
  {
    const bs = createBeliefState();
    assert.equal(validateBeliefMutation({ op: 'GO_WILD', claim: 'x' }, bs).ok, false, '非法 op 应拒');
    assert.equal(validateBeliefMutation({ op: 'ADD', claim: 'x', confidence: 5 }, bs).ok, false, 'confidence 越界应拒');
    assert.equal(validateBeliefMutation({ op: 'ADD', claim: '教师是低能力', confidence: 0.5 }, bs).ok, false, 'G05 能力判定应拒');
    assert.equal(validateBeliefMutation({ op: 'RETRACT', belief_id: 'NOPE' }, bs).ok, false, 'RETRACT 不存在的 belief 应拒');
  }

  // ---- 6. NO_CHANGE ----
  {
    const bs = createBeliefState();
    const { state: s } = applyBeliefMutation(bs, { op: 'NO_CHANGE' }, 't1');
    assert.equal(Object.keys(s.beliefs).length, 0);
    assert.equal(s.version, 1);
  }

  // ---- 7. BELIEF_OPS 枚举冻结 ----
  assert.deepEqual(BELIEF_OPS, ['NO_CHANGE', 'ADD', 'STRENGTHEN', 'WEAKEN', 'SPLIT', 'RETRACT']);

  console.log('TCIM V0.2 belief_state tests passed');
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
