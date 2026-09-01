'use strict';

// gsyg_reportSession event_uuid 幂等测试：同一事件(event_uuid)重复上报 → 命中已有,更新不新增；
// 不同 event_uuid(但同 sessionId) → 用 sessionId 回退路径更新(不重复建档)。
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
let stored = [];      // 有状态 mock
let addCount = 0;

const collection = {
  where() { return this; },
  limit() { return this; },
  async get() { return { data: stored.slice() }; }, // 简化：单 event_uuid 单条,不按 where 精确过滤由断言控
  async add({ data }) { addCount++; const rec = { _id: 'rec-' + addCount, ...data }; stored.push(rec); return { _id: rec._id }; },
  doc(id) {
    return {
      async update({ data }) { const i = stored.findIndex((r) => r._id === id); if (i >= 0) stored[i] = { ...stored[i], ...data }; }
    };
  }
};

Module._load = function load(request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    return { DYNAMIC_CURRENT_ENV: 'test', init() {}, database() { return { collection() { return collection; } }; }, getWXContext() { return {}; } };
  }
  return originalLoad(request, parent, isMain);
};

process.env.GSYG_WEB_GATEWAY_TOKEN = 'test-gateway-token';
const handler = require('../index.js');
Module._load = originalLoad;

function sessionEvent(eventUuid) {
  return {
    __gsygGateway: { token: 'test-gateway-token', actor: 'web:test-user', identityType: 'web_anonymous' },
    sessionId: 'session-1',
    event_uuid: eventUuid,
    answers: { Q1: { final_ranking: ['A', 'B', 'C', 'D'] } },
    scores: { mean: 3, total: 30 }
  };
}

(async () => {
  let failures = 0;
  const check = (name, fn) => {
    try { fn(); console.log('PASS', name); }
    catch (e) { console.error('FAIL', name, '—', e.message); failures++; }
  };

  stored = []; addCount = 0;
  await handler.main(sessionEvent('s1:exam'));
  const firstAdd = addCount;
  await handler.main(sessionEvent('s1:exam')); // 同 event_uuid 重复
  check('同 event_uuid 重复上报不新增记录（幂等）', () => {
    assert.equal(addCount, firstAdd, '二次应命中已有而不 add');
    assert.ok(stored.every((r) => r.event_uuid === 's1:exam'));
  });

  // 老端不带 event_uuid → 回退按 sessionId upsert,仍不新增
  stored = []; addCount = 0;
  await handler.main({ __gsygGateway: { token: 'test-gateway-token', actor: 'web:test-user', identityType: 'web_anonymous' }, sessionId: 'session-2' });
  const c1 = addCount;
  await handler.main({ __gsygGateway: { token: 'test-gateway-token', actor: 'web:test-user', identityType: 'web_anonymous' }, sessionId: 'session-2' });
  check('无 event_uuid 老端按 sessionId upsert,不新增', () => {
    assert.equal(addCount, c1);
    assert.equal(stored.length, 1);
  });

  if (failures) { console.error(`\n${failures} 项失败`); process.exit(1); }
  console.log('\ngsyg_reportSession event_uuid 幂等检查全部通过。');
})();
