'use strict';

class DialogueAdapterError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'DialogueAdapterError';
    this.code = code;
    this.status = status;
  }
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value || {}), 'utf8');
}

function resolveGatewayActor(event, gatewayToken) {
  const gateway = event && event.__gsygGateway;
  if (
    gateway
    && gatewayToken
    && gateway.token === gatewayToken
    && gateway.identityType === 'web_account'
    && /^web:[A-Za-z0-9_-]{4,128}$/.test(gateway.actor || '')
  ) return gateway.actor;
  return '';
}

function publicFailure(error) {
  const code = String(error && (error.code || error.message) || 'dialogue_agent_failed');
  const safeCodes = new Set([
    'invalid_request',
    'missing_session_id',
    'missing_model_lock',
    'provider_mismatch',
    'model_mismatch',
    'session_not_found',
    'forbidden',
    'payload_too_large',
    'provider_not_configured',
    'content_safety_not_configured',
    'input_content_rejected',
    'output_content_rejected',
    'invalid_provider_output',
    'invalid_evidence_output',
    'upstream_http_error',
    'rate_limited'
  ]);
  return {
    ok: false,
    error: safeCodes.has(code) ? code : 'dialogue_agent_failed'
  };
}

function createDialogueHandler({
  agent,
  gatewayToken,
  authorizeSession = async () => ({ ok: true }),
  checkContent = async () => ({ pass: true }),
  contentSafetyReady = true,
  maxBodyBytes = 1024 * 1024
} = {}) {
  if (!agent || typeof agent.run !== 'function' || typeof agent.analyzeEvidence !== 'function') {
    throw new TypeError('agent.run and agent.analyzeEvidence are required');
  }

  return async function handleDialogueRequest(event = {}) {
    const actor = resolveGatewayActor(event, gatewayToken);
    if (!actor) return { ok: false, error: 'not_authenticated' };

    const provider = agent.provider || {};
    const providerReady = Boolean(provider.ready && provider.id && provider.id !== 'mock');
    const ready = Boolean(providerReady && contentSafetyReady);
    const operation = String(event.operation || '');

    if (operation === 'health') {
      return {
        ok: true,
        ready,
        provider: String(provider.id || ''),
        model: String(provider.model || ''),
        prompt_version: String(agent.promptVersion || ''),
        content_safety_required: true,
        content_safety_ready: Boolean(contentSafetyReady)
      };
    }

    if (!['turn', 'evidence'].includes(operation)) {
      return { ok: false, error: 'unsupported_operation' };
    }
    if (!providerReady) return { ok: false, error: 'provider_not_configured' };
    if (!contentSafetyReady) return { ok: false, error: 'content_safety_not_configured' };

    const payload = event.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, error: 'invalid_request' };
    }
    if (byteLength(payload) > maxBodyBytes) return { ok: false, error: 'payload_too_large' };

    try {
      const sessionId = String(payload.session_id || '');
      if (!sessionId) throw new DialogueAdapterError('missing_session_id');
      if (!String(payload.expected_provider || '') || !String(payload.expected_model || '')) {
        throw new DialogueAdapterError('missing_model_lock');
      }
      if (payload.expected_provider !== provider.id) throw new DialogueAdapterError('provider_mismatch', 409);
      if (payload.expected_model !== String(provider.model || '')) throw new DialogueAdapterError('model_mismatch', 409);

      const authorized = await authorizeSession({
        actor,
        sessionId,
        provider: provider.id,
        model: String(provider.model || ''),
        promptVersion: String(agent.promptVersion || '')
      });
      if (!authorized || authorized.ok === false) {
        throw new DialogueAdapterError(authorized && authorized.error || 'forbidden', 403);
      }

      const teacherTurn = String(payload.teacher_turn || '');
      if (teacherTurn) {
        const inputSafety = await checkContent(teacherTurn, { actor, direction: 'input' });
        if (!inputSafety || !inputSafety.pass) {
          throw new DialogueAdapterError(inputSafety && inputSafety.error || 'input_content_rejected', 400);
        }
      }

      if (operation === 'evidence') return await agent.analyzeEvidence(payload);

      const result = await agent.run(payload, payload.phase);
      const visibleText = String(result && result.visible_text || '');
      if (visibleText) {
        const outputSafety = await checkContent(visibleText, { actor, direction: 'output' });
        if (!outputSafety || !outputSafety.pass) {
          throw new DialogueAdapterError(outputSafety && outputSafety.error || 'output_content_rejected', 502);
        }
      }
      return result;
    } catch (error) {
      return publicFailure(error);
    }
  };
}

module.exports = {
  DialogueAdapterError,
  byteLength,
  createDialogueHandler,
  publicFailure,
  resolveGatewayActor
};
