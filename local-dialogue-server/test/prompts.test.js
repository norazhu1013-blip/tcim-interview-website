'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPrompts } = require('../src/prompts');
const { compiledCard } = require('./fixtures');

test('static card is in the system prefix while dynamic dialogue stays in user input', () => {
  const card = compiledCard();
  card.datasetId = 'five-tables-v2';
  card.configFingerprint = 'dataset-config-v7';
  const prompts = buildPrompts({
    phase: 'next', item_id: 'Q1', session_id: 'private-session', compiled_card: card,
    teacher_turn: '这是当前原话', history: [{ role: 'teacher', text: '历史回答' }], evidence_summary: { current: [] }
  });
  assert.match(prompts.system, /dataset-config-v7/);
  assert.doesNotMatch(prompts.user, /professionalLenses/);
  assert.match(prompts.user, /这是当前原话/);
  assert.match(prompts.promptCacheKey, /^tcim-dialogue:[a-f0-9]{48}$/);
  assert.ok(prompts.promptCacheKey.length <= 64);
  assert.doesNotMatch(prompts.promptCacheKey, /private-session/);
  assert.equal(prompts.promptCacheKey, buildPrompts({ phase: 'first', item_id: 'Q1', compiled_card: card }).promptCacheKey);
});
