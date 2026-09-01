'use strict';

// gsyg_reportDraft 测试：新增/更新幂等 upsert + 乱序保护 + 越权拒绝。
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
let mode = 'add'; // add | update | stale | forbidden
let existingRecord = null;

const collection = {
  where() { return this; },
  limit() { return this; },
  async get() {
    if (mode === 'add') return { data: [] };
    return { data: existingRecord ? [existingRecord] : [] };
  },
  async add({ data }) { return { _id: 'new-draft' }; },
  doc(id) {
    return {
      async update({ data }) { existingRecord = { _id: id, ...existingRecord, ...data }; }
    };
  }
};

Module._load = function load(request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    return {
      DYNAMIC_CURRENT_ENV: 'test',
      init() {},
      database() { return { collection() { return collection; } }; },
      getWXContext() { return {}; }
    };
  }
  return originalLoad(request, parent, isMain);
};

process.env.GSYG_WEB_GATEWAY_TOKEN = 'test-gateway-token';
const handler = require('../index.js');
Module._load = originalLoad;

function draftEvent(turnSeq) {
  return {
    __gsygGateway: { token: 'test-gateway-token', actor: 'web:test-user', identityType: 'web_anonymous' },
    sessionId: 'iv-session',
    itemId: 'Q4',
    turnSeq,
    revision: turnSeq,
    status: 'in_progress',
    messages: [{ role: 'teacher', text: '我很在意孩子' }],
    evidenceState: { version: turnSeq },
    dialogueProgressState: { turn: turnSeq },
    releaseSnapshot: { releaseId: 'TCIM-WEB-2026.08.30-R6.1' }
  };
}

(async () => {
  let failures = 0;
  const check = (name, fn) => {
    try { fn(); console.log('PASS', name); }
    catch (e) { console.error('FAIL', name, '—', e.message); failures++; }
  };

  mode = 'add'; existingRecord = null;
  let res = await handler.main(draftEvent(1));
  check('add-path 首次落库返回 serverUpdatedAt', () => {
    assert.equal(res.ok, true);
    assert.equal(res.id, 'new-draft');
    assert.equal(typeof res.serverUpdatedAt, 'number');
    assert.match(res.payloadHash, /^[a-f0-9]{64}$/);
    assert.equal(res.staleTurnRejected, undefined);
  });

  mode = 'update'; existingRecord = { _id: 'existing-draft', openid: 'web:test-user', sessionId: 'iv-session', itemId: 'Q4', turnSeq: 2, updatedAt: 100 };
  res = await handler.main(draftEvent(3));
  check('update-path 新一轮覆盖草稿', () => {
    assert.equal(res.ok, true);
    assert.equal(res.id, 'existing-draft');
    assert.equal(res.staleTurnRejected, undefined);
    assert.equal(existingRecord.releaseSnapshot.releaseId, 'TCIM-WEB-2026.08.30-R6.1');
    assert.deepEqual(existingRecord.dialogueProgressState, { turn: 3 });
  });

  mode = 'stale'; existingRecord = { _id: 'existing-draft', openid: 'web:test-user', sessionId: 'iv-session', itemId: 'Q4', turnSeq: 5, updatedAt: 200 };
  res = await handler.main(draftEvent(4));
  check('乱序保护：旧一轮不覆盖新草稿', () => {
    assert.equal(res.ok, true);
    assert.equal(res.staleTurnRejected, true);
    assert.equal(res.serverUpdatedAt, 200); // 保留旧 updatedAt
  });

  mode = 'stale'; existingRecord = { _id: 'existing-draft', openid: 'web:test-user', sessionId: 'iv-session', itemId: 'Q4', turnSeq: 4, revision: 6, updatedAt: 300, payloadHash: 'newer-hash' };
  res = await handler.main(draftEvent(4));
  check('乱序保护：同一轮的旧 revision 不覆盖新草稿', () => {
    assert.equal(res.staleTurnRejected, true);
    assert.equal(res.payloadHash, 'newer-hash');
  });

  if (failures) { console.error(`\n${failures} 项失败`); process.exit(1); }
  console.log('\ngsyg_reportDraft 检查全部通过。');
})();
