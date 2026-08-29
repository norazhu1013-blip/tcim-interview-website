'use strict';

const crypto = require('crypto');
const { buildPrompts, PROMPT_VERSION } = require('./prompts');
const {
  DIALOGUE_RESPONSE_SCHEMA,
  DUPLICATE_QUESTION_ERROR,
  recentAssistantQuestions,
  validateDialogueOutput
} = require('./schema');
const { ProviderError, selectProvider } = require('./providers');

class InputError extends Error {
  constructor(message, code = 'invalid_request', status = 400) {
    super(message);
    this.name = 'InputError';
    this.code = code;
    this.status = status;
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
  if (input.dialogue_progress_state !== undefined && (!input.dialogue_progress_state || typeof input.dialogue_progress_state !== 'object' || Array.isArray(input.dialogue_progress_state))) throw new InputError('dialogue_progress_state must be an object');
  if (phase === 'next' && !String(input.teacher_turn || '').trim()) throw new InputError('teacher_turn is required for phase=next');
  return { ...input, phase };
}

function validateProviderLock(input, provider) {
  if (input.expected_provider !== undefined) {
    if (typeof input.expected_provider !== 'string' || !input.expected_provider.trim()) {
      throw new InputError('expected_provider must be a non-empty string');
    }
    if (input.expected_provider.trim() !== provider.id) {
      throw new InputError('the active provider no longer matches this dialogue session', 'provider_mismatch', 409);
    }
  }
  if (input.expected_model !== undefined) {
    if (typeof input.expected_model !== 'string' || !input.expected_model.trim()) {
      throw new InputError('expected_model must be a non-empty string');
    }
    if (input.expected_model.trim() !== String(provider.model || '')) {
      throw new InputError('the active model no longer matches this dialogue session', 'model_mismatch', 409);
    }
  }
}

function hasDuplicateQuestionError(validation) {
  return Boolean(validation && Array.isArray(validation.errors)
    && validation.errors.some((error) => String(error).startsWith(`${DUPLICATE_QUESTION_ERROR}:`)));
}

function duplicateCorrectionUser(originalUser, rejectedOutput, history) {
  const rejectedQuestion = String(rejectedOutput && rejectedOutput.visible_text || '').trim();
  const recentQuestions = recentAssistantQuestions(history, 5);
  return [
    originalUser,
    '',
    '【程序质检退回：近似复问】',
    `上一候选问句：${JSON.stringify(rejectedQuestion)}`,
    `近期已问问句：${JSON.stringify(recentQuestions)}`,
    '该候选与近期问题的实质落点过于相似。请只重新生成一个完整 JSON 对象，并满足：',
    '1. 不要只替换承接引语或同义改写；',
    '2. 承接当前教师原话中的另一个具体区别，转向不同的证据缺口，或在无新增价值时 CLOSE；',
    '3. action=ASK 时仍只能有一个问题。'
  ].join('\n');
}

function mergeUsage(attempts) {
  return attempts.reduce((total, generated) => {
    const usage = generated && generated.usage || {};
    total.input_tokens += Number(usage.input_tokens || 0);
    total.output_tokens += Number(usage.output_tokens || 0);
    total.total_tokens += Number(usage.total_tokens || Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0));
    return total;
  }, { input_tokens: 0, output_tokens: 0, total_tokens: 0 });
}

function createDialogueAgent(options = {}) {
  const env = options.env || process.env;
  const providerSelector = options.providerSelector || selectProvider;
  let activeProvider = options.provider || providerSelector({ ...options, env });
  const timeoutMs = positiveInt(options.timeoutMs || env.TCIM_DIALOGUE_TIMEOUT_MS, 45000);
  const maxHistoryTurns = positiveInt(options.maxHistoryTurns || env.TCIM_DIALOGUE_MAX_HISTORY_TURNS, 40);
  const maxQuestionChars = positiveInt(options.maxQuestionChars || env.TCIM_DIALOGUE_MAX_QUESTION_CHARS, 140);

  function assertProvider(provider) {
    if (!provider || typeof provider !== 'object' || typeof provider.generate !== 'function') {
      throw new TypeError('provider.generate is required');
    }
    if (!String(provider.id || '').trim()) throw new TypeError('provider.id is required');
    return provider;
  }

  function prepareProvider(providerId, providerEnv = env) {
    return assertProvider(providerSelector({ ...options, providerId, env: providerEnv }));
  }

  function setProvider(providerOrId, providerEnv = env) {
    const nextProvider = typeof providerOrId === 'string'
      ? prepareProvider(providerOrId, providerEnv)
      : assertProvider(providerOrId);
    activeProvider = nextProvider;
    return nextProvider;
  }

  assertProvider(activeProvider);

  return {
    get provider() { return activeProvider; },
    timeoutMs,
    prepareProvider,
    setProvider,
    async run(rawInput, forcedPhase, runOptions = {}) {
      // One turn keeps the provider it started with even if the next turn is
      // switched while this request is awaiting the upstream model.
      const provider = activeProvider;
      const input = validateInput(rawInput, forcedPhase);
      validateProviderLock(input, provider);
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
        const attempts = [];
        let generated;
        let validated;
        let userPrompt = prompts.user;
        // 复问属于可定位的输出质量错误：服务端自动给模型一次带具体退回原因的
        // 纠偏机会。最多一次，防止上游确定性复读时在服务端形成无界循环。
        for (let generationAttempt = 1; generationAttempt <= 2; generationAttempt += 1) {
          generated = await provider.generate({
            system: prompts.system,
            user: userPrompt,
            schema: DIALOGUE_RESPONSE_SCHEMA,
            phase: prompts.phase,
            itemId: String(input.item_id || input.compiled_card.itemId || input.compiled_card.item_id || ''),
            teacherTurn: prompts.teacherTurn,
            history: prompts.history,
            dialogueProgressState: prompts.dialogueProgressState,
            promptCacheKey: prompts.promptCacheKey,
            signal: controller.signal,
            requestId,
            generationAttempt
          });
          attempts.push(generated);
          validated = validateDialogueOutput(generated.output, {
            phase: prompts.phase,
            teacherTurn: prompts.teacherTurn,
            history: prompts.repetitionHistory,
            compiledCard: input.compiled_card,
            maxQuestionChars
          });
          if (validated.ok) break;
          if (generationAttempt === 1 && hasDuplicateQuestionError(validated)) {
            userPrompt = duplicateCorrectionUser(prompts.user, generated.output, prompts.repetitionHistory);
            continue;
          }
          break;
        }
        if (!validated.ok) {
          throw new ProviderError(`provider output failed validation: ${validated.errors.join('; ')}`, {
            provider: generated.provider || provider.id,
            code: 'invalid_provider_output',
            details: validated.errors.join('; ')
          });
        }
        const action = generated.output.action;
        const visibleText = generated.output.visible_text;
        const usage = mergeUsage(attempts);
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
            generation_attempts: attempts.length,
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

module.exports = { InputError, createDialogueAgent, validateInput, validateProviderLock };
