'use strict';

const { DIALOGUE_RESPONSE_SCHEMA } = require('./schema');

class ProviderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = options.code || 'provider_error';
    this.status = options.status || 502;
    this.provider = options.provider || '';
    this.details = options.details || '';
  }
}

function providerBaseUrl(value, fallback, officialHost, provider, options = {}) {
  const raw = String(value || fallback).replace(/\/+$/, '');
  let parsed;
  try { parsed = new URL(raw); } catch {
    throw new ProviderError(`${provider} base URL is invalid`, { provider, code: 'invalid_provider_base_url', status: 503 });
  }
  if (parsed.username || parsed.password) {
    throw new ProviderError(`${provider} base URL must not contain credentials`, { provider, code: 'invalid_provider_base_url', status: 503 });
  }
  const allowLocalTestUrl = options.allowUnsafeProviderUrl === true || String(options.env && options.env.TCIM_DIALOGUE_ALLOW_UNSAFE_PROVIDER_URLS || '') === '1';
  const hostname = parsed.hostname.toLowerCase();
  const isLoopback = hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  const isOfficial = parsed.protocol === 'https:' && hostname === officialHost;
  if (!isOfficial && !(allowLocalTestUrl && isLoopback)) {
    throw new ProviderError(`${provider} base URL must use https://${officialHost}`, { provider, code: 'unsafe_provider_base_url', status: 503 });
  }
  return raw;
}

function readPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseJsonText(text, provider) {
  try {
    return JSON.parse(String(text || '').trim());
  } catch (error) {
    throw new ProviderError(`${provider} returned invalid JSON`, {
      provider,
      code: 'invalid_provider_json',
      details: String(text || '').slice(0, 300)
    });
  }
}

function extractOpenAIText(body) {
  if (body && typeof body.output_text === 'string' && body.output_text) return body.output_text;
  if (!body || !Array.isArray(body.output)) return '';
  return body.output
    .filter((item) => item && item.type === 'message' && Array.isArray(item.content))
    .flatMap((item) => item.content)
    .filter((content) => content && content.type === 'output_text' && typeof content.text === 'string')
    .map((content) => content.text)
    .join('');
}

function normalizeUsage(usage, provider) {
  usage = usage || {};
  if (provider === 'openai') {
    const input = Number(usage.input_tokens || 0);
    const output = Number(usage.output_tokens || 0);
    return { input_tokens: input, output_tokens: output, total_tokens: Number(usage.total_tokens || input + output) };
  }
  const input = Number(usage.prompt_tokens || usage.input_tokens || 0);
  const output = Number(usage.completion_tokens || usage.output_tokens || 0);
  return { input_tokens: input, output_tokens: output, total_tokens: Number(usage.total_tokens || input + output) };
}

async function readResponseBody(response) {
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { text: raw }; }
  if (!response.ok) {
    const message = body && (body.error && (body.error.message || body.error.code) || body.message || body.text);
    throw new ProviderError(`upstream HTTP ${response.status}: ${String(message || '').slice(0, 300)}`, {
      status: response.status === 429 ? 429 : 502,
      code: 'upstream_http_error'
    });
  }
  return body;
}

function createOpenAIProvider(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const apiKey = String(options.apiKey || env.OPENAI_API_KEY || '');
  const baseUrl = providerBaseUrl(options.baseUrl || env.OPENAI_BASE_URL, 'https://api.openai.com/v1', 'api.openai.com', 'openai', { ...options, env });
  const model = String(options.model || env.OPENAI_MODEL || 'gpt-5.6-sol');
  const reasoningEffort = String(options.reasoningEffort || env.OPENAI_REASONING_EFFORT || 'high');
  const maxOutputTokens = readPositiveInt(options.maxOutputTokens || env.OPENAI_MAX_OUTPUT_TOKENS, 4000);

  return {
    id: 'openai',
    model,
    ready: Boolean(apiKey),
    async generate({ system, user, signal, promptCacheKey, schema = DIALOGUE_RESPONSE_SCHEMA, schemaName = 'tcim_dialogue_turn_v2', reasoningEffort: requestReasoningEffort, maxOutputTokens: requestMaxOutputTokens }) {
      if (!apiKey) throw new ProviderError('OPENAI_API_KEY is not configured', { provider: 'openai', code: 'provider_not_configured', status: 503 });
      if (typeof fetchImpl !== 'function') throw new ProviderError('fetch is unavailable', { provider: 'openai', code: 'fetch_unavailable', status: 500 });
      const payload = {
        model,
        instructions: system,
        input: user,
        reasoning: { effort: String(requestReasoningEffort || reasoningEffort) },
        text: {
          verbosity: 'low',
          format: {
            type: 'json_schema',
            name: schemaName,
            strict: true,
            schema
          }
        },
        max_output_tokens: readPositiveInt(requestMaxOutputTokens, maxOutputTokens),
        store: false,
        prompt_cache_key: promptCacheKey
      };
      const response = await fetchImpl(`${baseUrl}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
        signal
      });
      const body = await readResponseBody(response);
      const text = extractOpenAIText(body);
      if (!text) throw new ProviderError('OpenAI returned an empty response', { provider: 'openai', code: 'empty_provider_response' });
      return {
        output: parseJsonText(text, 'openai'),
        usage: normalizeUsage(body.usage, 'openai'),
        provider: 'openai',
        model: body.model || model,
        provider_request_id: body.id || ''
      };
    }
  };
}

function createKimiProvider(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const apiKey = String(options.apiKey || env.KIMI_API_KEY || env.MOONSHOT_API_KEY || '');
  const baseUrl = providerBaseUrl(options.baseUrl || env.KIMI_BASE_URL, 'https://api.moonshot.cn/v1', 'api.moonshot.cn', 'kimi', { ...options, env });
  const model = String(options.model || env.KIMI_MODEL || 'kimi-k3');
  const reasoningEffort = String(options.reasoningEffort || env.KIMI_REASONING_EFFORT || 'high');
  const maxCompletionTokens = readPositiveInt(options.maxCompletionTokens || env.KIMI_MAX_COMPLETION_TOKENS, 4000);

  return {
    id: 'kimi',
    model,
    ready: Boolean(apiKey),
    async generate({ system, user, signal, schema = DIALOGUE_RESPONSE_SCHEMA, schemaName = 'tcim_dialogue_turn_v2', reasoningEffort: requestReasoningEffort, maxOutputTokens: requestMaxOutputTokens }) {
      if (!apiKey) throw new ProviderError('KIMI_API_KEY or MOONSHOT_API_KEY is not configured', { provider: 'kimi', code: 'provider_not_configured', status: 503 });
      if (typeof fetchImpl !== 'function') throw new ProviderError('fetch is unavailable', { provider: 'kimi', code: 'fetch_unavailable', status: 500 });
      const payload = {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        reasoning_effort: String(requestReasoningEffort || reasoningEffort),
        max_completion_tokens: readPositiveInt(requestMaxOutputTokens, maxCompletionTokens),
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: schemaName,
            strict: true,
            schema
          }
        }
      };
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
        signal
      });
      const body = await readResponseBody(response);
      const text = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
      if (!text) throw new ProviderError('Kimi returned an empty response', { provider: 'kimi', code: 'empty_provider_response' });
      return {
        output: parseJsonText(text, 'kimi'),
        usage: normalizeUsage(body.usage, 'kimi'),
        provider: 'kimi',
        model: body.model || model,
        provider_request_id: body.id || ''
      };
    }
  };
}

const MOCK_QUESTION_STAGES = Object.freeze([
  Object.freeze([
    '在这个情境里，哪一个现场细节最影响您对四种做法的排序？',
    '面对这个情境，您形成排序时最先权衡的是什么？',
    '如果回到当时现场，您会先观察什么再决定怎么做？',
    '在这四种做法中，哪一点最能说明您当时的优先考虑？',
    '看到这个情境，您最想先弄清哪一个关键情况？'
  ]),
  Object.freeze([
    '结合您刚才的回答，哪一个可观察到的表现最能支持这个判断？',
    '您刚才说的考虑里，哪个现场线索会让您更确定这样处理？',
    '从您提到的情况中，您会用哪个具体迹象来判断是否需要介入？',
    '要把您刚才的想法落到现场，您会特别留意哪个细节？',
    '您的这个判断最需要哪一条现场信息来确认？'
  ]),
  Object.freeze([
    '如果这个关键条件发生变化，您的做法会怎么调整？',
    '什么新情况出现时，您会改变刚才的处理方向？',
    '如果幼儿的反应与您预想不同，您会如何重新判断？',
    '假如现场多了一个相反的线索，您会怎样修正原来的做法？',
    '在哪一种条件下，您会把另一种做法放到更靠前的位置？'
  ]),
  Object.freeze([
    '回看整个情境，您最希望先帮助幼儿获得什么？',
    '综合刚才的考虑，您最想优先保留幼儿的哪种可能性？',
    '在安全、游戏继续和同伴需要之间，您最终会以什么作为行动依据？',
    '如果要向同事说明这个决定，您会用哪一条理由来概括？',
    '经过这几轮梳理，您认为这个情境最需要守住的是什么？'
  ])
]);

function mockItemSeed(itemId) {
  const text = String(itemId || 'Q0');
  const numeric = Number((text.match(/\d+/) || [0])[0]);
  if (numeric) return numeric - 1;
  return Array.from(text).reduce((sum, char) => sum + char.codePointAt(0), 0);
}

function exactTeacherQuote(value, maxChars = 80) {
  return Array.from(String(value || '').trim()).slice(0, maxChars).join('');
}

function createBuiltInMockProvider() {
  return {
    id: 'mock',
    model: 'mock-dialogue-v1',
    ready: true,
    async generate({ phase, itemId, history, teacherTurn, dialogueProgressState }) {
      const first = phase === 'first';
      const priorAssistantQuestions = (Array.isArray(history) ? history : [])
        .filter((turn) => turn && ['assistant', 'ai', 'agent'].includes(turn.role) && /[?？]/.test(String(turn.text || turn.content || '')))
        .length;
      const ledgerQuestions = (Array.isArray(dialogueProgressState && dialogueProgressState.questionLedger)
        ? dialogueProgressState.questionLedger
        : []).filter((entry) => entry && entry.action === 'ASK').length;
      const stage = first ? 0 : Math.max(1, priorAssistantQuestions, ledgerQuestions);
      const shouldClose = stage >= MOCK_QUESTION_STAGES.length;
      const itemSeed = mockItemSeed(itemId);
      const choices = shouldClose ? null : MOCK_QUESTION_STAGES[stage];
      const visibleText = shouldClose
        ? '谢谢您把判断依据和条件变化说得很清楚，本情境访谈先到这里。'
        : choices[(itemSeed + stage) % choices.length];
      const teacherQuote = first ? '' : exactTeacherQuote(teacherTurn);
      return {
        output: {
          action: shouldClose ? 'CLOSE' : 'ASK',
          visible_text: visibleText,
          direction: {
            label: shouldClose ? '有界收束' : `演示探询第 ${stage + 1} 轮`,
            open_thread_id: `mock:${String(itemId || 'unknown')}:turn-${stage}`,
            rationale: 'mock provider 按题目与轮次选择确定性演示方向',
            consulted_policy_ids: []
          },
          evidence_candidates: [],
          completion_recommendation: {
            recommended: shouldClose,
            reason: shouldClose ? '演示已达到有界轮次' : '仍可继续了解教师的情境判断'
          },
          boundary: { kind: 'NONE', policy_id: '' },
          understanding: {
            teacher_quote: teacherQuote,
            meaning: first ? '尚未获得教师回答' : '当前演示轮已承接教师本轮原话',
            confidence: first ? 'LOW' : 'MEDIUM'
          },
          working_hypotheses: []
        },
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        provider: 'mock',
        model: 'mock-dialogue-v1',
        provider_request_id: 'mock'
      };
    }
  };
}

function selectProvider(options = {}) {
  const env = options.env || process.env;
  const requested = String(options.providerId || env.TCIM_DIALOGUE_PROVIDER || '').trim().toLowerCase();
  if (requested && !['kimi', 'openai', 'mock'].includes(requested)) {
    throw new ProviderError(`unsupported provider: ${requested}`, { code: 'unsupported_provider', status: 503 });
  }
  const id = requested || ((env.KIMI_API_KEY || env.MOONSHOT_API_KEY) ? 'kimi' : (env.OPENAI_API_KEY ? 'openai' : 'mock'));
  if (id === 'mock') return options.mockProvider || createBuiltInMockProvider();
  if (id === 'kimi') return createKimiProvider(options);
  return createOpenAIProvider(options);
}

module.exports = {
  ProviderError,
  createOpenAIProvider,
  createKimiProvider,
  createBuiltInMockProvider,
  selectProvider,
  extractOpenAIText,
  normalizeUsage,
  providerBaseUrl
};
