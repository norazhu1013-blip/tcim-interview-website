'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadEnvFile, updateEnvFile } = require('../src/env-file');

test('environment updates are private, round-trip safely, and preserve unrelated settings', async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tcim-env-test-'));
  const filePath = path.join(directory, '.env');
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  await fs.promises.writeFile(filePath, [
    '# keep this comment',
    'KIMI_MODEL=kimi-k3',
    'TCIM_DIALOGUE_PROVIDER=kimi',
    'TCIM_DIALOGUE_PROVIDER=stale-duplicate',
    ''
  ].join('\n'));

  const fakeValue = 'test value # with spaces and "quotes"';
  updateEnvFile(filePath, {
    TCIM_DIALOGUE_PROVIDER: 'openai',
    OPENAI_API_KEY: fakeValue
  });

  const loaded = {};
  loadEnvFile(filePath, loaded);
  assert.equal(loaded.TCIM_DIALOGUE_PROVIDER, 'openai');
  assert.equal(loaded.OPENAI_API_KEY, fakeValue);
  assert.equal(loaded.KIMI_MODEL, 'kimi-k3');
  const text = await fs.promises.readFile(filePath, 'utf8');
  assert.equal(text.includes('# keep this comment'), true);
  assert.equal((text.match(/^TCIM_DIALOGUE_PROVIDER=/gm) || []).length, 1);
  if (process.platform !== 'win32') {
    const permissions = (await fs.promises.stat(filePath)).mode & 0o777;
    assert.equal(permissions, 0o600);
  }
});

test('environment writer rejects line-breaking values without altering the existing file', async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tcim-env-test-'));
  const filePath = path.join(directory, '.env');
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const before = 'TCIM_DIALOGUE_PROVIDER=mock\n';
  await fs.promises.writeFile(filePath, before);
  assert.throws(() => updateEnvFile(filePath, { OPENAI_API_KEY: 'first\nsecond' }), /line breaks/);
  assert.equal(await fs.promises.readFile(filePath, 'utf8'), before);
});
