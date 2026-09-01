'use strict';

const crypto = require('crypto');
const {
  buildPrompts,
  buildEvidencePrompts,
  applyElicitationOriginGuard,
  PROMPT_VERSION
} = require('./prompts');
const {
  FAST_DIALOGUE_RESPONSE_SCHEMA,
  EVIDENCE_ANALYSIS_SCHEMA,
  recentAssistantQuestions,
  validateDialogueOutput,
  validateEvidenceAnalysisOutput,
  normalizeFastDialogueOutput,
  normalizeDialogueGrounding,
  normalizeNaturalQuestionOutput,
  normalizeBroadPraisePrefix,
  normalizeMisplacedApologyPrefix,
  assessQuestionQuality,
  collectDialoguePolicyIndex
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

function questionCorrectionUser(originalUser, rejectedOutput, history, validation, generationAttempt = 1, maxGenerationAttempts = 2) {
  const rejectedQuestion = String(rejectedOutput && rejectedOutput.visible_text || '').trim();
  const recentQuestions = recentAssistantQuestions(history, 5);
  const integrativeCorrection = (validation?.errors || []).some((error) => /integrative_question_lacks_global_judgment/.test(error))
    ? '9. 当前是最后整体问题：不要再追一个局部动作；问教师整体依据、两种关切如何取舍、哪些信号会改变决定，或何时坚持/何时允许例外。问句应明确出现“判断/依据/取舍/改变/例外”等决策词，以及“哪些/何时/整体/同时/之间/后续”等范围词。'
    : '';
  return [
    originalUser,
    '',
    `【程序质检退回：第${generationAttempt}个候选未通过】`,
    `上一候选问句：${JSON.stringify(rejectedQuestion)}`,
    `近期已问问句：${JSON.stringify(recentQuestions)}`,
    `退回原因：${JSON.stringify(validation?.errors || [])}`,
    '请只重新生成一个完整 JSON 对象，并满足：',
    '1. 不要只替换承接引语或同义改写；',
    '2. 承接当前教师原话中的另一个具体区别，转向不同的证据缺口，或在无新增价值时 CLOSE；',
    '3. 不得提供专业答案后请教师同意，不得把AI观点塞进问句；',
    '4. action=ASK 时仍只能有一个问题。',
    '5. 不要先改写教师刚才的意思再提问；能直接问就直接问。',
    '6. 可以有一句很短的关系承接，但不能只靠更换“明白/确实”等开头掩盖同一个问题。',
    '7. 不要用“很难得、很真实、很灵活、很细致、很有分辨、很稳、很专业”等话给教师的回答打分，也不要把教师的纠正说成“愿意坦白/承认”。指出假设情境时中性校准，不要说“抱歉/对不起/是我理解错了/是我假设过头了”。',
    '8. 先让教师自己提出原因、类别或标准；除非教师明确要求解释，不要在问句里先列“比如……”或“是A还是B”。',
    integrativeCorrection,
    generationAttempt >= maxGenerationAttempts - 1 ? '10. 下一候选是最后一次自动恢复；若没有新的安全问题，请 action=CLOSE，用简短、中性、无问号的陈述收束。' : ''
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
  const maxHistoryTurns = positiveInt(options.maxHistoryTurns || env.TCIM_DIALOGUE_MAX_HISTORY_TURNS, 8);
  const maxQuestionChars = positiveInt(options.maxQuestionChars || env.TCIM_DIALOGUE_MAX_QUESTION_CHARS, 140);
  const fastReasoningEffort = String(options.fastReasoningEffort || env.TCIM_DIALOGUE_FAST_REASONING_EFFORT || 'low');
  const evidenceReasoningEffort = String(options.evidenceReasoningEffort || env.TCIM_EVIDENCE_REASONING_EFFORT || 'medium');
  const fastMaxOutputTokens = positiveInt(options.fastMaxOutputTokens || env.TCIM_DIALOGUE_FAST_MAX_OUTPUT_TOKENS, 500);
  const evidenceMaxOutputTokens = positiveInt(options.evidenceMaxOutputTokens || env.TCIM_EVIDENCE_MAX_OUTPUT_TOKENS, 1600);
  // 单轮最多两次上游调用，避免一个不合格问句把可见等待放大到三倍。
  const maxGenerationAttempts = Math.min(2, positiveInt(
    options.maxGenerationAttempts || env.TCIM_DIALOGUE_MAX_GENERATION_ATTEMPTS,
    2
  ));

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

  async function analyzeEvidence(rawInput, runOptions = {}) {
    const provider = activeProvider;
    const input = validateInput({ ...rawInput, phase: 'next' }, 'next');
    validateProviderLock(input, provider);
    const prompts = buildEvidencePrompts(input, { maxHistoryTurns: 6 });
    const controller = new AbortController();
    const externalSignal = runOptions.signal;
    const abort = () => controller.abort(new Error('client disconnected'));
    if (externalSignal?.aborted) abort();
    else externalSignal?.addEventListener('abort', abort, { once: true });
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    try {
      const generated = await provider.generate({
        system: prompts.system,
        user: prompts.user,
        schema: EVIDENCE_ANALYSIS_SCHEMA,
        schemaName: 'tcim_evidence_analysis_v1',
        reasoningEffort: evidenceReasoningEffort,
        maxOutputTokens: evidenceMaxOutputTokens,
        promptCacheKey: prompts.promptCacheKey,
        signal: controller.signal,
        requestId
      });
      const evidenceOutput = {
        evidence_candidates: applyElicitationOriginGuard(
          Array.isArray(generated.output?.evidence_candidates) ? generated.output.evidence_candidates : [],
          prompts.originGuard
        )
      };
      const validated = validateEvidenceAnalysisOutput(evidenceOutput, {
        teacherTurn: prompts.teacherTurn,
        compiledCard: input.compiled_card
      });
      if (!validated.ok) {
        throw new ProviderError(`evidence output failed validation: ${validated.errors.join('; ')}`, {
          provider: generated.provider || provider.id,
          code: 'invalid_evidence_output',
          details: validated.errors.join('; ')
        });
      }
      return {
        ok: true,
        request_id: requestId,
        evidence_candidates: evidenceOutput.evidence_candidates,
        provider: generated.provider || provider.id,
        model: generated.model || provider.model || '',
        prompt_version: `${PROMPT_VERSION}:evidence-v1`,
        usage: generated.usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        latency_ms: Date.now() - startedAt,
        provider_request_id: generated.provider_request_id || '',
        origin_guard: prompts.originGuard
      };
    } finally {
      externalSignal?.removeEventListener('abort', abort);
    }
  }

  assertProvider(activeProvider);

  return {
    get provider() { return activeProvider; },
    promptVersion: PROMPT_VERSION,
    timeoutMs,
    prepareProvider,
    setProvider,
    analyzeEvidence,
    async run(rawInput, forcedPhase, runOptions = {}) {
      // One turn keeps the provider it started with even if the next turn is
      // switched while this request is awaiting the upstream model.
      const provider = activeProvider;
      const input = validateInput(rawInput, forcedPhase);
      validateProviderLock(input, provider);
      const prompts = buildPrompts(input, { maxHistoryTurns });
      const allowVisibleRepair = prompts.responseStyle?.mode !== 'NATURAL_CONTINUE';
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
        const styleAdjustments = [];
        let generated;
        let validated;
        let userPrompt = prompts.user;
        // 可见问句或结构化字段未通过时只允许一次自动恢复；第二个候选仍失败
        // 就暂停，避免一次问题把教师的可见等待放大到三倍。
        for (let generationAttempt = 1; generationAttempt <= maxGenerationAttempts; generationAttempt += 1) {
          generated = await provider.generate({
            system: prompts.system,
            user: userPrompt,
            schema: FAST_DIALOGUE_RESPONSE_SCHEMA,
            schemaName: 'tcim_dialogue_fast_v3',
            reasoningEffort: fastReasoningEffort,
            maxOutputTokens: fastMaxOutputTokens,
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
          generated.output = normalizeFastDialogueOutput(generated.output, prompts.phase);
          // trace只记录最终候选的可见文本调整，不把被拒绝尝试混入。
          styleAdjustments.length = 0;
          const grounded = normalizeDialogueGrounding(generated.output, {
            phase: prompts.phase,
            teacherTurn: prompts.teacherTurn
          });
          generated.output = grounded.value;
          if (grounded.adjusted) styleAdjustments.push({
            type: 'REPAIRED_TEACHER_QUOTE',
            source: 'current_teacher_turn',
            original_was_empty: !String(grounded.originalQuote || '').trim()
          });
          const naturalized = normalizeNaturalQuestionOutput(generated.output, {
            phase: prompts.phase,
            allowVisibleRepair
          });
          generated.output = naturalized.value;
          if (naturalized.adjusted) styleAdjustments.push({
            type: 'REMOVED_FORMULAIC_RESTATEMENT_PREFIX',
            removed_prefix: naturalized.removedPrefix
          });
          const deApologized = normalizeMisplacedApologyPrefix(generated.output);
          generated.output = deApologized.value;
          if (deApologized.adjusted) styleAdjustments.push({
            type: 'REMOVED_MISPLACED_APOLOGY_PREFIX',
            removed_prefix: deApologized.removedPrefix
          });
          const dePraised = normalizeBroadPraisePrefix(generated.output);
          generated.output = dePraised.value;
          if (dePraised.adjusted) styleAdjustments.push({
            type: 'REMOVED_BROAD_PRAISE_PREFIX',
            removed_prefix: dePraised.removedPrefix
          });
          const knownDialoguePolicies = collectDialoguePolicyIndex(input.compiled_card).all;
          generated.output.direction.consulted_policy_ids = generated.output.direction.consulted_policy_ids
            .filter((policyId) => knownDialoguePolicies.has(policyId));
          validated = validateDialogueOutput(generated.output, {
            phase: prompts.phase,
            teacherTurn: prompts.teacherTurn,
            history: prompts.repetitionHistory,
            compiledCard: input.compiled_card,
            maxQuestionChars,
            allowVisibleRepair,
            allowScaffoldedOptions: prompts.responseStyle?.support_level === 'SCAFFOLD_ALLOWED',
            questionMode: prompts.questionMode,
            relationshipMoveRequested: prompts.responseStyle?.relational_move || 'NONE',
            warmAffirmationAllowed: Boolean(prompts.responseStyle?.warm_affirmation_allowed),
            warmAffirmationRequired: Boolean(prompts.responseStyle?.warm_affirmation_required),
            mustRelaxPressure: Boolean(prompts.responseStyle?.pressure_pacing?.must_relax)
          });
          if (validated.ok) break;
          if (generationAttempt < maxGenerationAttempts) {
            userPrompt = questionCorrectionUser(
              prompts.user,
              generated.output,
              prompts.repetitionHistory,
              validated,
              generationAttempt,
              maxGenerationAttempts
            );
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
        const qualitySignals = assessQuestionQuality(generated.output, {
          phase: prompts.phase,
          teacherTurn: prompts.teacherTurn,
          history: prompts.repetitionHistory,
          maxQuestionChars,
          allowVisibleRepair,
          allowScaffoldedOptions: prompts.responseStyle?.support_level === 'SCAFFOLD_ALLOWED',
          questionMode: prompts.questionMode,
          relationshipMoveRequested: prompts.responseStyle?.relational_move || 'NONE',
          warmAffirmationAllowed: Boolean(prompts.responseStyle?.warm_affirmation_allowed),
          warmAffirmationRequired: Boolean(prompts.responseStyle?.warm_affirmation_required),
          mustRelaxPressure: Boolean(prompts.responseStyle?.pressure_pacing?.must_relax)
        });
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
            question_mode: prompts.questionMode,
            relationship_move_requested: prompts.responseStyle?.relational_move || 'NONE',
            warm_affirmation_target: Boolean(prompts.responseStyle?.warm_affirmation_required),
            warm_affirmation_count_before_turn: Number(prompts.responseStyle?.warm_affirmation_count || 0),
            warm_affirmations_remaining_before_turn: Number(prompts.responseStyle?.warm_affirmations_remaining || 0),
            pressure_pacing: prompts.responseStyle?.pressure_pacing || {},
            relational_microcue_observed: Boolean(qualitySignals.relationalMicrocueObserved),
            relational_cue_prefix: qualitySignals.relationalCuePrefix || '',
            generation_attempts: attempts.length,
            max_generation_attempts: maxGenerationAttempts,
            visible_style_adjusted: styleAdjustments.length > 0,
            style_adjustments: styleAdjustments,
            question_quality: qualitySignals,
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
