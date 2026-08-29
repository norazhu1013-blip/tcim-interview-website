'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDialogueAgent } = require('../src/dialogue-agent');
const { createBuiltInMockProvider } = require('../src/providers');
const { createHttpServer, isLoopbackHost, isLoopbackAddress } = require('../src/http-server');
const { createLocalStore } = require('../src/local-store');
const { createLocalGateway } = require('../src/local-gateway');
const { compiledCard, fullAnswers } = require('./fixtures');

async function startFixture(t) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tcim-dialogue-test-'));
  const agent = createDialogueAgent({ provider: createBuiltInMockProvider() });
  const store = createLocalStore({ filePath: path.join(directory, 'state.json') });
  const gateway = createLocalGateway({ store, agent });
  const server = createHttpServer({ agent, gateway });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.promises.rm(directory, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${server.address().port}`, store };
}

async function call(base, action, data = {}, headers = {}) {
  const response = await fetch(`${base}/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ action, data })
  });
  return { response, body: await response.json() };
}

test('only loopback bind hosts and remote addresses are accepted', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('127.2.3.4'), true);
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackHost('0.0.0.0'), false);
  assert.equal(isLoopbackHost('192.168.1.20'), false);
});

test('health, localhost CORS and first-turn endpoint work', async (t) => {
  const { base } = await startFixture(t);
  const health = await fetch(`${base}/health`, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const blocked = await fetch(`${base}/health`, { headers: { Origin: 'https://example.com' } });
  assert.equal(blocked.status, 403);
  const response = await fetch(`${base}/v1/dialogue/first`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ compiled_card: compiledCard(), history: [], evidence_summary: {} })
  });
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.provider, 'mock');
});

test('gateway persists profile/session and runs canonical deterministic selectFinal', async (t) => {
  const { base, store } = await startFixture(t);
  const headers = { 'X-TCIM-Local-User': 'teacher-a' };
  const auth = await fetch(`${base}/auth/session`, { headers });
  assert.equal((await auth.json()).user.uid, 'local:teacher-a');
  assert.equal((await call(base, 'reportTeacher', { profile: { name: '测试教师' } }, headers)).body.ok, true);
  assert.equal((await call(base, 'reportSession', { sessionId: 's1', profile: { name: '测试教师' }, answers: fullAnswers() }, headers)).body.ok, true);
  const selected = await call(base, 'selectFinal', { sessionId: 's1' }, headers);
  assert.equal(selected.body.ok, true);
  assert.equal(selected.body.selection.algo, 'advisor_local_v1');
  assert.equal(selected.body.selection.final.length, 3);
  assert.equal(Object.prototype.hasOwnProperty.call(selected.body.selection.final[0], 'task_card'), false);
  const state = await store.read();
  assert.equal(state.sessions['local:teacher-a|s1'].selection.algo, 'advisor_local_v1');
});

test('gateway draft/interview writes are revision-safe and return receipts', async (t) => {
  const { base, store } = await startFixture(t);
  const firstDraft = await call(base, 'reportDraft', { sessionId: 's2', itemId: 'Q1', turnSeq: 2, messages: [] });
  const staleDraft = await call(base, 'reportDraft', { sessionId: 's2', itemId: 'Q1', turnSeq: 1, messages: [] });
  assert.equal(firstDraft.body.stale, false);
  assert.equal(staleDraft.body.stale, true);
  const interview = await call(base, 'reportInterview', {
    sessionId: 's2', revision: 1, feedback: null,
    transcripts: {
      Q1: { mode: 'dialogue_agent_new_five_tables_evidence_state', simulationOnly: false, messages: [] },
      Q2: { mode: 'dialogue_agent_new_five_tables_evidence_state', simulationOnly: true, messages: [] },
      Q3: { mode: 'dialogue_agent_new_five_tables_evidence_state', simulationOnly: false, llmProfile: 'mock', messages: [] }
    }
  });
  assert.equal(interview.body.ok, true);
  assert.match(interview.body.payloadHash, /^[a-f0-9]{64}$/);
  assert.equal(typeof interview.body.serverRecordId, 'string');
  const state = await store.read();
  assert.deepEqual(Object.keys(state.interviews['local:local-user|s2'].transcripts), ['Q1']);
});
