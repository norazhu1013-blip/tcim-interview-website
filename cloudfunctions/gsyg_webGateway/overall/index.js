'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { combineImport, normalizeName } = require('./importer');

const COOKIE = 'gsyg_overall_session';
const DATASETS = 'gsyg_overall_datasets';
const TEACHERS = 'gsyg_overall_teacher_inputs';
const SESSIONS = 'gsyg_overall_sessions';
const VERSION = 'tcim-overall-interview/0.1.1';
const INTERVIEW_DURATION_MS = 12 * 60 * 1000;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 20 && crypto.timingSafeEqual(a, b);
}

function parseCookies(header) {
  const result = {};
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    try { result[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim()); } catch {}
  }
  return result;
}

function signSession(value, secret) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifySession(token, secret) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return value?.sessionId && value?.teacherId && value.exp > Date.now() ? value : null;
  } catch { return null; }
}

function cookie(value, maxAge = 7200) {
  return `${COOKIE}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Strict; Path=/gsyg-web/overall; Max-Age=${maxAge}`;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function teacherChoices(teachers) {
  const rows = Array.isArray(teachers) ? teachers : [];
  const schoolCounts = new Map();
  const detailCounts = new Map();
  for (const teacher of rows) {
    const school = teacher.profile?.kindergarten || '';
    const region = teacher.profile?.region || '';
    schoolCounts.set(`${teacher.nameKey}|${school}`, (schoolCounts.get(`${teacher.nameKey}|${school}`) || 0) + 1);
    detailCounts.set(`${teacher.nameKey}|${school}|${region}`, (detailCounts.get(`${teacher.nameKey}|${school}|${region}`) || 0) + 1);
  }
  return rows.map((teacher) => {
    const school = teacher.profile?.kindergarten || '';
    const region = teacher.profile?.region || '';
    const parts = [school || region];
    if (school && region && schoolCounts.get(`${teacher.nameKey}|${school}`) > 1) parts.push(region);
    if (detailCounts.get(`${teacher.nameKey}|${school}|${region}`) > 1) parts.push(`编号${String(teacher.externalRef || teacher._id || '').slice(-4)}`);
    const discriminator = parts.filter(Boolean).join('·') || `编号${String(teacher.externalRef || teacher._id || '').slice(-4)}`;
    return {
      id: teacher._id,
      name: teacher.name,
      label: teacher.duplicateName ? `${teacher.name}（${discriminator || `编号${String(teacher.externalRef || teacher._id || '').slice(-4)}`}）` : teacher.name
    };
  });
}

function itemContext(teacher, itemIds) {
  const wanted = new Set((Array.isArray(itemIds) ? itemIds : []).map((id) => String(id).toUpperCase()));
  return (teacher?.items || []).filter((item) => wanted.has(String(item.itemId).toUpperCase()) || wanted.has(String(item.canonicalItemId).toUpperCase())).slice(0, 2).map((item) => ({
    itemId: item.canonicalItemId || item.itemId,
    title: item.title || item.itemId,
    stem: item.stem || '',
    ranking: item.ranking || '',
    options: item.options || {}
  }));
}

function currentItemContext(session, teacher) {
  const latest = [...(session?.messages || [])].reverse().find((message) => message.role === 'ai' && message.meta?.itemIds?.length);
  return itemContext(teacher, latest?.meta?.itemIds || []);
}

function publicSession(session, teacher) {
  return {
    ok: true,
    version: VERSION,
    sessionId: session.sessionId,
    teacherName: teacher.name,
    status: session.status,
    startedAt: session.startedAt,
    deadlineAt: session.deadlineAt,
    messages: session.messages || [],
    turnCount: session.turnCount || 0,
    itemContext: currentItemContext(session, teacher)
  };
}

function createOverallRouter({ express, cloud, control, allowedOrigins, invoke, gatewayToken, sessionSecret }) {
  if (!sessionSecret) throw new Error('overall_session_secret_missing');
  const router = express.Router();
  const db = cloud.database({ throwOnNotFound: false });
  const assetsDir = path.join(__dirname, 'public');
  const assets = Object.fromEntries(['index.html', 'app.js', 'style.css'].map((name) => [name, fs.readFileSync(path.join(assetsDir, name), 'utf8')]));

  router.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    next();
  });
  router.use(express.json({ limit: '14mb' }));

  router.get(['/', '/index.html'], (_req, res) => res.type('html').send(assets['index.html']));
  router.get('/app.js', (_req, res) => res.type('js').send(assets['app.js']));
  router.get('/style.css', (_req, res) => res.type('css').send(assets['style.css']));

  async function admin(req) {
    if (!control?.adminSession) return null;
    return control.adminSession(req);
  }

  async function currentSession(req) {
    const signed = verifySession(parseCookies(req.headers.cookie)[COOKIE], sessionSecret);
    if (!signed) return null;
    const [sessionResult, teacherResult] = await Promise.all([
      db.collection(SESSIONS).where({ sessionId: signed.sessionId }).limit(1).get(),
      db.collection(TEACHERS).doc(signed.teacherId).get()
    ]);
    const session = sessionResult.data?.[0];
    const teacher = teacherResult.data?.[0] || teacherResult.data;
    if (!session || !teacher || session.teacherId !== signed.teacherId) return null;
    return { session, teacher };
  }

  router.get('/api/admin-status', async (req, res, next) => {
    try {
      const session = await admin(req);
      const active = await db.collection(DATASETS).where({ active: true }).limit(1).get();
      return res.json({ ok: true, admin: Boolean(session), dataset: active.data?.[0] ? { label: active.data[0].label, importedAt: active.data[0].importedAt, stats: active.data[0].stats } : null });
    } catch (error) { next(error); }
  });

  router.post('/api/import', async (req, res, next) => {
    try {
      if (!allowedOrigins.includes(req.headers.origin)) return res.status(403).json({ ok: false, error: 'origin_not_allowed' });
      const operator = await admin(req);
      if (!operator) return res.status(401).json({ ok: false, error: 'admin_login_required' });
      const combined = await combineImport(req.body?.resultBase64, req.body?.processBase64);
      const datasetId = `overall-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
      const label = String(req.body?.label || '').normalize('NFKC').trim().slice(0, 80) || `整体访谈数据 ${new Date().toLocaleDateString('zh-CN')}`;
      const datasetDoc = await db.collection(DATASETS).add({ data: {
        datasetId, label, active: false, importedAt: Date.now(), importedBy: operator.username || operator.adminId || 'administrator',
        stats: combined.stats, version: VERSION
      } });
      const teacherDocs = [];
      for (const teacher of combined.teachers) {
        const added = await db.collection(TEACHERS).add({ data: {
          ...teacher, datasetId, importedAt: Date.now(), version: VERSION
        } });
        teacherDocs.push(added._id || added.id);
      }
      await db.collection(DATASETS).where({ active: true }).update({ data: { active: false, retiredAt: Date.now() } });
      await db.collection(DATASETS).doc(datasetDoc._id || datasetDoc.id).update({ data: { active: true } });
      return res.status(201).json({ ok: true, datasetId, label, stats: combined.stats, importedTeachers: teacherDocs.length });
    } catch (error) {
      const known = /^(missing_workbook|workbook_size_invalid|workbook_has_no_sheet|result_header_not_found|result_questions_not_found|result_has_no_teacher_rows)$/.test(error.message);
      if (known) return res.status(400).json({ ok: false, error: error.message });
      next(error);
    }
  });

  router.post('/api/teachers/search', async (req, res, next) => {
    try {
      if (!allowedOrigins.includes(req.headers.origin)) return res.status(403).json({ ok: false, error: 'origin_not_allowed' });
      const query = normalizeName(req.body?.query || '');
      if (!query || query.length > 20) return res.json({ ok: true, teachers: [] });
      const active = await db.collection(DATASETS).where({ active: true }).orderBy('importedAt', 'desc').limit(1).get();
      const dataset = active.data?.[0];
      if (!dataset) return res.status(503).json({ ok: false, error: 'dataset_not_ready' });
      const found = await db.collection(TEACHERS).where({
        datasetId: dataset.datasetId,
        nameKey: db.RegExp({ regexp: escapeRegExp(query), options: 'i' })
      }).limit(12).get();
      const teachers = teacherChoices(found.data || []).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
      return res.json({ ok: true, teachers });
    } catch (error) { next(error); }
  });

  router.post('/api/start', async (req, res, next) => {
    try {
      if (!allowedOrigins.includes(req.headers.origin)) return res.status(403).json({ ok: false, error: 'origin_not_allowed' });
      const active = await db.collection(DATASETS).where({ active: true }).orderBy('importedAt', 'desc').limit(1).get();
      const dataset = active.data?.[0];
      if (!dataset) return res.status(503).json({ ok: false, error: 'dataset_not_ready' });
      const teacherId = String(req.body?.teacherId || '').trim();
      let teacher;
      if (teacherId) {
        const selected = await db.collection(TEACHERS).doc(teacherId).get();
        teacher = selected.data?.[0] || selected.data;
        if (!teacher || teacher.datasetId !== dataset.datasetId) return res.status(404).json({ ok: false, error: 'teacher_not_found' });
        teacher._id ||= teacherId;
      } else {
        const name = String(req.body?.name || '').normalize('NFKC').trim();
        const nameKey = normalizeName(name);
        if (!nameKey || name.length > 40) return res.status(400).json({ ok: false, error: 'name_required' });
        const found = await db.collection(TEACHERS).where({ datasetId: dataset.datasetId, nameKey }).limit(3).get();
        if (!found.data?.length) return res.status(404).json({ ok: false, error: 'teacher_not_found' });
        if (found.data.length !== 1 || found.data[0].duplicateName) return res.status(409).json({ ok: false, error: 'duplicate_teacher_name' });
        teacher = found.data[0];
      }
      const existing = await db.collection(SESSIONS).where({ teacherId: teacher._id, datasetId: dataset.datasetId, status: 'active' }).orderBy('startedAt', 'desc').limit(1).get();
      let session = existing.data?.[0];
      if (!session) {
        const now = Date.now();
        session = { sessionId: crypto.randomUUID(), teacherId: teacher._id, datasetId: dataset.datasetId, status: 'active', startedAt: now, deadlineAt: now + INTERVIEW_DURATION_MS, turnCount: 0, messages: [], version: VERSION };
        const added = await db.collection(SESSIONS).add({ data: session });
        session._id = added._id || added.id;
      }
      const token = signSession({ sessionId: session.sessionId, teacherId: teacher._id, exp: Date.now() + 2 * 60 * 60 * 1000 }, sessionSecret);
      res.append('Set-Cookie', cookie(token));
      return res.json(publicSession(session, teacher));
    } catch (error) { next(error); }
  });

  router.get('/api/session', async (req, res, next) => {
    try {
      const state = await currentSession(req);
      if (!state) return res.status(401).json({ ok: false, error: 'session_not_found' });
      return res.json(publicSession(state.session, state.teacher));
    } catch (error) { next(error); }
  });

  router.post('/api/turn', async (req, res, next) => {
    try {
      if (!allowedOrigins.includes(req.headers.origin)) return res.status(403).json({ ok: false, error: 'origin_not_allowed' });
      const state = await currentSession(req);
      if (!state) return res.status(401).json({ ok: false, error: 'session_not_found' });
      const { session, teacher } = state;
      if (session.status !== 'active') return res.json(publicSession(session, teacher));
      const message = String(req.body?.message || '').normalize('NFKC').trim().slice(0, 4000);
      const messages = [...(session.messages || [])];
      const requestId = String(req.body?.requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || crypto.randomUUID();
      const priorAnswer = messages.find((entry) => entry.role === 'ai' && entry.meta?.requestId === requestId);
      if (priorAnswer) return res.json({
        ok: true,
        visibleText: priorAnswer.text,
        done: session.status === 'done',
        turnCount: session.turnCount || 0,
        deadlineAt: session.deadlineAt,
        itemContext: itemContext(teacher, priorAnswer.meta?.itemIds)
      });
      if (message && !messages.some((entry) => entry.role === 'teacher' && entry.meta?.requestId === requestId)) messages.push({ role: 'teacher', text: message, at: Date.now(), meta: { requestId } });
      if (!message && messages.length) return res.status(400).json({ ok: false, error: 'message_required' });
      const elapsedMs = Date.now() - session.startedAt;
      const payload = {
        sessionId: session.sessionId,
        teacherName: teacher.name,
        items: teacher.items,
        messages,
        turnCount: session.turnCount || 0,
        elapsedMs,
        remainingMs: Math.max(0, session.deadlineAt - Date.now())
      };
      const invokeStartedAt = Date.now();
      const called = await invoke({ name: 'gsyg_overallInterview', data: { operation: 'turn', payload, __gsygGateway: { token: gatewayToken, actor: `web:overall_${crypto.createHash('sha256').update(session.sessionId).digest('hex').slice(0, 24)}`, identityType: 'web_account' } } });
      const result = called?.result || called;
      if (!result?.ok || !result.visibleText) {
        console.warn('[overall] turn_upstream_failed', JSON.stringify({ elapsedMs: Date.now() - invokeStartedAt, turnCount: session.turnCount || 0, error: result?.error || 'interview_generation_failed' }));
        return res.status(502).json({ ok: false, error: result?.error || 'interview_generation_failed' });
      }
      messages.push({ role: 'ai', text: result.visibleText, at: Date.now(), meta: { focus: result.focus || '', itemIds: result.itemIds || [], model: result.model || '', modelLatencyMs: result.latencyMs || 0, requestId } });
      const done = Boolean(result.done) || Date.now() >= session.deadlineAt;
      const turnCount = (session.turnCount || 0) + 1;
      await db.collection(SESSIONS).doc(session._id).update({ data: { messages, turnCount, status: done ? 'done' : 'active', updatedAt: Date.now(), ...(done ? { completedAt: Date.now() } : {}) } });
      return res.json({ ok: true, visibleText: result.visibleText, done, turnCount, deadlineAt: session.deadlineAt, itemContext: itemContext(teacher, result.itemIds) });
    } catch (error) { next(error); }
  });

  router.post('/api/logout', async (_req, res) => {
    res.append('Set-Cookie', cookie('', 0));
    return res.json({ ok: true });
  });

  router.use((error, _req, res, _next) => {
    console.error('[overall]', error?.message || error);
    return res.status(500).json({ ok: false, error: 'overall_internal_error' });
  });
  return router;
}

module.exports = { createOverallRouter, VERSION, INTERVIEW_DURATION_MS, verifySession, teacherChoices, itemContext };
