'use strict';

const assert = require('node:assert');

process.env.GSYG_WEB_GATEWAY_TOKEN = '0123456789abcdef0123456789abcdef';
process.env.GSYG_WEB_SESSION_SECRET = 'abcdefghijklmnopqrstuvwxyz0123456789';
process.env.WEB_CLOUDBASE_ENV_ID = 'test-env';
process.env.WEB_ALLOWED_ORIGIN = 'https://app.example.test';

const { createGateway, verifyCloudBaseAccessToken } = require('../index.js');

async function main() {
  let verifiedUrl = '';
  const verifiedUid = await verifyCloudBaseAccessToken('valid-cloudbase-access-token', async (url, options) => {
    verifiedUrl = url;
    assert.equal(options.headers.Authorization, 'Bearer valid-cloudbase-access-token');
    return {
      ok: true,
      json: async () => ({ uid: 'cloudbase_user_123' })
    };
  });
  assert.equal(verifiedUid, 'cloudbase_user_123');
  assert.match(verifiedUrl, /\/web\/auth\/v1\/user\/me$/);

  let forwarded;
  const app = createGateway({
    verifyAccessToken: async (token) => token === 'valid-cloudbase-access-token' ? 'cloudbase_user_123' : '',
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
    assert.equal(forwarded.data.__gsygGateway.identityType, 'web_anonymous');

    const rejected = await fetch(`${endpoint}/call`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reportSession', data: { sessionId: 'test' } })
    });
    assert.equal(rejected.status, 401);
    console.log('web anonymous login gateway smoke test passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
