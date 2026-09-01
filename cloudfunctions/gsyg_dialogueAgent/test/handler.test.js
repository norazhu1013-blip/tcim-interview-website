'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createDialogueHandler } = require('../handler');

function gateway(actor = 'web:teacher_1234') {
  return { token: 'gateway-token', actor, identityType: 'web_account' };
}

function fixtureAgent() {
  return {
    provider: { id: 'kimi', model: 'kimi-k3', ready: true },
    promptVersion: 'tcim-dialogue-test',
    async run(payload) {
      return { ok: true, action: 'ASK', visible_text: `下一问：${payload.teacher_turn || '首问'}？` };
    },
    async analyzeEvidence() {
      return { ok: true, evidence_candidates: [] };
    }
  };
}

function payload(overrides = {}) {
  return {
    phase: 'next',
    session_id: 'session-1',
    expected_provider: 'kimi',
    expected_model: 'kimi-k3',
    teacher_turn: '我会先观察幼儿的反应',
    ...overrides
  };
}

test('health is protected and does not expose secrets', async () => {
  const handle = createDialogueHandler({ agent: fixtureAgent(), gatewayToken: 'gateway-token' });
  assert.deepEqual(await handle({ operation: 'health' }), { ok: false, error: 'not_authenticated' });
  const result = await handle({ operation: 'health', __gsygGateway: gateway() });
  assert.equal(result.ok, true);
  assert.equal(result.ready, true);
  assert.equal(result.provider, 'kimi');
  assert.equal(result.model, 'kimi-k3');
  assert.equal(JSON.stringify(result).includes('gateway-token'), false);
});

test('turn requires owner authorization, fixed model lock, and two-way content safety', async () => {
  const calls = [];
  const handle = createDialogueHandler({
    agent: fixtureAgent(),
    gatewayToken: 'gateway-token',
    authorizeSession: async (input) => { calls.push(['auth', input]); return { ok: true }; },
    checkContent: async (text, context) => { calls.push([context.direction, text]); return { pass: true }; }
  });
  const result = await handle({ operation: 'turn', payload: payload(), __gsygGateway: gateway() });
  assert.equal(result.ok, true);
  assert.equal(result.action, 'ASK');
  assert.deepEqual(calls.map((row) => row[0]), ['auth', 'input', 'output']);
  assert.equal(calls[0][1].actor, 'web:teacher_1234');
  assert.equal(calls[0][1].provider, 'kimi');
});

test('model mismatch and unsafe input fail closed before provider call', async () => {
  let providerCalls = 0;
  const agent = fixtureAgent();
  agent.run = async () => { providerCalls += 1; return { ok: true }; };
  const handle = createDialogueHandler({
    agent,
    gatewayToken: 'gateway-token',
    authorizeSession: async () => ({ ok: true }),
    checkContent: async (_text, context) => context.direction === 'input'
      ? { pass: false, error: 'input_content_rejected' }
      : { pass: true }
  });
  const mismatch = await handle({
    operation: 'turn',
    payload: payload({ expected_model: 'another-model' }),
    __gsygGateway: gateway()
  });
  assert.deepEqual(mismatch, { ok: false, error: 'model_mismatch' });
  const rejected = await handle({ operation: 'turn', payload: payload(), __gsygGateway: gateway() });
  assert.deepEqual(rejected, { ok: false, error: 'input_content_rejected' });
  assert.equal(providerCalls, 0);
});

test('provider and content-safety readiness fail with distinct closed errors', async () => {
  const providerDown = fixtureAgent();
  providerDown.provider.ready = false;
  const providerHandle = createDialogueHandler({ agent: providerDown, gatewayToken: 'gateway-token' });
  assert.deepEqual(
    await providerHandle({ operation: 'turn', payload: payload(), __gsygGateway: gateway() }),
    { ok: false, error: 'provider_not_configured' }
  );

  const safetyHandle = createDialogueHandler({
    agent: fixtureAgent(),
    gatewayToken: 'gateway-token',
    contentSafetyReady: false
  });
  assert.deepEqual(
    await safetyHandle({ operation: 'turn', payload: payload(), __gsygGateway: gateway() }),
    { ok: false, error: 'content_safety_not_configured' }
  );
});

test('evidence analysis uses the same authenticated session and payload limit', async () => {
  const handle = createDialogueHandler({
    agent: fixtureAgent(),
    gatewayToken: 'gateway-token',
    authorizeSession: async () => ({ ok: true }),
    maxBodyBytes: 600
  });
  const evidence = await handle({ operation: 'evidence', payload: payload(), __gsygGateway: gateway() });
  assert.deepEqual(evidence, { ok: true, evidence_candidates: [] });
  const oversized = await handle({
    operation: 'evidence',
    payload: payload({ teacher_turn: '字'.repeat(800) }),
    __gsygGateway: gateway()
  });
  assert.deepEqual(oversized, { ok: false, error: 'payload_too_large' });
});
