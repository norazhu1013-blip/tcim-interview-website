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
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

module.exports = {
  saveProfile,
  getProfile,
  createSession,
  saveSession,
  getSession,
  getSessionIds,
  listSessions,
  deleteSession,
  saveInterview,
  formatDate
};
