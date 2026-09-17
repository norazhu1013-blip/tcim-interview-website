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
const { timeoutPolicy, upstreamChannel } = require('./timeout-policy');

const COOKIE_NAME = 'gsyg_web_session';
const TEST_ACCOUNTS_COOKIE = 'gsyg_test_accounts';
const SESSION_VERSION = 2;
const TOKEN = process.env.GSYG_WEB_GATEWAY_TOKEN || '';
const SESSION_SECRET = process.env.GSYG_WEB_SESSION_SECRET || '';
const PORT = Number(process.env.PORT || 9000);
const MAX_BODY = process.env.GSYG_WEB_MAX_BODY || '1mb';
// 高频草稿保存、AI推理和普通业务使用独立额度，避免教师反复调整排序或逐轮
// 草稿同步耗尽最终Evidence/增量报告的额度。各通道仍按账号与窗口限流。
const MAX_CALLS = Math.max(20, Number(process.env.GSYG_WEB_RATE_LIMIT || 180));
const MAX_DRAFT_CALLS = Math.max(50, Number(process.env.GSYG_WEB_DRAFT_RATE_LIMIT || 360));
const MAX_DIALOGUE_CALLS = Math.max(20, Number(process.env.GSYG_WEB_DIALOGUE_RATE_LIMIT || 180));
const WINDOW_MS = Math.max(60_000, Number(process.env.GSYG_WEB_RATE_WINDOW_MS || 600_000));
const SESSION_TTL_SECONDS = Math.min(7 * 24 * 60 * 60, Math.max(15 * 60, Number(process.env.GSYG_WEB_SESSION_TTL_SECONDS || 21600)));
const TEST_SESSION_TTL_SECONDS = Math.min(30 * 24 * 60 * 60, Math.max(60 * 60, Number(process.env.WEB_TEST_SESSION_TTL_SECONDS || 7 * 24 * 60 * 60)));
const TEST_ENTRY_ENABLED = String(process.env.WEB_TEST_ENTRY_ENABLED || '') === '1';
const UPSTREAM_TIMEOUTS = timeoutPolicy();
const DEFAULT_UPSTREAM_TIMEOUT_MS = UPSTREAM_TIMEOUTS.business;
const INTERVIEW_UPSTREAM_TIMEOUT_MS = UPSTREAM_TIMEOUTS.interview;

// wx-server-sdk 4.x 的 provider 调用链不会把 callFunction 参数对象里的 timeout
// 传给底层请求。必须在 SDK 实例初始化时设置 timeout，否则仍会使用 15 秒默认值。
// 普通业务与访谈分别使用两个实例，避免为了慢模型放宽所有上游请求。
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: DEFAULT_UPSTREAM_TIMEOUT_MS });
const interviewCloud = cloud.createNewInstance({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: INTERVIEW_UPSTREAM_TIMEOUT_MS
});
// End-of-item evidence owns a 90s model budget. Keep its transport separate so
// this allowance cannot lengthen the foreground agent's existing 22s deadline.
const backgroundCloud = cloud.createNewInstance({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: UPSTREAM_TIMEOUTS.background
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
  reportFeedback: 'gsyg_reportInterview',
  reportDraft: 'gsyg_reportDraft',
  semanticProbe: 'gsyg_semanticProbe',
  planner: 'gsyg_planner',
  dialogueAgent: 'gsyg_dialogueAgent',
  queueReport: 'gsyg_dialogueAgent',
  reportStatus: 'gsyg_dialogueAgent'
  ,overallInterview: 'gsyg_overallInterview'
});

function createCloudInvoker({
  defaultClient = cloud,
  interviewClient = interviewCloud,
  backgroundClient = backgroundCloud
} = {}) {
  return ({ name, data }) => {
    const channel = name === ACTIONS.overallInterview ? 'interview' : upstreamChannel(name, data);
    const client = { business: defaultClient, interview: interviewClient, background: backgroundClient }[channel];
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
    if (key) { try { out[key] = decodeURIComponent(value); } catch { /* Ignore malformed unrelated cookies. */ } }
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

// Resume only identities already authorized by signed HttpOnly tokens on this
// browser. A typed name/uid never grants access to another teacher's records.
function rememberedTestTokens(req) {
  let tokens = [];
  try { tokens = JSON.parse(parseCookies(req.headers.cookie)[TEST_ACCOUNTS_COOKIE] || '[]'); } catch {}
  if (!Array.isArray(tokens)) tokens = [];
  const current = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const result = new Map();
  for (const token of [...tokens.slice(-6), current]) {
    const identity = parseSessionToken(token);
    if (identity?.identityType === 'web_test') result.set(identity.sub, token);
  }
  return [...result.values()].slice(-6);
}

function rememberTestIdentity(req, res, token) {
  const tokens = [...rememberedTestTokens(req), token].filter(Boolean);
  const unique = new Map(tokens.map(value => [parseSessionToken(value)?.sub, value]));
  unique.delete(undefined);
  const payload = JSON.stringify([...unique.values()].slice(-6));
  res.append('Set-Cookie', sessionCookie(payload, TEST_SESSION_TTL_SECONDS).replace(`${COOKIE_NAME}=`, `${TEST_ACCOUNTS_COOKIE}=`));
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-TCIM-Expected-User');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  return true;
}

function rateLimitChannel(action) {
  if (action === 'queueReport' || action === 'reportStatus') return 'report';
  if (action === 'reportDraft') return 'draft';
  if (action === 'dialogueAgent' || action === 'interviewChat') return 'dialogue';
  return 'business';
}

function createRateLimiter({
  windowMs = WINDOW_MS,
  limits = { business: MAX_CALLS, draft: MAX_DRAFT_CALLS, dialogue: MAX_DIALOGUE_CALLS, report: 180 },
  now = () => Date.now(),
  buckets = rateBuckets
} = {}) {
  return (actor, action) => {
    const channel = rateLimitChannel(action);
    const key = `${actor}:${channel}`;
    const at = now();
    const limit = Math.max(1, Number(limits[channel] || limits.business || MAX_CALLS));
    const current = buckets.get(key);
    if (!current || at >= current.resetAt) {
      buckets.set(key, { count: 1, resetAt: at + windowMs });
      return { allowed: true, channel, remaining: Math.max(0, limit - 1), resetAt: at + windowMs };
    }
    current.count += 1;
    return { allowed: current.count <= limit, channel, remaining: Math.max(0, limit - current.count), resetAt: current.resetAt };
  };
}

const checkRateLimit = createRateLimiter();

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
  testEntryEnabled = TEST_ENTRY_ENABLED,
  rateLimiter = checkRateLimit,
  control = null,
  overall = null
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!setCors(req, res)) return res.status(403).json({ ok: false, error: 'origin_not_allowed' });
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  app.use((req,res,next)=>(req.path.startsWith('/research')||req.path.startsWith('/overall'))?next():express.json({limit:req.path==='/report-workflow/queue'?'4mb':MAX_BODY})(req,res,next));
  if(control)app.use('/research',control.router);
  if(overall)app.use('/overall',overall);

  app.get('/health', async (_req, res) => {
    const health = {
      ok: true,
      mode: testEntryEnabled ? 'participation_code_entry' : 'cloudbase_account_login',
      testEntryEnabled,
      tokenConfigured: Boolean(TOKEN),
      sessionConfigured: Boolean(SESSION_SECRET),
      cloudbaseUserInfoConfigured: Boolean(USER_INFO_URL),
      upstreamTimeoutsMs: UPSTREAM_TIMEOUTS
    };
    health.researchControl=control?{version:control.version,policy:control.policy,enabled:true}:{enabled:false};
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

  // 参与码研究入口：不收集邮箱或密码，由服务端生成高熵随机身份并签发
  // HttpOnly Cookie。actor 仍由网关签名、不能由业务请求伪造；不同浏览器
  // 的资料、测评和访谈记录继续按 actor 隔离。为避免账号冒用，免密码身份
  // 只能在原浏览器中恢复；跨设备使用需重新登记并重新参加一个场次。
  app.post('/auth/test-entry-options', async (req,res,next) => {
    if(!testEntryEnabled||!control?.administratorEntryEligible)return res.status(404).json({ok:false,error:'test_entry_disabled'});
    if(!allowedOrigins.includes(req.headers.origin)||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return res.status(403).json({ok:false,error:'origin_not_allowed'});
    const name=String(req.body?.account||'').normalize('NFKC').trim();
    if(!/^[\p{L}\p{N}_.-]{2,32}$/u.test(name))return res.status(400).json({ok:false,error:'invalid_account_name'});
    const rate=rateLimiter('entry:'+String(req.ip||req.socket.remoteAddress),'entry');
    if(!rate||rate.allowed===false)return res.status(429).json({ok:false,error:'rate_limited'});
    try{return res.json({ok:true,administratorEntry:await control.administratorEntryEligible(name)});}catch(e){next(e);}
  });

  app.post('/auth/test-session', async (req, res, next) => {
   try {
    if (!testEntryEnabled) return res.status(404).json({ ok: false, error: 'test_entry_disabled' });
    if (!SESSION_SECRET) return res.status(503).json({ ok: false, error: 'gateway_auth_not_configured' });
    const entryName=String(req.body?.administratorAccount||'').normalize('NFKC').trim();
    if(entryName&&(!allowedOrigins.includes(req.headers.origin)||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')))return res.status(403).json({ok:false,error:'origin_not_allowed'});
    if(entryName&&(!/^[\p{L}\p{N}_.-]{2,32}$/u.test(entryName)||req.body?.uid))return res.status(400).json({ok:false,error:'invalid_account_entry'});
    const existing = readIdentity(req);
    if (existing) {
      if(entryName)return res.status(409).json({ok:false,error:'logout_before_switch'});
      if (req.body?.uid && req.body.uid !== publicUser(existing).uid) return res.status(409).json({ ok:false, error:'logout_before_switch' });
      return res.json({ ok: true, user: publicUser(existing) });
    }

    if (req.body?.uid) {
      const remembered = rememberedTestTokens(req).find(value => publicUser(parseSessionToken(value))?.uid === req.body.uid);
      if (!remembered) return res.status(403).json({ ok:false, error:'test_identity_not_remembered' });
      const identity = parseSessionToken(remembered);
      const token = createSessionToken(identity.sub, Date.now(), 'web_test', TEST_SESSION_TTL_SECONDS);
      res.append('Set-Cookie', sessionCookie(token, TEST_SESSION_TTL_SECONDS));
      rememberTestIdentity(req,res,token);
      return res.json({ ok:true, user:publicUser(identity) });
    }

    const actor = `web:test_${crypto.randomBytes(18).toString('base64url')}`;
    if(entryName){
      const rate=rateLimiter('entry:'+String(req.ip||req.socket.remoteAddress),'entry');
      if(!rate||rate.allowed===false)return res.status(429).json({ok:false,error:'rate_limited'});
      if(!control?.createAdministratorEntry||!await control.createAdministratorEntry(actor,entryName))return res.status(403).json({ok:false,error:'administrator_entry_unavailable'});
    }
    const identityType = 'web_test';
    const token = createSessionToken(actor, Date.now(), identityType, TEST_SESSION_TTL_SECONDS);
    res.append('Set-Cookie', sessionCookie(token, TEST_SESSION_TTL_SECONDS));
    rememberTestIdentity(req,res,token);
    return res.json({ ok: true, user: publicUser({ sub: actor, identityType }) });
   }catch(e){next(e);}
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

  app.get('/auth/test-accounts', async (req, res, next) => {
    if (!testEntryEnabled) return res.status(404).json({ ok:false, error:'test_entry_disabled' });
    try {
      // Labels only for this browser's already signed recovery tokens. Never
      // look up an actor by an arbitrary name or return another browser's users.
      const users = await Promise.all(rememberedTestTokens(req).map(async value => {
        const identity = parseSessionToken(value);
        return { ...publicUser(identity), account: control?.teacherAccount ? await control.teacherAccount(identity.sub) : '' };
      }));
      return res.json({ ok:true, users });
    } catch(error) { return next(error); }
  });

  app.post('/auth/logout', async (req, res, next) => {
    try { if(control)await control.logout(req,res); } catch(e){return next(e);}
    if (testEntryEnabled) rememberTestIdentity(req,res,null);
    res.append('Set-Cookie', sessionCookie('', 0));
    return res.json({ ok: true });
  });

  app.post(['/call','/report-workflow/queue'], async (req, res) => {
    if (!TOKEN) return res.status(503).json({ ok: false, error: 'gateway_token_not_configured' });
    const action = req.body && req.body.action;
    if(req.path==='/report-workflow/queue' && action!=='queueReport') return res.status(400).json({ok:false,error:'unsupported_action'});
    const functionName = ACTIONS[action];
    if (!functionName) return res.status(400).json({ ok: false, error: 'unsupported_action' });

    const identity = readIdentity(req);
    const actor = identity && identity.sub;
    if (!actor) return res.status(401).json({ ok: false, error: 'not_authenticated' });
    const expectedUid = req.headers['x-tcim-expected-user'];
    if (expectedUid && expectedUid !== publicUser(identity).uid) return res.status(409).json({ ok:false, error:'account_changed' });
    const rate = rateLimiter(actor, action);
    if (!rate || rate.allowed === false) {
      const retryAfter = Math.max(1, Math.ceil((Number(rate?.resetAt || Date.now()) - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ ok: false, error: 'rate_limited', channel: String(rate?.channel || 'business') });
    }

    try {
      // Normalize/authorize the application input before copying it. Otherwise
      // top-level canonical paper/scores can be validated but not forwarded.
      // The policy must never receive the downstream signing secret.
      const receipt=control?await control.before({req,actor,action,data:req.body.data||{}}):null;
    // 明确覆盖客户端可能提交的同名字段：身份只来自验证后的网关会话。
    const data = Object.assign({}, req.body.data || {}, {
      // 下游现有授权契约把 web_account 视为“由受保护网关签发的网页身份”。
      // sessionType 额外区分正式账号与临时测试身份，actor 的 test_ 前缀也可审计。
      __gsygGateway: { token: TOKEN, actor, identityType: 'web_account', sessionType: identity.identityType }
    });
    delete data.openid;
    delete data.uid;
    // Browser cannot override the operation, identity, or forge a timer event.
    delete data.Type; delete data.TriggerName; delete data.Message;
    if(action==='reportFeedback') data.operation='feedback';
    if(action==='reportInterview') delete data.operation;
    if(action==='queueReport') data.operation='report_queue';
    if(action==='reportStatus') data.operation='report_status';

      data.__gsygGateway.modelPlan=receipt?.modelPlan||null;
      // Transport IDs are for replay protection, not an extra model instruction.
      if(action==='dialogueAgent'&&data.payload){data.payload={...data.payload};delete data.payload.transport_turn_id;}
      // timeout 同时留在内部调用契约中，便于注入测试和日志观察；线上真正生效的
      // 超时来自上方分别初始化的 defaultClient / interviewClient。
      const timeout = functionName === ACTIONS.overallInterview ? INTERVIEW_UPSTREAM_TIMEOUT_MS : UPSTREAM_TIMEOUTS[upstreamChannel(functionName, data)];
      const result = await invoke({ name: functionName, data, timeout });
      if(control)await control.after(receipt);
      return res.status(200).json(result && result.result ? result.result : { ok: false, error: 'empty_function_result' });
    } catch (error) {
      if(control&&[400,401,403,409,429].includes(error.status))return res.status(error.status).json({ok:false,error:error.message});
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
  (async()=>{
    let control=null;
    if(process.env.TCIM_CLOUD_CONTROL_ENABLED==='1'){
      const {createCloudControl}=await import('./research/cloud/runtime.mjs');
      control=await createCloudControl({cloud,express,readIdentity,allowedOrigins,secret:Buffer.from(process.env.TCIM_PARTICIPATION_SECRET||'','base64')});
    }
    let overall=null;
    if(process.env.TCIM_OVERALL_INTERVIEW_ENABLED==='1'){
      const {createOverallRouter}=require('./overall');
      overall=createOverallRouter({express,cloud,control,allowedOrigins,invoke:invokeCloudFunction,gatewayToken:TOKEN,sessionSecret:process.env.TCIM_OVERALL_SESSION_SECRET||SESSION_SECRET});
    }
    createGateway({control,overall}).listen(PORT, '0.0.0.0', () => console.log(`gsyg_webGateway listening on ${PORT}`));
  })().catch(()=>{console.error('[gateway] protected control initialization failed; refusing to bypass permissions');process.exitCode=1;});
}

module.exports = {
  ACTIONS,
  COOKIE_NAME,
  createCloudInvoker,
  createGateway,
  createRateLimiter,
  createSessionToken,
  extractCloudBaseIdentity,
  extractUid,
  parseCookies,
  parseSessionToken,
  rateLimitChannel,
  verifyCloudBaseAccessToken
};
