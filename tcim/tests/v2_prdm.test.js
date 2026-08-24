'use strict';

/**
 * TCIM V0.2 PRDM（03-1/03-2）：A06 observe + A07 plan 验收。
 *
 * - A06 observe：只出可观察互动信号（InteractionSignalSnapshot），不含 forbidden 字段
 *   （next_target_slot / recommended_action_type / stop_decision / personality/ability/psychological 标签）。
 * - A07 plan：绑定 action fingerprint；无有效 fingerprint → 返回 null（门禁，不产出可发送文本）；
 *   有 fingerprint → 只输出互动参数（不改 target/objective/probe），不含完整句子。
 * - PRDM 不写 Evidence/Belief/Action；不生成教师文本。
 */

const assert = require('node:assert');
const { observe, plan, FORBIDDEN_OBS, VERSION } = require('../modules/prdm/prdm_v2.js');

function main() {
  // ---- 1. A06 observe：纯可观察，无 forbidden 字段 ----
  {
    const obs = observe({ teacherTurn: '我会先看地面湿不滑，再看看别的孩子。', recentTurns: [], evidenceUpdates: [], turnId: 't1', observedActionFingerprint: 'fp-x' });
    for (const f of FORBIDDEN_OBS) {
      assert.ok(obs[f] === undefined || obs[f] === null, `A06 不应含 forbidden 字段 ${f}`);
    }
    assert.ok(typeof obs.repair === 'boolean');
    assert.ok(typeof obs.response_depth === 'number');
    assert.ok(obs.local_progress && ['ADVANCING', 'SLOW', 'STUCK', 'COMPLETE_LOCAL'].includes(obs.local_progress.status));
    assert.equal(obs.mode, 'observe');
  }

  // ---- 2. A07 plan：无有效 fingerprint → null（门禁） ----
  {
    const p = plan({ protectedAction: { target_slot: 'Q8-S4' }, actionFingerprint: '', teacherTurn: 'x', recentTurns: [], evidenceUpdates: [] });
    assert.equal(p, null, '无 fingerprint 应返回 null（门禁，不产出可发送文本）');
  }

  // ---- 3. A07 plan：有 fingerprint → 互动参数，不改 target/objective，不含句子 ----
  {
    const p = plan({ protectedAction: { target_slot: 'Q8-S4', professional_objective: '了解变量比较', probe_strategy: 'EVALUATE' }, actionFingerprint: 'fp-abc', teacherTurn: '我一般的做法是先确定哪个变量。', recentTurns: [], evidenceUpdates: [{ reason: 'anchor_level_2' }] });
    assert.ok(p, '有 fingerprint 应产出 DialoguePlan');
    assert.equal(p.protected_action_fingerprint, 'fp-abc', '应绑定 fingerprint');
    assert.equal(p.target_slot, 'Q8-S4', 'target_slot 只读引用不改');
    assert.equal(p.professional_objective, '了解变量比较', 'objective 不改变');
    assert.equal(p.probe_strategy, 'EVALUATE', 'probe_strategy 不改变');
    // 不含完整句子：无 question/text 字段
    assert.ok(!p.question && !p.text && !p.utterance, 'PRDM 不生成教师文本');
    assert.ok(typeof p.dialogue_move === 'string');
    assert.equal(p.max_questions, 1, '单问');
  }

  // ---- 4. PRDM 不写 Evidence/Belief/Action：plan 输出无这些字段 ----
  {
    const p = plan({ protectedAction: { target_slot: 'Q8-S3' }, actionFingerprint: 'fp-1', teacherTurn: 'x', recentTurns: [], evidenceUpdates: [] });
    assert.ok(!('evidence_update' in p) && !('belief_mutation' in p) && !('action_commit' in p), 'PRDM 不得写证据/信念/行动');
  }

  // ---- 5. VERSION 冻结 ----
  assert.equal(VERSION, '2026-08-24-prdm-v0.2');

  console.log('TCIM V0.2 prdm (A06/A07) tests passed');
}

try { main(); } catch (e) { console.error(e); process.exit(1); }
