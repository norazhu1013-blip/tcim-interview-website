'use strict';

const crypto = require('crypto');
const { buildPrompts, PROMPT_VERSION } = require('./prompts');
const { DIALOGUE_RESPONSE_SCHEMA, validateDialogueOutput } = require('./schema');
const { ProviderError, selectProvider } = require('./providers');

class InputError extends Error {
  constructor(message, code = 'invalid_request') {
    super(message);
    this.name = 'InputError';
    this.code = code;
    this.status = 400;
  }
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function validateInput(input, forcedPhase) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('JSON body must be an object');
  const phase = forcedPhase || input.phase;
  if (!['first', 'next'].includes(phase)) throw new InputError('phase must be first or next');
  if (!input.compiled_card || typeof input.compiled_card !== 'object' || Array.isArray(input.compiled_card)) throw new InputError('compiled_card must be an object');
  if (!Object.prototype.hasOwnProperty.call(input.compiled_card, 'scenarioBrief')) throw new InputError('compiled_card.scenarioBrief is required');
  for (const table of ['professionalLenses', 'evidencePolicies', 'dialoguePolicies', 'synthesisPolicies']) {
    if (!Array.isArray(input.compiled_card[table])) throw new InputError(`compiled_card.${table} must be an array`);
  }
  for (const prior of ['rankingPrior', 'processPrior']) {
    if (!Object.prototype.hasOwnProperty.call(input.compiled_card, prior)) throw new InputError(`compiled_card.${prior} is required (use null when unavailable)`);
  }
  if (input.history !== undefined && !Array.isArray(input.history)) throw new InputError('history must be an array');
  if (input.evidence_summary !== undefined && (!input.evidence_summary || typeof input.evidence_summary !== 'object' || Array.isArray(input.evidence_summary))) throw new InputError('evidence_summary must be an object');
  if (phase === 'next' && !String(input.teacher_turn || '').trim()) throw new InputError('teacher_turn is required for phase=next');
  return { ...input, phase };
}

function createDialogueAgent(options = {}) {
  const env = options.env || process.env;
  const provider = options.provider || selectProvider({ ...options, env });
  const timeoutMs = positiveInt(options.timeoutMs || env.TCIM_DIALOGUE_TIMEOUT_MS, 45000);
  const maxHistoryTurns = positiveInt(options.maxHistoryTurns || env.TCIM_DIALOGUE_MAX_HISTORY_TURNS, 40);
  const maxQuestionChars = positiveInt(options.maxQuestionChars || env.TCIM_DIALOGUE_MAX_QUESTION_CHARS, 140);

  return {
    provider,
    timeoutMs,
    async run(rawInput, forcedPhase, runOptions = {}) {
      const input = validateInput(rawInput, forcedPhase);
      const prompts = buildPrompts(input, { maxHistoryTurns });
      const controller = new AbortController();
      const externalSignal = runOptions.signal;
      let abortedByClient = Boolean(externalSignal && externalSignal.aborted);
      const abortFromClient = () => {
        abortedByClient = true;
        controller.abort(new Error('client disconnected'));
      };
      if (externalSignal && !externalSignal.aborted) {
        externalSignal.addEventListener('abort', abortFromClient, { once: true });
      } else if (abortedByClient) {
        controller.abort(new Error('client disconnected'));
      }
      const timer = setTimeout(() => controller.abort(new Error(`provider timeout after ${timeoutMs}ms`)), timeoutMs);
      const startedAt = Date.now();
      const requestId = crypto.randomUUID();
      try {
        const generated = await provider.generate({
          system: prompts.system,
          user: prompts.user,
          schema: DIALOGUE_RESPONSE_SCHEMA,
          phase: prompts.phase,
          promptCacheKey: prompts.promptCacheKey,
          signal: controller.signal,
          requestId
        });
        const validated = validateDialogueOutput(generated.output, {
          phase: prompts.phase,
          teacherTurn: prompts.teacherTurn,
          compiledCard: input.compiled_card,
          maxQuestionChars
        });
        if (!validated.ok) {
          throw new ProviderError(`provider output failed validation: ${validated.errors.join('; ')}`, {
            provider: generated.provider || provider.id,
            code: 'invalid_provider_output',
            details: validated.errors.join('; ')
          });
        }
        const action = generated.output.action;
        const visibleText = generated.output.visible_text;
        const usage = generated.usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
        const latencyMs = Date.now() - startedAt;
        const providerName = generated.provider || provider.id;
        const model = generated.model || provider.model || '';
        const providerRequestId = generated.provider_request_id || '';
        return {
          ok: true,
          request_id: requestId,
          action,
          visible_text: visibleText,
          direction: generated.output.direction,
          evidence_candidates: generated.output.evidence_candidates,
          completion_recommendation: generated.output.completion_recommendation,
          boundary: generated.output.boundary,
          understanding: generated.output.understanding,
          working_hypotheses: generated.output.working_hypotheses,
          provider: providerName,
          model,
          prompt_version: PROMPT_VERSION,
          usage,
          latency_ms: latencyMs,
          provider_request_id: providerRequestId,
          trace: {
            request_id: requestId,
            provider_request_id: providerRequestId,
            provider: providerName,
            model,
            prompt_version: PROMPT_VERSION,
            prompt_cache_key: prompts.promptCacheKey,
            usage,
            latency_ms: latencyMs
          },
          next_question: action === 'ASK' ? visibleText : '',
          evidence_proposals: generated.output.evidence_candidates,
          done: action === 'CLOSE',
          closing: action === 'CLOSE' ? visibleText : ''
        };
      } catch (error) {
        if (controller.signal.aborted || error && error.name === 'AbortError') {
          if (abortedByClient) {
            throw new ProviderError('client disconnected before provider completed', {
              provider: provider.id,
              code: 'client_aborted',
              status: 499
            });
          }
          throw new ProviderError(`provider timeout after ${timeoutMs}ms`, {
            provider: provider.id,
            code: 'provider_timeout',
            status: 504
          });
        }
        throw error;
      } finally {
        clearTimeout(timer);
        if (externalSignal) externalSignal.removeEventListener('abort', abortFromClient);
      }
    }
  };
}

module.exports = { InputError, createDialogueAgent, validateInput };
