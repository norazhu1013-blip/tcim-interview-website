'use strict';

const assert = require('assert');
const Module = require('module');

process.env.NODE_ENV = 'test';
process.env.MOONSHOT_API_KEY = 'test-key-never-sent';
process.env.KIMI_MODEL = 'kimi-k3';
process.env.KIMI_REASONING_EFFORT = 'high';
process.env.KIMI_MAX_COMPLETION_TOKENS = '4000';

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'wx-server-sdk') return { DYNAMIC_CURRENT_ENV: 'test', init() {} };
  return originalLoad.call(this, request, parent, isMain);
};

let requestUrl = '';
let requestHeaders = null;
let requestPayload = null;
const modelText = JSON.stringify({
  understanding: { teacher_quote: '', meaning: '首问前尚无教师回答', confidence: 'HIGH' },
  state: {
    active_thread: '教师对儿童表达的第一理解',
    latest_new_point: 'NONE',
    next_move: 'OPEN',
    purpose: '了解教师最先注意到的教育信息',
    completion: 'BEFORE_MINIMUM'
  },
  next_question: '阳阳说“着火了，好开心”，您听到后的第一感受是什么？',
  done: false,
  closing_message: '',
  covered_evidence: []
});

global.fetch = async function mockFetch(url, options) {
  requestUrl = url;
  requestHeaders = options.headers;
  requestPayload = JSON.parse(options.body);
  return {
    ok: true,
    status: 200,
    async json() {
      return { choices: [{ message: { role: 'assistant', reasoning_content: 'internal', content: modelText } }] };
    }
  };
};

const interview = require('../cloudfunctions/gsyg_interviewChat/index.js');
Module._load = originalLoad;

(async () => {
  const result = await interview.main({
    llmProfile: 'kimi-k3',
    itemContext: { title: '娃娃家着火了', stem: '阳阳说娃娃家着火了，好开心。' },
    teacherRanking: ['D', 'B', 'A', 'C'],
    history: [],
    remainingMs: 600000
  });

  assert.strictEqual(requestUrl, 'https://api.moonshot.ai/v1/chat/completions');
  assert.strictEqual(requestHeaders.Authorization, 'Bearer test-key-never-sent');
  assert.strictEqual(requestPayload.model, 'kimi-k3');
  assert.strictEqual(requestPayload.reasoning_effort, 'high');
  assert.strictEqual(requestPayload.max_completion_tokens, 4000);
  assert.strictEqual('temperature' in requestPayload, false);
  assert.strictEqual('max_tokens' in requestPayload, false);
  assert.strictEqual(requestPayload.response_format.type, 'json_schema');
  assert.strictEqual(requestPayload.response_format.json_schema.strict, true);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.llmProfile, 'kimi-k3');
  assert.strictEqual(result.llmModel, 'kimi-k3');
  assert.strictEqual(result.question, '阳阳说“着火了，好开心”，您听到后的第一感受是什么？');

  console.log('PASS  Kimi K3 官方地址、模型名与服务端密钥变量正确');
  console.log('PASS  K3 固定采样参数未发送，high reasoning 与严格 JSON Schema 正确');
  console.log('PASS  K3 reasoning_content 不会混入教师可见访谈问题');
})().catch((error) => {
  console.error('FAIL ', error && error.stack || error);
  process.exit(1);
});
