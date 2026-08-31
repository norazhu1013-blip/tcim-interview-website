// tcimSemantic.js 测试：A01 语义 provider（mock wx.cloud 回调式调用）
'use strict';
const assert = require('node:assert/strict');
const { makeSemanticProvider } = require('./tcimSemantic.js');

let mode = 'ok'; // ok | empty | fail | g05
function installWx() {
  global.wx = {
    cloud: {
      callFunction: (opts) => {
        if (mode === 'fail') { opts.fail && opts.fail({ errMsg: 'network' }); return; }
        if (mode === 'empty') { opts.success({ result: { ok: true, proposal: null } }); return; }
        // ok / g05 均返回合法 proposal
        const spans = mode === 'g05'
          ? [{ text: '我会先检查', candidate_slots: ['Q1-S2'] }, { text: '这个孩子能力比较强', candidate_slots: ['Q1-S1'] }]
          : [{ text: '我会先检查', candidate_slots: ['Q1-S2'] }];
        opts.success({ result: {
          ok: true,
          proposal: {
            candidate_spans: spans,
            slot_evidence_proposals: [{ slot_id: 'Q1-S2', proposed_level: 2, confidence: 0.8, supporting_spans: ['我会先检查'] }],
            conflict_candidates: [], false_evidence_flags: [], no_change_reasons: [], uncertainty: []
          }
        } });
      }
    }
  };
}

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { console.error('FAIL', name, '—', e.message); failures++; }
}

(async () => {
  installWx();
  const provider = makeSemanticProvider();
  const turn = '我会先检查地面，这个孩子能力比较强。'; // 两个 span 都回指原话

  mode = 'ok';
  let p = await provider(turn, { itemId: 'Q1', turnId: 't2', anchorBySlot: { 'Q1-S2': { slot_id: 'Q1-S2' } }, evidenceSummary: {} });
  check('成功：保留回指 span + slot 证据', () => {
    assert.ok(p.candidate_spans.some((s) => s.text === '我会先检查'));
    assert.equal(Array.isArray(p.slot_evidence_proposals) && p.slot_evidence_proposals[0].slot_id, 'Q1-S2');
    assert.equal(p.provider_version, 'semantic-v0.2');
  });

  mode = 'g05';
  p = await provider(turn, {});
  check('G05：剔除能力判定词 span', () => {
    assert.ok(!p.candidate_spans.some((s) => /能力/.test(s.text)), '应剔除含"能力"的 span');
    assert.ok(p.candidate_spans.some((s) => s.text === '我会先检查'));
    assert.equal(p.g05_flag, true);
  });

  mode = 'empty';
  p = await provider(turn, {});
  check('空/无 proposal → 回退空 Proposal（不丢失回答）', () => {
    assert.deepEqual(p.candidate_spans, []);
    assert.equal(p.provider_version, 'offline-v0.2');
  });

  mode = 'fail';
  p = await provider(turn, {});
  check('网络失败 → 回退空 Proposal（不抛错）', () => {
    assert.deepEqual(p.candidate_spans, []);
  });

  delete global.wx;
  p = await provider(turn, {});
  check('无 wx.cloud → 回退空 Proposal', () => {
    assert.deepEqual(p.candidate_spans, []);
  });

  // 未注入 provider 时引擎走离线（analyzeSemantic 内部处理），此处仅验证 provider 契约
  if (failures) { console.error(`\n${failures} 项失败`); process.exit(1); }
  console.log('\ntcimSemantic 检查全部通过。');
})();
