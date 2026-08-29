'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDialogueAgent } = require('../src/dialogue-agent');
const { ProviderError } = require('../src/providers');
const { PROMPT_VERSION } = require('../src/prompts');
const { validOutput, compiledCard } = require('./fixtures');

test('first turn accepts a valid strict provider result', async () => {
  const provider = { id: 'mock', model: 'test', ready: true, generate: async () => ({ output: validOutput(), provider: 'mock', model: 'test' }) };
  const result = await createDialogueAgent({ provider }).run({ phase: 'first', compiled_card: compiledCard(), history: [], evidence_summary: {} });
  assert.equal(result.ok, true);
  assert.equal(result.visible_text, validOutput().visible_text);
  assert.equal(result.next_question, validOutput().visible_text);
  assert.equal(result.action, 'ASK');
  assert.equal(result.trace.prompt_version, PROMPT_VERSION);
  assert.equal(result.provider, 'mock');
  assert.equal(typeof result.latency_ms, 'number');
});

test('follow-up evidence must quote the current teacher turn exactly', async () => {
  const provider = {
    id: 'mock', model: 'test', ready: true,
    generate: async () => ({
      output: validOutput({
        understanding: { teacher_quote: '我会先观察', meaning: '教师先观察', confidence: 'HIGH' },
        evidence_candidates: [{
          evidence_claim_id: 'ECL-Q01-PLAY-FRAME',
          understanding_id: 'UND-Q01-001',
          relation: 'SUPPORT',
          proposed_status: 'SUFFICIENT',
          response_origin: 'RO1',
          confidence: 0.8,
          spans: ['并不存在的原话'],
          rationale: '出现观察取向'
        }]
      })
    })
  };
  await assert.rejects(
    createDialogueAgent({ provider }).run({ phase: 'next', compiled_card: compiledCard(), teacher_turn: '我会先观察幼儿的反应。' }),
    (error) => error instanceof ProviderError && error.code === 'invalid_provider_output'
  );
});

test('canonical evidence IDs must be a matching pair from evidencePolicies', async () => {
  const provider = {
    id: 'mock', model: 'test', ready: true,
    generate: async () => ({
      output: validOutput({
        understanding: { teacher_quote: '我会先看幼儿', meaning: '教师先关注幼儿的活动', confidence: 'HIGH' },
        evidence_candidates: [{
          evidence_claim_id: 'ECL-Q01-PLAY-FRAME',
          understanding_id: 'UND-NOT-IN-TABLE',
          relation: 'SUPPORT',
          proposed_status: 'SUFFICIENT',
          response_origin: 'RO1',
          confidence: 0.8,
          spans: ['我会先看幼儿'],
          rationale: '教师自主说明关注幼儿活动'
        }]
      })
    })
  };
  await assert.rejects(
    createDialogueAgent({ provider }).run({ phase: 'next', compiled_card: compiledCard(), teacher_turn: '我会先看幼儿怎么继续玩。' }),
    (error) => error instanceof ProviderError && /understanding_id does not match/.test(error.message)
  );
});

test('valid canonical evidence proposal passes the unified validator', async () => {
  const provider = {
    id: 'mock', model: 'test', ready: true,
    generate: async () => ({
      output: validOutput({
        understanding: { teacher_quote: '我会先看幼儿', meaning: '教师先关注幼儿的活动', confidence: 'HIGH' },
        evidence_candidates: [{
          evidence_claim_id: 'ECL-Q01-PLAY-FRAME',
          understanding_id: 'UND-Q01-001',
          relation: 'SUPPORT',
          proposed_status: 'SUFFICIENT',
          response_origin: 'RO1',
          confidence: 0.8,
          spans: ['我会先看幼儿'],
          rationale: '教师自主说明关注幼儿活动'
        }]
      })
    })
  };
  const result = await createDialogueAgent({ provider }).run({ phase: 'next', compiled_card: compiledCard(), teacher_turn: '我会先看幼儿怎么继续玩。' });
  assert.equal(result.evidence_candidates[0].evidence_claim_id, 'ECL-Q01-PLAY-FRAME');
});

test('ORIGIN_POLICY rows guide provenance but cannot become evidence candidates', async () => {
  const card = compiledCard();
  card.evidencePolicies.push({
    evidenceClaimId: 'ECL-ORIGIN-RO1', understandingId: 'UND-ORIGIN-RO1',
    claimType: 'ORIGIN_POLICY', runtimeUse: 'ORIGIN_POLICY', allowedResponseOrigins: ['RO1']
  });
  const provider = {
    id: 'mock', model: 'test', ready: true,
    generate: async () => ({ output: validOutput({
      understanding: { teacher_quote: '我会先看幼儿', meaning: '教师先关注幼儿', confidence: 'HIGH' },
      evidence_candidates: [{
        evidence_claim_id: 'ECL-ORIGIN-RO1', understanding_id: 'UND-ORIGIN-RO1', relation: 'SUPPORT',
        proposed_status: 'SUFFICIENT', response_origin: 'RO1', confidence: 0.8,
        spans: ['我会先看幼儿'], rationale: '来源策略不能作为能力证据'
      }]
    }) })
  };
  await assert.rejects(
    createDialogueAgent({ provider }).run({ phase: 'next', compiled_card: card, teacher_turn: '我会先看幼儿怎么继续玩。' }),
    (error) => error instanceof ProviderError && /not present in compiled_card\.evidencePolicies/.test(error.message)
  );
});

test('only HARD_BOUNDARY policies may gate a model result', async () => {
  const provider = {
    id: 'mock', model: 'test', ready: true,
    generate: async () => ({ output: validOutput({ boundary: { kind: 'SAFETY', policy_id: 'DP-Q01-OPEN' } }) })
  };
  await assert.rejects(
    createDialogueAgent({ provider }).run({ phase: 'first', compiled_card: compiledCard() }),
    (error) => error instanceof ProviderError && /HARD_BOUNDARY/.test(error.message)
  );
});

test('provider work is aborted at the configured timeout', async () => {
  const provider = {
    id: 'mock', model: 'slow', ready: true,
    generate: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    })
  };
  await assert.rejects(
    createDialogueAgent({ provider, timeoutMs: 20 }).run({ phase: 'first', compiled_card: compiledCard() }),
    (error) => error instanceof ProviderError && error.code === 'provider_timeout' && error.status === 504
  );
});

test('provider work is aborted when the browser request is cancelled', async () => {
  const provider = {
    id: 'mock', model: 'slow', ready: true,
    generate: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    })
  };
  const controller = new AbortController();
  const pending = createDialogueAgent({ provider, timeoutMs: 5000 }).run(
    { phase: 'first', compiled_card: compiledCard() },
    undefined,
    { signal: controller.signal }
  );
  controller.abort();
  await assert.rejects(
    pending,
    (error) => error instanceof ProviderError && error.code === 'client_aborted' && error.status === 499
  );
});
