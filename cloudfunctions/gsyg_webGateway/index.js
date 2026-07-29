'use strict';

/**
 * 网页匿名演示网关（仅测试环境）。
 *
 * 浏览器不传 openid/uid。网关签发不含个人信息的随机 HttpOnly Cookie，并用同一份
 * GSYG_WEB_GATEWAY_TOKEN 调用既有事件云函数。下游函数仅在令牌匹配时接收 actor。
 *
 * 禁止用于正式环境：无手机号验证、Cookie 丢失不可找回、也不提供跨设备数据合并。
 */
const crypto = require('crypto');
const express = require('express');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const COOKIE_NAME = 'gsyg_demo_sid';
const TOKEN = process.env.GSYG_WEB_GATEWAY_TOKEN || '';
const PORT = Number(process.env.PORT || 9000);
const MAX_BODY = process.env.GSYG_WEB_MAX_BODY || '1mb';
const MAX_CALLS = Math.max(5, Number(process.env.GSYG_WEB_RATE_LIMIT || 36));
const WINDOW_MS = Math.max(60_000, Number(process.env.GSYG_WEB_RATE_WINDOW_MS || 600_000));
const allowedOrigins = String(process.env.WEB_ALLOWED_ORIGIN || '')
  .split(',').map((item) => item.trim()).filter(Boolean);
const sameSite = ['lax', 'strict', 'none'].includes(String(process.env.WEB_COOKIE_SAMESITE || 'lax').toLowerCase())
  ? String(process.env.WEB_COOKIE_SAMESITE || 'lax').toLowerCase()
  : 'lax';

const ACTIONS = Object.freeze({
  reportTeacher: 'gsyg_reportTeacher',
  reportSession: 'gsyg_reportSession',
  selectFinal: 'gsyg_selectFinal',
  interviewChat: 'gsyg_interviewChat',
  reportInterview: 'gsyg_reportInterview'
});

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

function issueAnonymousActor(req, res) {
  const existing = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (/^[a-f0-9]{48}$/i.test(existing || '')) return `web_demo:${existing}`;

  const id = crypto.randomBytes(24).toString('hex');
  const secure = process.env.NODE_ENV === 'production' || String(process.env.WEB_COOKIE_SECURE || '') === '1';
  const attrs = [
    `${COOKIE_NAME}=${id}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite[0].toUpperCase()}${sameSite.slice(1)}`,
    `Max-Age=${7 * 24 * 60 * 60}`
  ];
  if (secure || sameSite === 'none') attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
  return `web_demo:${id}`;
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true; // 本地健康检查 / 云端探针
  if (!allowedOrigins.includes(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

function createGateway({ invoke = cloud.callFunction.bind(cloud) } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!setCors(req, res)) return res.status(403).json({ ok: false, error: 'origin_not_allowed' });
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  app.use(express.json({ limit: MAX_BODY }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, mode: 'anonymous_demo', tokenConfigured: Boolean(TOKEN) });
  });

  app.post('/call', async (req, res) => {
    if (!TOKEN) return res.status(503).json({ ok: false, error: 'gateway_token_not_configured' });
    const action = req.body && req.body.action;
    const functionName = ACTIONS[action];
    if (!functionName) return res.status(400).json({ ok: false, error: 'unsupported_action' });

    const actor = issueAnonymousActor(req, res);
    if (!checkRateLimit(actor)) return res.status(429).json({ ok: false, error: 'rate_limited' });

    // 明确覆盖客户端可能提交的同名字段：actor 只来自 HttpOnly Cookie。
    const data = Object.assign({}, req.body.data || {}, {
      __gsygGateway: { token: TOKEN, actor, identityType: 'web_demo' }
    });
    delete data.openid;
    delete data.uid;

    try {
      const result = await invoke({ name: functionName, data });
      return res.status(200).json(result && result.result ? result.result : { ok: false, error: 'empty_function_result' });
    } catch (error) {
      console.error('[gateway] invoke failed', action, error && error.message);
      return res.status(502).json({ ok: false, error: 'upstream_function_failed' });
    }
  });

  return app;
}

if (require.main === module) {
  createGateway().listen(PORT, '0.0.0.0', () => console.log(`gsyg_webGateway listening on ${PORT}`));
}

module.exports = { ACTIONS, createGateway, issueAnonymousActor, parseCookies };
