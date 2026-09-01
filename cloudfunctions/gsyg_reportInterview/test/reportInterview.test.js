'use strict';

// gsyg_reportInterview 测试：幂等 upsert + 乱序保护（旧 revision 拒绝覆盖）+ 越权拒绝。
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
let addCount = 0;
let stored = []; // 有状态 mock：add 会入库,后续 get 能查到 → 走 update 路径(幂等)

const collection = {
  where() { return this; },
  limit() { return this; },
  async get() { return { data: stored }; }, // 测试只用单一 sessionId,简化不按 where 过滤
  async add({ data }) { addCount++; const rec = { _id: 'interview-' + addCount, ...data }; stored.push(rec); return { _id: rec._id }; },
  doc(id) {
    return {
      async update({ data }) { const i = stored.findIndex((r) => r._id === id); if (i >= 0) stored[i] = { ...stored[i], ...data }; }
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

function reportEvent(revision, feedback) {
  return {
    __gsygGateway: { token: 'test-gateway-token', actor: 'web:test-user', identityType: 'web_anonymous' },
    sessionId: 'iv-session',
    studyMode: 'full_assessment',
    transcripts: { Q1: { status: 'done', messages: [{ role: 'teacher', text: '我在意孩子' }] } },
    feedback: feedback || null,
    releaseSnapshot: { releaseId: 'TCIM-WEB-2026.08.30-R6.1' },
    revision
  };
}

(async () => {
  let failures = 0;
  const check = (name, fn) => {
    try { fn(); console.log('PASS', name); }
    catch (e) { console.error('FAIL', name, '—', e.message); failures++; }
  };

  stored = []; addCount = 0;
  let res = await handler.main(reportEvent(1));
  check('add-path 首报落库并返回完整回执', () => {
    assert.equal(res.ok, true);
    assert.equal(res.serverRecordId, 'interview-1');
    assert.equal(typeof res.serverUpdatedAt, 'number');
    assert.ok(res.payloadHash && res.payloadHash.length === 64);
    assert.equal(res.staleRejected, undefined);
  });

  stored = [{ _id: 'iv-1', openid: 'web:test-user', sessionId: 'iv-session', reportRevision: 1, updatedAt: 100, payloadHash: 'oldhash' }];
  res = await handler.main(reportEvent(3));
  check('update-path 更高 revision 覆盖草稿/记录', () => {
    assert.equal(res.ok, true);
    assert.equal(res.serverRecordId, 'iv-1');
    assert.equal(stored[0].reportRevision, 3);
    assert.equal(stored[0].releaseSnapshot.releaseId, 'TCIM-WEB-2026.08.30-R6.1');
    assert.equal(stored[0].payloadHash, res.payloadHash);
    assert.equal(res.staleRejected, undefined);
  });

  stored = [{ _id: 'iv-1', openid: 'web:test-user', sessionId: 'iv-session', reportRevision: 5, updatedAt: 200, payloadHash: 'newhash' }];
  res = await handler.main(reportEvent(2));
  check('乱序保护：旧 revision 晚到,拒绝覆盖并返回现有回执', () => {
    assert.equal(res.ok, true);
    assert.equal(res.staleRejected, true);
    assert.equal(stored[0].reportRevision, 5); // 未被降级
    assert.equal(res.payloadHash, 'newhash');  // 返回既有回执哈希
  });

  stored = [{ _id: 'iv-x', openid: 'web:someone-else', sessionId: 'iv-session' }];
  res = await handler.main(reportEvent(6));
  check('越权：openid 不同 → forbidden', () => {
    assert.equal(res.ok, false);
    assert.equal(res.error, 'forbidden');
  });

  stored = []; addCount = 0;
  await handler.main(reportEvent(1));
  await handler.main(reportEvent(1));
  check('幂等：重复上报按 sessionId upsert,不重复建档', () => {
    assert.equal(addCount, 1);
  });

  if (failures) { console.error(`\n${failures} 项失败`); process.exit(1); }
  console.log('\ngsyg_reportInterview 检查全部通过。');
})();
