'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createTencentTmsSafety, tmsCredential } = require('../content-safety');

const env = {
  TENCENTCLOUD_SECRET_ID: 'id',
  TENCENTCLOUD_SECRET_KEY: 'key',
  TENCENT_TMS_REGION: 'ap-guangzhou',
  TENCENT_TMS_BIZ_TYPE: 'tcim_interview'
};

test('Tencent TMS credential aliases are normalized', () => {
  assert.deepEqual(tmsCredential({ TENCENTCLOUD_SECRETID: 'a', TENCENTCLOUD_SECRETKEY: 'b' }), {
    secretId: 'a', secretKey: 'b', token: ''
  });
});

test('Tencent TMS receives Base64 text and ordinary web user identity', async () => {
  let request = null;
  class Client {
    async TextModeration(input) {
      request = input;
      return { Suggestion: 'Pass', Label: 'Normal', RequestId: 'request-1' };
    }
  }
  const safety = createTencentTmsSafety({ Client, env });
  assert.equal(safety.ready, true);
  assert.deepEqual(await safety.check('教师的测试回答', { actor: 'web:test_1234', direction: 'input' }), {
    pass: true, mode: 'tencent_tms', requestId: 'request-1'
  });
  assert.equal(Buffer.from(request.Content, 'base64').toString('utf8'), '教师的测试回答');
  assert.deepEqual(request.User, { UserId: 'web:test_1234', AccountType: 7 });
  assert.equal(request.BizType, 'tcim_interview');
});

test('Block or Review is rejected, while service errors are reported separately', async () => {
  class BlockClient { async TextModeration() { return { Suggestion: 'Block', Label: 'Illegal' }; } }
  const blocked = createTencentTmsSafety({ Client: BlockClient, env });
  assert.equal((await blocked.check('x', { direction: 'output' })).error, 'output_content_rejected');

  class FailedClient { async TextModeration() { const error = new Error('timeout'); error.code = 'NetworkError'; throw error; } }
  const failed = createTencentTmsSafety({ Client: FailedClient, env });
  assert.deepEqual(await failed.check('x', { direction: 'input' }), { pass: false, error: 'content_safety_unavailable' });
});

test('missing Tencent TMS credentials fails closed', async () => {
  const safety = createTencentTmsSafety({ Client: class {}, env: {} });
  assert.equal(safety.ready, false);
  assert.deepEqual(await safety.check('x'), { pass: false, error: 'content_safety_not_configured' });
});

