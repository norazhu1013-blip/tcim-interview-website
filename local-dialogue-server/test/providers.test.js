'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOpenAIProvider, createKimiProvider, selectProvider } = require('../src/providers');
const { DIALOGUE_RESPONSE_SCHEMA } = require('../src/schema');
const { validOutput } = require('./fixtures');

test('OpenAI provider maps to Responses API with strict schema and store=false', async () => {
  let captured;
  const provider = createOpenAIProvider({
    apiKey: 'server-secret',
    baseUrl: 'http://127.0.0.1:4111/v1/',
    allowUnsafeProviderUrl: true,
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ id: 'resp_1', model: 'gpt-5.6-sol', output_text: JSON.stringify(validOutput()), usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 } }), { status: 200 });
    }
  });
  const result = await provider.generate({ system: 'system', user: 'user', promptCacheKey: 'tcim-dialogue:dataset:item', schema: DIALOGUE_RESPONSE_SCHEMA, signal: new AbortController().signal });
  assert.equal(captured.url, 'http://127.0.0.1:4111/v1/responses');
  assert.equal(captured.options.headers.Authorization, 'Bearer server-secret');
  assert.equal(captured.body.model, 'gpt-5.6-sol');
  assert.equal(captured.body.store, false);
  assert.equal(captured.body.prompt_cache_key, 'tcim-dialogue:dataset:item');
  assert.equal(captured.body.text.format.type, 'json_schema');
  assert.equal(captured.body.text.format.strict, true);
  assert.deepEqual(captured.body.text.format.schema, DIALOGUE_RESPONSE_SCHEMA);
  assert.equal(result.output.visible_text, validOutput().visible_text);
  assert.deepEqual(result.usage, { input_tokens: 11, output_tokens: 7, total_tokens: 18 });
});

test('Kimi provider maps to compatible chat/completions strict schema', async () => {
  let captured;
  const provider = createKimiProvider({
    apiKey: 'kimi-secret',
    baseUrl: 'http://127.0.0.1:4222/v1/',
    allowUnsafeProviderUrl: true,
    model: 'kimi-k3-test',
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ id: 'chat_1', model: 'kimi-k3-test', choices: [{ message: { content: JSON.stringify(validOutput()) } }], usage: { prompt_tokens: 9, completion_tokens: 6, total_tokens: 15 } }), { status: 200 });
    }
  });
  const result = await provider.generate({ system: 'system', user: 'user', schema: DIALOGUE_RESPONSE_SCHEMA, signal: new AbortController().signal });
  assert.equal(captured.url, 'http://127.0.0.1:4222/v1/chat/completions');
  assert.equal(captured.options.headers.Authorization, 'Bearer kimi-secret');
  assert.equal(captured.body.model, 'kimi-k3-test');
  assert.deepEqual(captured.body.messages, [{ role: 'system', content: 'system' }, { role: 'user', content: 'user' }]);
  assert.equal(captured.body.response_format.type, 'json_schema');
  assert.equal(captured.body.response_format.json_schema.strict, true);
  assert.deepEqual(result.usage, { input_tokens: 9, output_tokens: 6, total_tokens: 15 });
});

test('auto provider preference is Kimi, then OpenAI, then mock', () => {
  assert.equal(selectProvider({ env: { KIMI_API_KEY: 'k', OPENAI_API_KEY: 'o' } }).id, 'kimi');
  assert.equal(selectProvider({ env: { MOONSHOT_API_KEY: 'legacy-k', OPENAI_API_KEY: 'o' } }).id, 'kimi');
  assert.equal(selectProvider({ env: { OPENAI_API_KEY: 'o' } }).id, 'openai');
  assert.equal(selectProvider({ env: {} }).id, 'mock');
});

test('provider keys cannot be sent to non-official or plaintext URLs without an explicit test override', () => {
  assert.throws(() => createOpenAIProvider({ apiKey: 'secret', baseUrl: 'http://api.openai.com/v1' }), /must use https/);
  assert.throws(() => createOpenAIProvider({ apiKey: 'secret', baseUrl: 'https://proxy.example/v1' }), /must use https/);
  assert.throws(() => createKimiProvider({ apiKey: 'secret', baseUrl: 'http://api.moonshot.cn/v1' }), /must use https/);
  assert.throws(() => createOpenAIProvider({ apiKey: 'secret', baseUrl: 'https://proxy.example/v1', allowUnsafeProviderUrl: true }), /must use https/);
  assert.equal(createOpenAIProvider({ apiKey: 'secret', baseUrl: 'http://127.0.0.1:4555/v1', allowUnsafeProviderUrl: true }).ready, true);
});
