'use strict';

// gsyg_reportInterview 回执测试：确认服务端在 add/update 之后确实返回
// serverRecordId / serverUpdatedAt / payloadHash，供前端校验"云端已保存"。
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
let mode = 'add'; // add | update
let existingRecord = null;

const collection = {
  where() { return this; },
  limit() { return this; },
  async get() {
    if (mode === 'add') return { data: [] };
    return { data: existingRecord ? [existingRecord] : [] };
  },
  async add({ data }) { return { _id: 'created-interview' }; },
  doc(id) {
    return {
      async update({ data }) { existingRecord = { _id: id, ...data }; }
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

function baseEvent() {
  return {
    __gsygGateway: { token: 'test-gateway-token', actor: 'web:test-user', identityType: 'web_anonymous' },
    sessionId: 'iv-session',
    studyMode: 'full_assessment',
    transcripts: { Q4: { status: 'done', messages: [{ role: 'ai', text: 'hi' }] } },
    feedback: { q1: '整体感受很好' }
  };
}

(async () => {
  let failures = 0;
  const check = (name, fn) => {
    try { fn(); console.log('PASS', name); }
    catch (e) { console.error('FAIL', name, '—', e.message); failures++; }
  };

  mode = 'add'; existingRecord = null;
  let res = await handler.main(baseEvent());
  check('add-path 返回完整回执', () => {
    assert.equal(res.ok, true);
    assert.equal(res.id, 'created-interview');
    assert.equal(res.serverRecordId, 'created-interview');
    assert.equal(typeof res.serverUpdatedAt, 'number');
    assert.match(res.payloadHash, /^[a-f0-9]{64}$/);
  });

  mode = 'update'; existingRecord = { _id: 'existing-iv', openid: 'web:test-user' };
  res = await handler.main(baseEvent());
  check('update-path 返回完整回执并沿用该记录 id', () => {
    assert.equal(res.ok, true);
    assert.equal(res.serverRecordId, 'existing-iv');
    assert.match(res.payloadHash, /^[a-f0-9]{64}$/);
  });

  mode = 'update'; existingRecord = { _id: 'other-iv', openid: 'web:someone-else' };
  res = await handler.main(baseEvent());
  check('openid 不匹配时拒绝覆盖', () => {
    assert.equal(res.ok, false);
    assert.equal(res.error, 'forbidden');
  });

  if (failures) { console.error(`\n${failures} 项失败`); process.exit(1); }
  console.log('\ngsyg_reportInterview 回执检查全部通过。');
})();
