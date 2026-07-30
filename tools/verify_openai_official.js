'use strict';

const assert = require('assert');
const Module = require('module');

process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = 'test-key-never-sent';
process.env.OPENAI_MODEL = 'gpt-5.6-sol';
process.env.OPENAI_REASONING_EFFORT = 'high';

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    return { DYNAMIC_CURRENT_ENV: 'test', init() {} };
  }
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
  next_question: '阳阳说“着火了，好开心”，您听到后最先注意到什么？',
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
      return {
        id: 'resp_test',
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: modelText }]
        }]
      };
    }
  };
};

const interview = require('../cloudfunctions/gsyg_interviewChat/index.js');
Module._load = originalLoad;

(async () => {
  const result = await interview.main({
    llmProfile: 'openai-official',
    itemContext: { title: '娃娃家着火了', stem: '阳阳说娃娃家着火了，好开心。' },
    teacherRanking: ['A', 'B', 'C', 'D'],
    history: [],
    remainingMs: 600000
  });

  assert.strictEqual(requestUrl, 'https://api.openai.com/v1/responses');
  assert.strictEqual(requestHeaders.Authorization, 'Bearer test-key-never-sent');
  assert.strictEqual(requestPayload.model, 'gpt-5.6-sol');
  assert.strictEqual(requestPayload.reasoning.effort, 'high');
  assert.strictEqual(requestPayload.store, false);
  assert.strictEqual(requestPayload.text.format.type, 'json_schema');
  assert.strictEqual(requestPayload.text.format.strict, true);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.llmProfile, 'openai-official');
  assert.strictEqual(result.llmModel, 'gpt-5.6-sol');
  assert.strictEqual(result.question, '阳阳说“着火了，好开心”，您听到后最先注意到什么？');

  console.log('PASS  OpenAI 官方 Responses API 地址固定且密钥只从服务端环境变量读取');
  console.log('PASS  gpt-5.6-sol + high reasoning + 严格 JSON 输出配置正确');
  console.log('PASS  Responses API 原始 output 数组可正确还原为访谈问题');
})().catch((error) => {
  console.error('FAIL ', error && error.stack || error);
  process.exit(1);
});
