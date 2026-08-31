'use strict';

const cloud = require('wx-server-sdk');
const { createDialogueAgent } = require('./src/dialogue-agent');
const { createDialogueHandler } = require('./handler');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const agent = createDialogueAgent();
const gatewayToken = String(process.env.GSYG_WEB_GATEWAY_TOKEN || '');

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
  if (String(process.env.SEC_CHECK || '') !== '1') {
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
  contentSafetyReady: String(process.env.SEC_CHECK || '') === '1',
  maxBodyBytes: Number(process.env.TCIM_DIALOGUE_MAX_BODY_BYTES || 1024 * 1024)
});

exports.main = async (event) => handleDialogueRequest(event || {});

exports.__test = {
  authorizeSession,
  checkContent,
  handleDialogueRequest
};
