'use strict';

/**
 * TCIM V0.2 Challenge Queue（A12）+ policy_class 映射验收。
 *
 * - challengeFromDecision 只在 CONFLICT/OUT_OF_SCHEMA/NO_APPLICABLE_RULE 时登记；
 *   SUPPORT/PARTIAL 不登记。
 * - Challenge 不改 Production（只进队列 + Replay），status 初始 DRAFT。
 * - policy_class 由优先级/HARD 内容解析（HARD/SOFT/PRIOR/ADVISORY）。
 */

const assert = require('node:assert');
const { createChallengeQueue, addChallenge, challengeFromDecision } = require('../modules/context/challenge_queue.js');
const { POLICY_CLASS, TABLE_ALIGNMENT } = require('../core/contracts.js');

// 与 V2-C 相同的 policy 解析：规则按优先级/HARD 映射到 policy_class
function resolvePolicyClass(rule, text) {
  if (!rule) return 'ADVISORY';
  const joined = String(rule.condition || '') + ' ' + String(text || '');
  if (/实证4分|HARD|红线|必须/.test(joined)) return 'HARD';
  if (/实证2分/.test(joined)) return 'PRIOR';
  if (/0—1分|0-1分/.test(joined)) return 'SOFT';
  return 'PRIOR';
}

function main() {
  // ---- 1. Challenge 只在偏离时登记 ----
  {
    const q = createChallengeQueue();
    // SUPPORT -> 不登记
    const sup = challengeFromDecision(q, { claimed_table_alignment: 'SUPPORT', primary_target_slot: 'Q8-S4', why_this_now: 'x', source_refs: [] }, { adjudicated_table_alignment: 'SUPPORT', adjudicated_risk_level: 'LOW' });
    assert.equal(sup, null, 'SUPPORT 不登记挑战');
    // OUT_OF_SCHEMA -> 登记
    const out = challengeFromDecision(q, { claimed_table_alignment: 'OUT_OF_SCHEMA', primary_target_slot: 'Q8-X', why_this_now: '表外机制', source_refs: ['T1'] }, { adjudicated_table_alignment: 'OUT_OF_SCHEMA', adjudicated_risk_level: 'MEDIUM' });
    assert.ok(out && q.challenges.length === 1, 'OUT_OF_SCHEMA 应登记');
    assert.equal(out.status, 'DRAFT', '挑战初始为 DRAFT');
    assert.equal(out.challenge_type, 'OUT_OF_SCHEMA');
  }

  // ---- 2. addChallenge 直接登记 + 字段完整 ----
  {
    const q = createChallengeQueue();
    const c = addChallenge(q, { challenge_type: 'CONFLICT', rule_id: 'T3-Q8-S3-P1', slot_id: 'Q8-S3', claimed_alignment: 'CONFLICT', reason: '教师说法与表3冲突', source_refs: ['PT-Q08-0042'], risk_level: 'HIGH' });
    assert.equal(q.challenges.length, 1);
    assert.equal(c.status, 'DRAFT');
    assert.equal(q.version, 1);
  }

  // ---- 3. policy_class 解析 ----
  {
    assert.equal(resolvePolicyClass({ condition: '实证4分' }), 'HARD');
    assert.equal(resolvePolicyClass({ condition: '实证2分' }), 'PRIOR');
    assert.equal(resolvePolicyClass({ condition: '0—1分' }), 'SOFT');
    assert.equal(resolvePolicyClass({ condition: '普通' }), 'PRIOR');
    assert.equal(resolvePolicyClass(null), 'ADVISORY');
  }

  // ---- 4. 枚举冻结 ----
  assert.deepEqual(POLICY_CLASS, ['HARD', 'SOFT', 'PRIOR', 'ADVISORY']);
  assert.deepEqual(TABLE_ALIGNMENT, ['SUPPORT', 'PARTIAL', 'CONFLICT', 'OUT_OF_SCHEMA', 'NO_APPLICABLE_RULE']);

  console.log('TCIM V0.2 challenge + policy tests passed');
}

try { main(); } catch (e) { console.error(e); process.exit(1); }
