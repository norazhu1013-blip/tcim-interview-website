'use strict';

const http = require('http');
const { InputError } = require('./dialogue-agent');
const { ProviderError } = require('./providers');

const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function isLoopbackHost(value) {
  const host = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  const parts = host.split('.');
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isLoopbackAddress(value) {
  const address = String(value || '').trim().toLowerCase();
  return isLoopbackHost(address.replace(/^::ffff:/, ''));
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(json);
}

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      total += chunk.length;
      if (total > maxBytes) {
        failed = true;
        reject(new InputError(`request body exceeds ${maxBytes} bytes`, 'payload_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new InputError('request body must be valid JSON', 'invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function applyCors(req, res) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  if (!LOCAL_ORIGIN_RE.test(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-TCIM-Local-User');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

function errorResponse(error) {
  if (error instanceof InputError) return { status: error.code === 'payload_too_large' ? 413 : 400, body: { ok: false, error: error.code, message: error.message } };
  if (error instanceof ProviderError) return { status: error.status || 502, body: { ok: false, error: error.code, message: error.message, provider: error.provider || undefined } };
  return { status: 500, body: { ok: false, error: 'internal_error', message: 'Unexpected server error' } };
}

function createHttpServer(options = {}) {
  if (!options.agent || typeof options.agent.run !== 'function') throw new TypeError('agent.run is required');
  const agent = options.agent;
  const gateway = options.gateway || null;
  const maxBodyBytes = positiveInt(options.maxBodyBytes || process.env.TCIM_DIALOGUE_MAX_BODY_BYTES, 1048576);

  return http.createServer(async (req, res) => {
    const clientController = new AbortController();
    const abortIfDisconnected = () => {
      if (!res.writableEnded) clientController.abort(new Error('client disconnected'));
    };
    req.once('aborted', abortIfDisconnected);
    res.once('close', abortIfDisconnected);
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (!isLoopbackAddress(req.socket && req.socket.remoteAddress)) return sendJson(res, 403, { ok: false, error: 'remote_not_allowed' });
    if (!applyCors(req, res)) return sendJson(res, 403, { ok: false, error: 'origin_not_allowed' });
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'tcim-local-dialogue-agent',
        schema_version: 'dialogue-turn-v2',
        provider: agent.provider.id,
        model: agent.provider.model || '',
        ready: agent.provider.ready !== false,
        timeout_ms: agent.timeoutMs
      });
    }

    if (gateway && url.pathname === '/auth/session' && (req.method === 'GET' || req.method === 'POST')) {
      const actor = gateway.actorFromRequest(req);
      return sendJson(res, 200, { ok: true, user: { uid: actor, identityType: 'web_account' }, local: true });
    }
    if (gateway && url.pathname === '/auth/logout' && req.method === 'POST') {
      return sendJson(res, 200, { ok: true, local: true });
    }

    if (gateway && url.pathname === '/call' && req.method === 'POST') {
      if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
        return sendJson(res, 415, { ok: false, error: 'unsupported_media_type', message: 'Content-Type must be application/json' });
      }
      try {
        const input = await readJson(req, maxBodyBytes);
        const action = String(input.action || '').trim();
        if (!action) throw new InputError('action is required');
        const result = await gateway.call(action, input.data || {}, req);
        return sendJson(res, 200, result);
      } catch (error) {
        const mapped = errorResponse(error);
        if (!(error instanceof InputError) && !(error instanceof ProviderError)) console.error('[local-gateway] request failed:', error);
        if (!res.headersSent && !res.destroyed) return sendJson(res, mapped.status, mapped.body);
      }
      return;
    }

    const phases = {
      '/v1/dialogue/turn': null,
      '/v1/dialogue/first': 'first',
      '/v1/dialogue/next': 'next'
    };
    if (req.method !== 'POST' || !Object.prototype.hasOwnProperty.call(phases, url.pathname)) {
      return sendJson(res, 404, { ok: false, error: 'not_found' });
    }
    if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
      return sendJson(res, 415, { ok: false, error: 'unsupported_media_type', message: 'Content-Type must be application/json' });
    }

    try {
      const input = await readJson(req, maxBodyBytes);
      const result = await agent.run(input, phases[url.pathname], { signal: clientController.signal });
      return sendJson(res, 200, result);
    } catch (error) {
      const mapped = errorResponse(error);
      if (!(error instanceof InputError) && !(error instanceof ProviderError)) console.error('[dialogue-server] request failed:', error);
      if (!res.headersSent && !res.destroyed) return sendJson(res, mapped.status, mapped.body);
    }
  });
}

module.exports = { createHttpServer, readJson, sendJson, errorResponse, applyCors, isLoopbackHost, isLoopbackAddress, LOCAL_ORIGIN_RE };
