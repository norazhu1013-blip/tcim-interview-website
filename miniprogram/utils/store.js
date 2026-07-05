/**
 * 本地存储层（wx.setStorageSync）。除 api.js 的 3 个上报接口外，所有数据都存本地。
 *
 * 数据结构：
 *   profile        教师信息 { name, kindergarten, grade, teachAge, paperCode, wxOpenId? }
 *   sessions       sessionId 列表（按创建时间倒序）
 *   session:<id>   单次答题会话对象（见 createSession 注释）
 */

const KEY_PROFILE = 'profile';
const KEY_SESSION_IDS = 'session_ids';
const sessionKey = (id) => 'session:' + id;

/* ---------------- 教师信息 ---------------- */
function saveProfile(profile) {
  wx.setStorageSync(KEY_PROFILE, profile);
  return profile;
}
function getProfile() {
  return wx.getStorageSync(KEY_PROFILE) || null;
}

/* ---------------- 登录态（微信手机号授权） ---------------- */
// 登录 = 本地存在手机号。手机号存本地，profile 保存时随 gsyg_reportTeacher 一并上报。
const KEY_LOGIN = 'login_state';
/**
 * 保存手机号登录态。
 * @param {object} info { phone, openId }
 */
function saveLogin(info) {
  info = info || {};
  const state = { phoneAuthed: true, phone: info.phone || '', openId: info.openId || '', ts: Date.now() };
  wx.setStorageSync(KEY_LOGIN, state);
  // 若已有 profile，顺带并入手机号，便于后续上报
  if (state.phone) {
    const p = getProfile();
    if (p) { p.phone = state.phone; saveProfile(p); }
  }
  return state;
}
function getLogin() {
  return wx.getStorageSync(KEY_LOGIN) || null;
}
// 取本地手机号：优先登录态，其次已保存的 profile。
function getPhone() {
  const s = getLogin();
  if (s && s.phone) return s.phone;
  const p = getProfile();
  return (p && p.phone) || '';
}
// 登录判断 = 本地已有登录态(用户已授权)。有换号权限则 phone 非空;无权限(如 -604101)则忽略手机号仍算登录。
function isLoggedIn() {
  const s = getLogin();
  return !!(s && s.phoneAuthed);
}
/**
 * 非登录页守卫：本地无手机号则跳转登录页。返回是否已登录。
 * 用法（页面 onShow/onLoad 顶部）：if (!requireLogin()) return;
 */
function requireLogin() {
  if (isLoggedIn()) return true;
  wx.reLaunch({ url: '/pages/login/login' });
  return false;
}

/* ---------------- 会话（答题记录） ---------------- */
/**
 * 创建一次答题会话。sessionId 为前端生成的 UUID，作为记录主键。
 * @param {object} extra 额外初始化字段（如 paperCode）
 */
function createSession(sessionId, extra) {
  const now = Date.now();
  const session = Object.assign(
    {
      sessionId: sessionId,
      createdAt: now,
      dateText: formatDate(now),
      status: 'in_progress', // in_progress | submitted | timeout_submitted
      profileSnapshot: getProfile(),
      dataVersion: 'DOC-10题', // 绑定当时数据 version 以复现历史
      answers: {}, // itemId -> { final_ranking, first_ranking, first_response_option, duration_ms, revise_count, move_log, enter_ts, submit_ts, focus_dwell }
      examStartTs: null, // 首次进入答题的时间戳
      examSubmitTs: null, // 提交时间戳
      totalExamMs: 0, // 整卷总用时 = examSubmitTs - examStartTs
      submittedAt: null,
      scores: null, // { perItem:{Q1:4}, total, mean, rd:{Q1:+0.3}, level }
      selection: null, // { final:[{id,sec,ter,rd,pivi,tags,sources}], routes }
      interview: {} // itemId -> { status:'pending'|'done', startedAt, submittedAt, turns:[{role,text,ts,E?}], ledger:[E..], coding }
    },
    extra || {}
  );
  saveSession(session);
  // 记入 id 列表（去重、置顶）
  const ids = getSessionIds().filter((x) => x !== sessionId);
  ids.unshift(sessionId);
  wx.setStorageSync(KEY_SESSION_IDS, ids);
  return session;
}

function saveSession(session) {
  if (!session || !session.sessionId) return;
  wx.setStorageSync(sessionKey(session.sessionId), session);
}

function getSession(sessionId) {
  return wx.getStorageSync(sessionKey(sessionId)) || null;
}

function getSessionIds() {
  return wx.getStorageSync(KEY_SESSION_IDS) || [];
}

function listSessions() {
  return getSessionIds()
    .map((id) => getSession(id))
    .filter(Boolean);
}

function deleteSession(sessionId) {
  wx.removeStorageSync(sessionKey(sessionId));
  const ids = getSessionIds().filter((x) => x !== sessionId);
  wx.setStorageSync(KEY_SESSION_IDS, ids);
}

/* ---------------- 访谈 ---------------- */
function saveInterview(sessionId, itemId, interviewObj) {
  const s = getSession(sessionId);
  if (!s) return null;
  s.interview = s.interview || {};
  s.interview[itemId] = interviewObj;
  saveSession(s);
  return s;
}

/* ---------------- 工具 ---------------- */
function formatDate(ts) {
  const d = new Date(ts);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

module.exports = {
  saveProfile,
  getProfile,
  saveLogin,
  getLogin,
  getPhone,
  isLoggedIn,
  requireLogin,
  createSession,
  saveSession,
  getSession,
  getSessionIds,
  listSessions,
  deleteSession,
  saveInterview,
  formatDate
};
