'use strict';

/**
 * 网页账号登录网关。
 *
 * 浏览器由 CloudBase Web SDK 完成账号密码登录。SDK access token 仅用于调用
 * /auth/session，由本函数向 CloudBase `/auth/v1/user/me` 反查稳定 UID；验证通过后，
 * 网关签发带 HMAC 的 HttpOnly Cookie。业务请求从不接受客户端提交的 openid / uid。
 */
const crypto = require('crypto');
const express = require('express');
const cloud = require('wx-server-sdk');

const COOKIE_NAME = 'gsyg_web_session';
const SESSION_VERSION = 2;
const TOKEN = process.env.GSYG_WEB_GATEWAY_TOKEN || '';
const SESSION_SECRET = process.env.GSYG_WEB_SESSION_SECRET || '';
const PORT = Number(process.env.PORT || 9000);
const MAX_BODY = process.env.GSYG_WEB_MAX_BODY || '1mb';
// R6.1 每轮包含前台问句与后台 Evidence 两次受保护调用；三题完整访谈需要
// 明显高于旧版 36 次的额度。仍按账号和时间窗限流，生产可用环境变量收紧。
const MAX_CALLS = Math.max(20, Number(process.env.GSYG_WEB_RATE_LIMIT || 180));
const WINDOW_MS = Math.max(60_000, Number(process.env.GSYG_WEB_RATE_WINDOW_MS || 600_000));
const SESSION_TTL_SECONDS = Math.min(7 * 24 * 60 * 60, Math.max(15 * 60, Number(process.env.GSYG_WEB_SESSION_TTL_SECONDS || 21600)));
const TEST_SESSION_TTL_SECONDS = Math.min(30 * 24 * 60 * 60, Math.max(60 * 60, Number(process.env.WEB_TEST_SESSION_TTL_SECONDS || 7 * 24 * 60 * 60)));
const TEST_ENTRY_ENABLED = String(process.env.WEB_TEST_ENTRY_ENABLED || '') === '1';
const DEFAULT_UPSTREAM_TIMEOUT_MS = Math.max(5_000, Number(process.env.GSYG_WEB_UPSTREAM_TIMEOUT_MS || 15_000));
const INTERVIEW_UPSTREAM_TIMEOUT_MS = Math.max(
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  Number(process.env.GSYG_WEB_INTERVIEW_TIMEOUT_MS || 65_000)
);

// wx-server-sdk 4.x 的 provider 调用链不会把 callFunction 参数对象里的 timeout
// 传给底层请求。必须在 SDK 实例初始化时设置 timeout，否则仍会使用 15 秒默认值。
// 普通业务与访谈分别使用两个实例，避免为了慢模型放宽所有上游请求。
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: DEFAULT_UPSTREAM_TIMEOUT_MS });
const interviewCloud = cloud.createNewInstance({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: INTERVIEW_UPSTREAM_TIMEOUT_MS
});

const authEnvId = String(process.env.WEB_CLOUDBASE_ENV_ID || '').trim();
const authRegion = String(process.env.WEB_CLOUDBASE_REGION || 'ap-shanghai').trim();
const defaultUserInfoUrl = authEnvId
  ? `https://${authEnvId}.api.tcloudbasegateway.com/auth/v1/user/me`
  : '';
const USER_INFO_URL = String(process.env.WEB_CLOUDBASE_USERINFO_URL || defaultUserInfoUrl).trim();
const allowedOrigins = String(process.env.WEB_ALLOWED_ORIGIN || '')
  .split(',').map((item) => item.trim()).filter(Boolean);
const sameSite = ['lax', 'strict', 'none'].includes(String(process.env.WEB_COOKIE_SAMESITE || 'lax').toLowerCase())
  ? String(process.env.WEB_COOKIE_SAMESITE || 'lax').toLowerCase()
  : 'lax';

const ACTIONS = Object.freeze({
  whoami: 'gsyg_whoami',
  exportData: 'gsyg_exportData',
  reportTeacher: 'gsyg_reportTeacher',
  reportSession: 'gsyg_reportSession',
  selectFinal: 'gsyg_selectFinal',
  interviewChat: 'gsyg_interviewChat',
  reportInterview: 'gsyg_reportInterview',
  reportDraft: 'gsyg_reportDraft',
  semanticProbe: 'gsyg_semanticProbe',
  planner: 'gsyg_planner',
  dialogueAgent: 'gsyg_dialogueAgent'
});

function createCloudInvoker({
  defaultClient = cloud,
  interviewClient = interviewCloud
} = {}) {
  return ({ name, data }) => {
    const client = [ACTIONS.interviewChat, ACTIONS.dialogueAgent].includes(name) ? interviewClient : defaultClient;
    return client.callFunction({ name, data });
  };
}

const invokeCloudFunction = createCloudInvoker();

const rateBuckets = new Map();

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(a || '');
  const right = Buffer.from(b || '');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createSessionToken(actor, now = Date.now(), identityType = 'web_account', ttlSeconds = SESSION_TTL_SECONDS) {
  if (!SESSION_SECRET) return '';
  const payload = base64url(JSON.stringify({
    sub: actor,
    exp: now + ttlSeconds * 1000,
    ver: SESSION_VERSION,
    identityType
  }));
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function parseSessionToken(value, now = Date.now()) {
  if (!SESSION_SECRET || typeof value !== 'string') return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (
      !parsed ||
      parsed.ver !== SESSION_VERSION ||
      !['web_account', 'web_test'].includes(parsed.identityType) ||
      !/^web:[A-Za-z0-9_-]{4,128}$/.test(parsed.sub || '') ||
      !Number.isFinite(parsed.exp) ||
      parsed.exp <= now
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

function sessionCookie(value, maxAge = SESSION_TTL_SECONDS) {
  const secure = process.env.NODE_ENV === 'production' || String(process.env.WEB_COOKIE_SECURE || '') === '1';
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite[0].toUpperCase()}${sameSite.slice(1)}`,
    `Max-Age=${maxAge}`
  ];
  if (secure || sameSite === 'none') attrs.push('Secure');
  return attrs.join('; ');
}

function readIdentity(req) {
  return parseSessionToken(parseCookies(req.headers.cookie)[COOKIE_NAME]);
}

function publicUser(identity) {
  if (!identity) return null;
  return {
    authenticated: true,
    uid: String(identity.sub || '').replace(/^web:/, ''),
    identityType: identity.identityType
  };
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true; // 本地健康检查 / 云端探针
  if (!allowedOrigins.includes(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  return true;
}

function checkRateLimit(actor) {
  const now = Date.now();
  const current = rateBuckets.get(actor);
  if (!current || now >= current.resetAt) {
    rateBuckets.set(actor, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  current.count += 1;
  return current.count <= MAX_CALLS;
}

function extractBearerToken(header) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || '').trim());
  return match ? match[1].trim() : '';
}

function extractUid(body) {
  const data = body && (body.data || body);
  const uid = data && (data.uid || data.sub || (data.user && (data.user.uid || data.user.sub)));
  return typeof uid === 'string' && /^[A-Za-z0-9_-]{4,128}$/.test(uid) ? uid : '';
}

function extractCloudBaseIdentity(body) {
  const data = body && (body.data || body);
  const candidates = [body, data, data && data.user, body && body.user].filter(Boolean);
  const uid = extractUid(body);
  if (!uid) return { uid: '', isAccount: false };

  const isAnonymous = candidates.some((item) => item.isAnonymous === true || item.is_anonymous === true);
  const loginTypes = candidates
    .map((item) => String(item.loginType || item.login_type || item.provider || '').toLowerCase())
    .filter(Boolean);
  const accountEvidence = candidates.some((item) => (
    item.isAnonymous === false ||
    item.is_anonymous === false ||
    Boolean(item.username || item.email || item.phone || item.hasPassword || item.has_password)
  )) || loginTypes.some((type) => /password|username|email|phone/.test(type));
  const anonymousType = loginTypes.some((type) => type.includes('anonymous'));
  return { uid, isAccount: accountEvidence && !isAnonymous && !anonymousType };
}

function summarizeBody(body) {
  try {
    return JSON.stringify(body).slice(0, 300);
  } catch {
    return String(body || '').slice(0, 300);
  }
}

async function verifyCloudBaseAccessToken(accessToken, fetchImpl = globalThis.fetch) {
  if (!USER_INFO_URL || !accessToken || typeof fetchImpl !== 'function') {
    console.warn('[gateway] CloudBase token verification skipped:', {
      userInfoConfigured: Boolean(USER_INFO_URL),
      hasAccessToken: Boolean(accessToken),
      tokenLength: accessToken ? String(accessToken).length : 0,
      hasFetch: typeof fetchImpl === 'function'
    });
    return { uid: '', isAccount: false };
  }
  try {
    const response = await fetchImpl(USER_INFO_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const body = await response.json().catch(async () => ({ text: await response.text().catch(() => '') }));
    const identity = response.ok ? extractCloudBaseIdentity(body) : { uid: '', isAccount: false };
    if (!identity.uid || !identity.isAccount) {
      console.warn('[gateway] CloudBase token verification rejected:', {
        url: USER_INFO_URL,
        status: response.status,
        ok: response.ok,
        body: summarizeBody(body)
      });
    }
    return identity;
  } catch (error) {
    console.warn('[gateway] CloudBase token verification failed:', error && error.message);
    return { uid: '', isAccount: false };
  }
}

function createGateway({
  invoke = invokeCloudFunction,
  verifyAccessToken = verifyCloudBaseAccessToken,
  testEntryEnabled = TEST_ENTRY_ENABLED
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!setCors(req, res)) return res.status(403).json({ ok: false, error: 'origin_not_allowed' });
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  app.use(express.json({ limit: MAX_BODY }));

  app.get('/health', async (_req, res) => {
    const health = {
      ok: true,
      mode: testEntryEnabled ? 'temporary_test_entry' : 'cloudbase_account_login',
      testEntryEnabled,
      tokenConfigured: Boolean(TOKEN),
      sessionConfigured: Boolean(SESSION_SECRET),
      cloudbaseUserInfoConfigured: Boolean(USER_INFO_URL)
    };
    if (!TOKEN) return res.json({ ...health, dialogueAgent: { ok: false, ready: false, error: 'gateway_token_not_configured' } });
    try {
      const result = await invoke({
        name: ACTIONS.dialogueAgent,
        data: {
          operation: 'health',
          payload: null,
          __gsygGateway: { token: TOKEN, actor: 'web:healthcheck', identityType: 'web_account' }
        },
        timeout: DEFAULT_UPSTREAM_TIMEOUT_MS
      });
      return res.json({
        ...health,
        dialogueAgent: result && result.result ? result.result : { ok: false, ready: false, error: 'empty_function_result' }
      });
    } catch (error) {
      return res.status(503).json({ ...health, ok: false, dialogueAgent: { ok: false, ready: false, error: 'upstream_function_failed' } });
    }
  });

  app.get('/auth/session', (req, res) => {
    const identity = readIdentity(req);
    if (!identity) return res.status(401).json({ ok: false, error: 'not_authenticated' });
    return res.json({ ok: true, user: publicUser(identity) });
  });

  // 临时研究测试入口：不收集邮箱或密码，由服务端生成高熵随机身份并签发
  // HttpOnly Cookie。actor 仍由网关签名、不能由业务请求伪造；不同浏览器
  // 的资料、测评和访谈记录继续按 actor 隔离。
  app.post('/auth/test-session', (req, res) => {
    if (!testEntryEnabled) return res.status(404).json({ ok: false, error: 'test_entry_disabled' });
    if (!SESSION_SECRET) return res.status(503).json({ ok: false, error: 'gateway_auth_not_configured' });
    const existing = readIdentity(req);
    if (existing) return res.json({ ok: true, user: publicUser(existing) });

    const actor = `web:test_${crypto.randomBytes(18).toString('base64url')}`;
    const identityType = 'web_test';
    const token = createSessionToken(actor, Date.now(), identityType, TEST_SESSION_TTL_SECONDS);
    res.append('Set-Cookie', sessionCookie(token, TEST_SESSION_TTL_SECONDS));
    return res.json({ ok: true, user: publicUser({ sub: actor, identityType }) });
  });

  app.post('/auth/session', async (req, res) => {
    if (!SESSION_SECRET || !USER_INFO_URL) return res.status(503).json({ ok: false, error: 'gateway_auth_not_configured' });
    const accessToken = extractBearerToken(req.headers.authorization);
    if (!accessToken) {
      console.warn('[gateway] /auth/session missing bearer token:', {
        method: req.method,
        hasAuthorizationHeader: Boolean(req.headers.authorization)
      });
    }
    const identity = await verifyAccessToken(accessToken);
    if (!identity || !identity.uid || !identity.isAccount) {
      return res.status(401).json({ ok: false, error: 'cloudbase_token_invalid' });
    }

    const actor = `web:${identity.uid}`;
    res.append('Set-Cookie', sessionCookie(createSessionToken(actor)));
    return res.json({ ok: true, user: { authenticated: true, uid: identity.uid, identityType: 'web_account' } });
  });

  app.post('/auth/logout', (_req, res) => {
    res.append('Set-Cookie', sessionCookie('', 0));
    return res.json({ ok: true });
  });

  app.post('/call', async (req, res) => {
    if (!TOKEN) return res.status(503).json({ ok: false, error: 'gateway_token_not_configured' });
    const action = req.body && req.body.action;
    const functionName = ACTIONS[action];
    if (!functionName) return res.status(400).json({ ok: false, error: 'unsupported_action' });

    const identity = readIdentity(req);
    const actor = identity && identity.sub;
    if (!actor) return res.status(401).json({ ok: false, error: 'not_authenticated' });
    if (!checkRateLimit(actor)) return res.status(429).json({ ok: false, error: 'rate_limited' });

    // 明确覆盖客户端可能提交的同名字段：身份只来自验证后的网关会话。
    const data = Object.assign({}, req.body.data || {}, {
      // 下游现有授权契约把 web_account 视为“由受保护网关签发的网页身份”。
      // sessionType 额外区分正式账号与临时测试身份，actor 的 test_ 前缀也可审计。
      __gsygGateway: { token: TOKEN, actor, identityType: 'web_account', sessionType: identity.identityType }
    });
    delete data.openid;
    delete data.uid;

    try {
      // timeout 同时留在内部调用契约中，便于注入测试和日志观察；线上真正生效的
      // 超时来自上方分别初始化的 defaultClient / interviewClient。
      const timeout = ['interviewChat', 'dialogueAgent'].includes(action)
        ? INTERVIEW_UPSTREAM_TIMEOUT_MS
        : DEFAULT_UPSTREAM_TIMEOUT_MS;
      const result = await invoke({ name: functionName, data, timeout });
      return res.status(200).json(result && result.result ? result.result : { ok: false, error: 'empty_function_result' });
    } catch (error) {
      console.error('[gateway] invoke failed', action, error && error.message);
      return res.status(502).json({ ok: false, error: 'upstream_function_failed' });
    }
  });

  // 结构化 413（1.4）：express.json 超过 limit 时抛出 entity.too.large，
  // 统一转成机器可读的 JSON，而不是默认 HTML 413 让前端只能得到 gateway_http_413。
  app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413 || /payload too large|entity too large|request entity too large/i.test(String(err.message || '')))) {
      console.warn('[gateway] payload too large', { path: req.path, status: 413 });
      return res.status(413).json({ ok: false, error: 'payload_too_large', httpStatus: 413 });
    }
    console.error('[gateway] unhandled error', err && err.message);
    return res.status(500).json({ ok: false, error: 'gateway_internal_error' });
  });

  return app;
}

if (require.main === module) {
  createGateway().listen(PORT, '0.0.0.0', () => console.log(`gsyg_webGateway listening on ${PORT}`));
}

module.exports = {
  ACTIONS,
  COOKIE_NAME,
  createCloudInvoker,
  createGateway,
  createSessionToken,
  extractCloudBaseIdentity,
  extractUid,
  parseCookies,
  parseSessionToken,
  verifyCloudBaseAccessToken
};
