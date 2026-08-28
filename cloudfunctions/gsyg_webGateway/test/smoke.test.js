'use strict';

const assert = require('node:assert');

process.env.GSYG_WEB_GATEWAY_TOKEN = '0123456789abcdef0123456789abcdef';
process.env.GSYG_WEB_SESSION_SECRET = 'abcdefghijklmnopqrstuvwxyz0123456789';
process.env.WEB_CLOUDBASE_ENV_ID = 'test-env';
process.env.WEB_ALLOWED_ORIGIN = 'https://app.example.test';
process.env.GSYG_WEB_MAX_BODY = '2kb'; // 压缩上限,便于在单测里触发结构化 413

const { ACTIONS, createCloudInvoker, createGateway, verifyCloudBaseAccessToken } = require('../index.js');

async function main() {
  assert.equal(ACTIONS.whoami, 'gsyg_whoami');
  assert.equal(ACTIONS.exportData, 'gsyg_exportData');

  const defaultCalls = [];
  const interviewCalls = [];
  const routedInvoke = createCloudInvoker({
    defaultClient: { callFunction: async (input) => defaultCalls.push(input) },
    interviewClient: { callFunction: async (input) => interviewCalls.push(input) }
  });
  await routedInvoke({ name: ACTIONS.reportSession, data: { sessionId: 'regular' }, timeout: 15000 });
  await routedInvoke({ name: ACTIONS.interviewChat, data: { sessionId: 'interview' }, timeout: 65000 });
  assert.deepEqual(defaultCalls, [{ name: ACTIONS.reportSession, data: { sessionId: 'regular' } }]);
  assert.deepEqual(interviewCalls, [{ name: ACTIONS.interviewChat, data: { sessionId: 'interview' } }]);

  let verifiedUrl = '';
  const verifiedUid = await verifyCloudBaseAccessToken('valid-cloudbase-access-token', async (url, options) => {
    verifiedUrl = url;
    assert.equal(options.headers.Authorization, 'Bearer valid-cloudbase-access-token');
    return {
      ok: true,
      json: async () => ({ uid: 'cloudbase_user_123', isAnonymous: false, username: 'nora' })
    };
  });
  assert.deepEqual(verifiedUid, { uid: 'cloudbase_user_123', isAccount: true });
  assert.equal(verifiedUrl, 'https://test-env.api.tcloudbasegateway.com/auth/v1/user/me');

  const anonymousIdentity = await verifyCloudBaseAccessToken('anonymous-token', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ uid: 'anonymous_user_123', isAnonymous: true, loginType: 'ANONYMOUS' })
  }));
  assert.deepEqual(anonymousIdentity, { uid: 'anonymous_user_123', isAccount: false });

  let forwarded;
  const app = createGateway({
    verifyAccessToken: async (token) => token === 'valid-cloudbase-access-token'
      ? { uid: 'cloudbase_user_123', isAccount: true }
      : { uid: '', isAccount: false },
    invoke: async (input) => {
      forwarded = input;
      return { result: { ok: true, functionName: input.name } };
    }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const endpoint = `http://127.0.0.1:${port}`;
  const headers = { Origin: 'https://app.example.test' };

  try {
    const login = await fetch(`${endpoint}/auth/session`, {
      method: 'POST',
      headers: { ...headers, Authorization: 'Bearer valid-cloudbase-access-token' }
    });
    const loginBody = await login.json();
    const cookie = login.headers.get('set-cookie');

    assert.equal(login.status, 200);
    assert.equal(loginBody.ok, true);
    assert.equal(loginBody.user.identityType, 'web_account');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /gsyg_web_session=/);

    const response = await fetch(`${endpoint}/call`, {
      method: 'POST',
      headers: { ...headers, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reportSession', data: { sessionId: 'test', openid: 'forged', uid: 'forged' } })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example.test');
    assert.equal(forwarded.name, 'gsyg_reportSession');
    assert.equal(forwarded.data.openid, undefined);
    assert.equal(forwarded.data.uid, undefined);
    assert.equal(forwarded.data.__gsygGateway.actor, 'web:cloudbase_user_123');
    assert.equal(forwarded.data.__gsygGateway.identityType, 'web_account');
    assert.equal(forwarded.timeout, 15000);

    const exportResponse = await fetch(`${endpoint}/call`, {
      method: 'POST',
      headers: { ...headers, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'exportData', data: { format: 'xlsx' } })
    });
    const exportBody = await exportResponse.json();
    assert.equal(exportResponse.status, 200);
    assert.equal(exportBody.ok, true);
    assert.equal(forwarded.name, 'gsyg_exportData');
    assert.equal(forwarded.data.format, 'xlsx');
    assert.equal(forwarded.data.__gsygGateway.actor, 'web:cloudbase_user_123');

    const interviewResponse = await fetch(`${endpoint}/call`, {
      method: 'POST',
      headers: { ...headers, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'interviewChat', data: { sessionId: 'test', itemId: 'Q5' } })
    });
    const interviewBody = await interviewResponse.json();
    assert.equal(interviewResponse.status, 200);
    assert.equal(interviewBody.ok, true);
    assert.equal(forwarded.name, 'gsyg_interviewChat');
    assert.equal(forwarded.timeout, 65000);

    // 1.4：超过 body 上限时,网关返回结构化 413 而非默认 HTML(前端才能识别 payload_too_large)
    const bigResponse = await fetch(`${endpoint}/call`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reportSession', data: { sessionId: 'big', blob: 'x'.repeat(3000) } })
    });
    const bigBody = await bigResponse.json();
    assert.equal(bigResponse.status, 413);
    assert.equal(bigBody.ok, false);
    assert.equal(bigBody.error, 'payload_too_large');
    assert.equal(bigBody.httpStatus, 413);

    const rejected = await fetch(`${endpoint}/call`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reportSession', data: { sessionId: 'test' } })
    });
    assert.equal(rejected.status, 401);
    console.log('web account login gateway smoke test passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
