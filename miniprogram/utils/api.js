/**
 * 后端上报封装（仅 3 个上报）。后端 = 微信云开发 CloudBase「云函数 + 云数据库」。
 * 客户端**不直连数据库**，改为调用云函数（gsyg_ 前缀）；云函数内部用 wx-server-sdk 拿 openid
 * 并读写对应集合，权限在服务端控制。
 *
 * 本地优先、上报不阻塞：调用方先写本地 storage 成功（保证可用），再异步 callFunction；
 * 失败进本地待重传队列（pendingReports），try/catch 不 throw、绝不阻塞用户流程。
 * 若基础库不支持 wx.cloud 或云环境未初始化，优雅降级为“只存本地 + 记 pending”，不报错。
 *
 * 3 个上报（云函数）：
 *   1) reportProfile   完善信息时   → gsyg_reportTeacher   → 集合 gsyg_teachers
 *   2) reportExam      答题结束后   → gsyg_reportSession   → 集合 gsyg_sessions
 *   3) reportInterview 访谈结束后   → gsyg_reportInterview → 集合 gsyg_interviews
 */
const { CLOUD_FUNCTIONS } = require('./config.js');

const PENDING_KEY = 'pendingReports'; // 待重传队列

/* ---------------- 云能力可用性 ---------------- */
function cloudReady() {
  if (!wx.cloud) return false;
  try {
    const app = getApp();
    return !app || !app.globalData || app.globalData.cloudReady !== false;
  } catch (e) {
    return true;
  }
}

/* ---------------- 待重传队列 ---------------- */
function pushPending(name, data) {
  try {
    const q = wx.getStorageSync(PENDING_KEY) || [];
    q.push({ name: name, data: data, ts: Date.now() });
    wx.setStorageSync(PENDING_KEY, q);
  } catch (e) {
    // 存储失败也不抛
  }
}

/**
 * 调用云函数。始终 resolve（{ ok, data?|error }），从不 reject。
 * 失败自动进待重传队列。
 */
function callCloud(name, data) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };

    if (!cloudReady()) {
      pushPending(name, data);
      return done({ ok: false, error: 'cloud_unavailable' });
    }

    try {
      wx.cloud.callFunction({
        name: name,
        data: data,
        success: (res) => {
          // 云函数约定返回 { ok:true, id } 或 { ok:false }
          const r = res && res.result;
          if (r && r.ok) done({ ok: true, data: r });
          else { pushPending(name, data); done({ ok: false, error: (r && r.error) || 'cf_fail' }); }
        },
        fail: (err) => {
          pushPending(name, data);
          done({ ok: false, error: (err && err.errMsg) || 'callFunction_fail' });
        }
      });
    } catch (e) {
      pushPending(name, data);
      done({ ok: false, error: 'exception' });
    }
  });
}

/* ---------------- 3 个业务上报 ---------------- */
function reportProfile(profile) {
  return callCloud(CLOUD_FUNCTIONS.reportTeacher, { profile: profile });
}

function reportExam(payload) {
  // payload: { sessionId, profile, answers, scores, selection, submitStatus, examStartTs, examSubmitTs, totalExamMs }
  const answers = payload.answers || {};
  // 每题用时 items[].durationMs（时间用于 P-IVI/筛选与后续分析；评分不依赖时间）
  const items = Object.keys(answers).map((itemId) => ({
    itemId: itemId,
    durationMs: answers[itemId].duration_ms || 0,
    enterTs: answers[itemId].enter_ts || null,
    submitTs: answers[itemId].submit_ts || null
  }));
  return callCloud(CLOUD_FUNCTIONS.reportSession, {
    sessionId: payload.sessionId,
    profile: payload.profile || null,
    answers: answers,
    scores: payload.scores || null,
    total: payload.scores ? payload.scores.total : null,
    selection: payload.selection || null,
    submitStatus: payload.submitStatus || null,
    // 时间字段
    items: items,
    examStartTs: payload.examStartTs || null,
    examSubmitTs: payload.examSubmitTs || null,
    totalDurationMs: payload.totalExamMs || 0
  });
}

function reportInterview(payload) {
  // payload: { sessionId, itemId?, interviews }
  return callCloud(CLOUD_FUNCTIONS.reportInterview, {
    sessionId: payload.sessionId,
    transcripts: payload.interviews || null
  });
}

/* ---------------- 重传（app.onShow 调用） ---------------- */
function flushPending() {
  const q = wx.getStorageSync(PENDING_KEY) || [];
  if (!q.length) return Promise.resolve({ flushed: 0 });
  if (!cloudReady()) return Promise.resolve({ flushed: 0 });
  const rest = [];
  const tasks = q.map((job) =>
    callCloud(job.name, job.data).then((r) => { if (!r.ok) rest.push(job); })
  );
  return Promise.all(tasks).then(() => {
    try { wx.setStorageSync(PENDING_KEY, rest); } catch (e) {}
    return { flushed: q.length - rest.length };
  });
}

/**
 * 拉自己的身份：openid + isAdmin + teacher。失败/离线返回 null。
 * 不进 pendingReports 队列（只读，不重传）。
 */
function whoami() {
  return new Promise((resolve) => {
    if (!cloudReady()) return resolve(null);
    try {
      wx.cloud.callFunction({
        name: CLOUD_FUNCTIONS.whoami,
        data: {},
        success: (res) => {
          const r = res && res.result;
          resolve(r && r.ok ? r : null);
        },
        fail: () => resolve(null)
      });
    } catch (e) { resolve(null); }
  });
}

/**
 * 管理员导出全表。event 可选传 { collections, since }。
 * 返回 { ok, downloadURL, ... } 或 null（离线/失败）。60s 超时保护。
 */
function exportData(payload) {
  return new Promise((resolve) => {
    if (!cloudReady()) return resolve(null);
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    const timer = setTimeout(() => done(null), 60000);
    try {
      wx.cloud.callFunction({
        name: CLOUD_FUNCTIONS.exportData,
        data: payload || {},
        success: (res) => { clearTimeout(timer); done((res && res.result) || null); },
        fail: () => { clearTimeout(timer); done(null); }
      });
    } catch (e) { clearTimeout(timer); done(null); }
  });
}

module.exports = { reportProfile, reportExam, reportInterview, flushPending, cloudReady, whoami, exportData };
