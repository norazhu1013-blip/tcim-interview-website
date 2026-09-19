'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../index');

async function* chunks(values) {
  for (const value of values) yield value;
}

test('system prompt describes the sixteen-minute overall interview', () => {
  assert.match(__test.SYSTEM, /约16分钟/);
  assert.doesNotMatch(__test.SYSTEM, /约12分钟/);
});

test('drains CloudBase textStream responses', async () => {
  const result = await __test.drain({ textStream: chunks(['{"visible', 'Text":"问题？","done":false}']) });
  assert.equal(result, '{"visibleText":"问题？","done":false}');
});

test('drains CloudBase eventStream delta responses', async () => {
  const result = await __test.drain({
    eventStream: chunks([
      { data: { choices: [{ delta: { content: '{"visibleText":' } }] } },
      { data: { choices: [{ delta: { content: '"问题？"}' } }] } }
    ])
  });
  assert.equal(result, '{"visibleText":"问题？"}');
});

test('drains SSE dataStream responses and ignores DONE', async () => {
  const result = await __test.drain({
    dataStream: chunks([
      'data: {"choices":[{"delta":{"content":"前半"}}]}',
      'data: {"choices":[{"delta":{"content":"后半"}}]}',
      'data: [DONE]'
    ])
  });
  assert.equal(result, '前半后半');
});
