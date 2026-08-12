'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
let inserted = null;

const collection = {
  where() { return this; },
  limit() { return this; },
  async get() { return { data: [] }; },
  async add({ data }) {
    inserted = data;
    return { _id: 'created-session' };
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

(async () => {
  const result = await handler.main({
    __gsygGateway: {
      token: 'test-gateway-token',
      actor: 'web:test-user',
      identityType: 'web_anonymous'
    },
    sessionId: 'single-trial-session',
    studyMode: 'single_trial',
    targetItemId: 'Q4',
    answers: {
      Q4: {
        first_ranking: ['A', 'B', 'C', 'D'],
        final_ranking: ['B', 'A', 'C', 'D']
      }
    },
    scores: { total: 1 },
    total: 1,
    submitStatus: 'submitted',
    items: [{ itemId: 'Q4', durationMs: 1000 }]
  });

  assert.deepEqual(result, { ok: true, id: 'created-session' });
  assert.equal(inserted.openid, 'web:test-user');
  assert.equal(inserted.studyMode, 'single_trial');
  assert.equal(inserted.targetItemId, 'Q4');
  assert.deepEqual(inserted.answers.Q4.final_ranking, ['B', 'A', 'C', 'D']);
  console.log('single-trial reportSession test passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
