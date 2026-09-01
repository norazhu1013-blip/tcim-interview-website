'use strict';

const cloud = require('wx-server-sdk');
const TencentCloudTms = require('tencentcloud-sdk-nodejs-tms');
const { createDialogueAgent } = require('./src/dialogue-agent');
const { createDialogueHandler } = require('./handler');
const { createTencentTmsSafety } = require('./content-safety');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const agent = createDialogueAgent();
const gatewayToken = String(process.env.GSYG_WEB_GATEWAY_TOKEN || '');
// 普通网页没有微信小程序 OPENID，使用腾讯云网页内容安全 TMS。
// 只有真正从小程序调用时，才允许显式切回 wechat_miniprogram。
const contentSafetyMode = String(process.env.TCIM_DIALOGUE_CONTENT_SAFETY_MODE || 'tencent_tms')
  .trim()
  .toLowerCase();
const tmsSafety = createTencentTmsSafety({ Client: TencentCloudTms.tms.v20201229.Client });

async function authorizeSession({ actor, sessionId, provider, model, promptVersion }) {
  const existing = await db.collection('gsyg_sessions').where({ sessionId }).limit(1).get();
  const session = existing && existing.data && existing.data[0];
  if (!session) return { ok: false, error: 'session_not_found' };
  if (session.openid !== actor) return { ok: false, error: 'forbidden' };

  const locked = session.dialogueModelSelection;
  if (locked && locked.provider && locked.provider !== provider) return { ok: false, error: 'provider_mismatch' };
  if (locked && locked.model && locked.model !== model) return { ok: false, error: 'model_mismatch' };

  if (!locked || !locked.provider || !locked.model) {
    const selection = {
      provider,
      model,
      promptVersion,
      selectedAt: Date.now(),
      scope: 'assessment_session',
      source: 'cloud_dialogue_agent'
    };
    await db.collection('gsyg_sessions').doc(session._id).update({
      data: { dialogueModelSelection: db.command.set(selection) }
    });
  }
  return { ok: true };
}

async function checkContent(text, context = {}) {
  if (contentSafetyMode === 'tencent_tms') return tmsSafety.check(text, context);
  if (contentSafetyMode === 'provider') {
    if (String(process.env.TCIM_DIALOGUE_ALLOW_PROVIDER_SAFETY_ONLY || '') !== '1') {
      return { pass: false, error: 'content_safety_not_configured' };
    }
    return { pass: true, mode: 'provider' };
  }
  if (contentSafetyMode !== 'wechat_miniprogram' || String(process.env.SEC_CHECK || '') !== '1') {
    return { pass: false, error: 'content_safety_not_configured' };
  }
  try {
    const openapi = cloud.openapi ? cloud.openapi({ env: cloud.DYNAMIC_CURRENT_ENV }) : null;
    if (!openapi || !openapi.security || !openapi.security.msgSecCheck) {
      return { pass: false, error: 'content_safety_not_configured' };
    }
    await openapi.security.msgSecCheck({ content: String(text || ''), version: 2, scene: 4 });
    return { pass: true };
  } catch (error) {
    console.warn('[gsyg_dialogueAgent] content safety rejected', error && (error.errCode || error.code || error.message));
    return { pass: false, error: context.direction === 'output' ? 'output_content_rejected' : 'input_content_rejected' };
  }
}

const handleDialogueRequest = createDialogueHandler({
  agent,
  gatewayToken,
  authorizeSession,
  checkContent,
  contentSafetyReady: (contentSafetyMode === 'tencent_tms' && tmsSafety.ready) || (
    contentSafetyMode === 'provider' && String(process.env.TCIM_DIALOGUE_ALLOW_PROVIDER_SAFETY_ONLY || '') === '1'
  ) || (
    contentSafetyMode === 'wechat_miniprogram' && String(process.env.SEC_CHECK || '') === '1'
  ),
  contentSafetyMode,
  maxBodyBytes: Number(process.env.TCIM_DIALOGUE_MAX_BODY_BYTES || 1024 * 1024)
});

exports.main = async (event) => handleDialogueRequest(event || {});

exports.__test = {
  authorizeSession,
  checkContent,
  contentSafetyMode,
  handleDialogueRequest
};
