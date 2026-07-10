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
// 登录 = profile 已填(至少有姓名)。不再依赖手机号授权(据 2026-07-09 建议改)。
// 兼容存量:老用户 phoneAuthed=true 也视为已登录。
function isLoggedIn() {
  const p = getProfile();
  if (p && p.name && String(p.name).trim()) return true;
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
/**
 * 交互式登录守卫:未填 profile 时弹窗提示,用户点「去完善」跳「我的」;取消原地不动。
 * 用于按钮点击(开始答题、提交、访谈)。
 * @param {string} hint 弹窗正文提示,说明为什么需要个人信息
 * @returns {boolean} 已填 profile 返回 true;未填返回 false 且弹窗已发起
 */
function requireLoginWithPrompt(hint) {
  if (isLoggedIn()) return true;
  wx.showModal({
    title: '请先完善个人信息',
    content: hint || '需要先在「我的」填写姓名、园所、教龄后才能开始测评',
    confirmText: '去完善',
    cancelText: '取消',
    success: (r) => {
      if (r.confirm) wx.switchTab({ url: '/pages/profile/profile' });
    }
  });
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

/* ---------------- 遴选(服务端 advisor 返回后落地) ---------------- */
/**
 * 把云函数 gsyg_selectFinal 返回的 selection 存到本地 session,并按 final 初始化 interview 占位。
 * 已有相同 algo/normsVersion 的 selection 时不覆盖。
 */
function saveSelection(sessionId, selection) {
  const s = getSession(sessionId);
  if (!s || !selection) return null;
  const cur = s.selection;
  const same = cur && cur.algo === selection.algo && cur.normsVersion === selection.normsVersion;
  if (!same) s.selection = selection;
  s.interview = s.interview || {};
  (selection.final || []).forEach((f) => {
    if (!s.interview[f.id]) s.interview[f.id] = { status: 'pending' };
  });
  saveSession(s);
  return s;
}

/** session 是否已经完成服务端遴选(algo 以 advisor_v 开头即可)。 */
function hasFinalSelection(session) {
  return !!(
    session && session.selection
    && typeof session.selection.algo === 'string' && session.selection.algo.indexOf('advisor_v') === 0
    && session.selection.final && session.selection.final.length
    // v1.1+ 必须有 teacherFinalOrder,老 v1 缺失会视为未完成 → 触发重拉
    && session.selection.final[0] && session.selection.final[0].teacherFinalOrder
  );
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
  requireLoginWithPrompt,
  createSession,
  saveSession,
  getSession,
  getSessionIds,
  listSessions,
  deleteSession,
  saveInterview,
  saveSelection,
  hasFinalSelection,
  formatDate
};
