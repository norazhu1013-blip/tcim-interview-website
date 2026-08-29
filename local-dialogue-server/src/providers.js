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
    async generate({ system, user, signal, promptCacheKey, schema = DIALOGUE_RESPONSE_SCHEMA }) {
      if (!apiKey) throw new ProviderError('OPENAI_API_KEY is not configured', { provider: 'openai', code: 'provider_not_configured', status: 503 });
      if (typeof fetchImpl !== 'function') throw new ProviderError('fetch is unavailable', { provider: 'openai', code: 'fetch_unavailable', status: 500 });
      const payload = {
        model,
        instructions: system,
        input: user,
        reasoning: { effort: reasoningEffort },
        text: {
          verbosity: 'low',
          format: {
            type: 'json_schema',
            name: 'tcim_dialogue_turn_v2',
            strict: true,
            schema
          }
        },
        max_output_tokens: maxOutputTokens,
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
    async generate({ system, user, signal, schema = DIALOGUE_RESPONSE_SCHEMA }) {
      if (!apiKey) throw new ProviderError('KIMI_API_KEY or MOONSHOT_API_KEY is not configured', { provider: 'kimi', code: 'provider_not_configured', status: 503 });
      if (typeof fetchImpl !== 'function') throw new ProviderError('fetch is unavailable', { provider: 'kimi', code: 'fetch_unavailable', status: 500 });
      const payload = {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        reasoning_effort: reasoningEffort,
        max_completion_tokens: maxCompletionTokens,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'tcim_dialogue_turn_v2',
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

function createBuiltInMockProvider() {
  return {
    id: 'mock',
    model: 'mock-dialogue-v1',
    ready: true,
    async generate({ phase }) {
      const first = phase === 'first';
      return {
        output: {
          action: 'ASK',
          visible_text: first ? '看到这个情境时，您最先注意到的是什么？' : '您刚才提到这个考虑，什么情况下您的做法会有所不同？',
          direction: { label: first ? '开放情境表征' : '承接教师新线索', open_thread_id: first ? 'open-first-impression' : 'open-condition-change', rationale: 'mock provider 的确定性测试方向', consulted_policy_ids: [] },
          evidence_candidates: [],
          completion_recommendation: { recommended: false, reason: '仍可继续了解教师的情境判断' },
          boundary: { kind: 'NONE', policy_id: '' },
          understanding: { teacher_quote: '', meaning: first ? '尚未获得教师回答' : '教师提出了一个需要继续澄清的考虑', confidence: first ? 'LOW' : 'MEDIUM' },
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
