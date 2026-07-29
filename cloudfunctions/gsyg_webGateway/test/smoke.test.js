'use strict';

const assert = require('node:assert');

process.env.GSYG_WEB_GATEWAY_TOKEN = '0123456789abcdef0123456789abcdef';
process.env.WEB_ALLOWED_ORIGIN = 'https://app.example.test';

const { createGateway } = require('../index.js');

async function main() {
  let forwarded;
  const app = createGateway({
    invoke: async (input) => {
      forwarded = input;
      return { result: { ok: true, functionName: input.name } };
    }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/call`, {
      method: 'POST',
      headers: { Origin: 'https://app.example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reportSession', data: { sessionId: 'test', openid: 'forged' } })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example.test');
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    assert.equal(forwarded.name, 'gsyg_reportSession');
    assert.equal(forwarded.data.openid, undefined);
    assert.match(forwarded.data.__gsygGateway.actor, /^web_demo:/);
    console.log('anonymous gateway smoke test passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
