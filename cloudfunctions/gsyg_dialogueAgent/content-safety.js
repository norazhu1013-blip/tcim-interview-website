'use strict';

function envValue(env, ...names) {
  for (const name of names) {
    const value = String(env && env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function tmsCredential(env = {}) {
  return {
    secretId: envValue(env, 'TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRETID'),
    secretKey: envValue(env, 'TENCENTCLOUD_SECRET_KEY', 'TENCENTCLOUD_SECRETKEY'),
    token: envValue(env, 'TENCENTCLOUD_SESSION_TOKEN', 'TENCENTCLOUD_SESSIONTOKEN')
  };
}

function createTencentTmsSafety({ Client, env = process.env } = {}) {
  const credential = tmsCredential(env);
  const ready = Boolean(Client && credential.secretId && credential.secretKey);
  const region = envValue(env, 'TENCENT_TMS_REGION') || 'ap-guangzhou';
  const bizType = envValue(env, 'TENCENT_TMS_BIZ_TYPE') || 'TencentCloudDefault';
  let client = null;

  function getClient() {
    if (!ready) return null;
    if (!client) {
      client = new Client({
        credential,
        region,
        profile: { httpProfile: { endpoint: 'tms.tencentcloudapi.com', reqTimeout: 8 } }
      });
    }
    return client;
  }

  async function check(text, context = {}) {
    const target = String(text || '').trim();
    if (!target) return { pass: true, mode: 'tencent_tms' };
    const activeClient = getClient();
    if (!activeClient) return { pass: false, error: 'content_safety_not_configured' };
    try {
      const result = await activeClient.TextModeration({
        Content: Buffer.from(target, 'utf8').toString('base64'),
        BizType: bizType,
        Type: 'TEXT',
        SourceLanguage: 'zh',
        ...(context.actor ? { User: { UserId: String(context.actor), AccountType: 7 } } : {})
      });
      const suggestion = String(result && result.Suggestion || '').trim();
      if (suggestion === 'Pass') {
        return { pass: true, mode: 'tencent_tms', requestId: String(result.RequestId || '') };
      }
      return {
        pass: false,
        error: context.direction === 'output' ? 'output_content_rejected' : 'input_content_rejected',
        suggestion: suggestion || 'Review',
        label: String(result && result.Label || ''),
        requestId: String(result && result.RequestId || '')
      };
    } catch (error) {
      console.warn('[gsyg_dialogueAgent] Tencent TMS unavailable', error && (error.code || error.message));
      return { pass: false, error: 'content_safety_unavailable' };
    }
  }

  return { mode: 'tencent_tms', ready, check };
}

module.exports = { createTencentTmsSafety, tmsCredential };

