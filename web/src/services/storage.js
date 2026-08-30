import { currentReleaseSnapshot } from '../core/release.js'

const PROFILE_KEY = 'gsyg:web:profile'
const SESSION_IDS_KEY = 'gsyg:web:session_ids'
const SESSION_PREFIX = 'gsyg:web:session:'
const ACCOUNT_ARCHIVE_PREFIX = 'gsyg:web:account_archive:'
const ACCOUNT_DATA_PREFIX = 'gsyg:web:account_data:'
const ACTIVE_ACCOUNT_KEY = 'gsyg:web:active_account_uid'

function read(key, fallback = null) {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function getProfile() {
  return read(PROFILE_KEY, null)
}

export function isProfileComplete(profile = getProfile()) {
  return Boolean(
    String(profile?.name || '').trim() &&
    String(profile?.kindergarten || '').trim() &&
    String(profile?.teachingYears || '').trim()
  )
}

export function saveProfile(profile) {
  write(PROFILE_KEY, profile)
  return profile
}

export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createSession(dataVersion, options = {}) {
  const sessionId = uuid()
  const now = Date.now()
  const session = {
    sessionId,
    dataVersion,
    studyMode: options.studyMode || 'full_assessment',
    targetItemId: options.targetItemId || null,
    releaseSnapshot: currentReleaseSnapshot(now),
    status: 'in_progress',
    answers: {},
    interview: {},
    createdAt: now,
    updatedAt: now
  }
  const ids = read(SESSION_IDS_KEY, [])
  write(SESSION_IDS_KEY, [sessionId, ...ids.filter((id) => id !== sessionId)])
  saveSession(session)
  return session
}

export function getSession(sessionId) {
  return read(SESSION_PREFIX + sessionId, null)
}

export function saveSession(session) {
  const next = { ...session, updatedAt: Date.now() }
  write(SESSION_PREFIX + session.sessionId, next)
  const ids = read(SESSION_IDS_KEY, [])
  if (!ids.includes(session.sessionId)) write(SESSION_IDS_KEY, [session.sessionId, ...ids])
  return next
}

export function listSessions() {
  return read(SESSION_IDS_KEY, []).map(getSession).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt)
}

export function deleteSession(sessionId) {
  localStorage.removeItem(SESSION_PREFIX + sessionId)
  write(SESSION_IDS_KEY, read(SESSION_IDS_KEY, []).filter((id) => id !== sessionId))
}

function clearActiveLocalData() {
  localStorage.removeItem(PROFILE_KEY)
  localStorage.removeItem(SESSION_IDS_KEY)
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)
    if (key && key.startsWith(SESSION_PREFIX)) localStorage.removeItem(key)
  }
}

function captureActiveLocalData() {
  const sessionIds = read(SESSION_IDS_KEY, [])
  return {
    profile: read(PROFILE_KEY, null),
    sessionIds,
    sessions: sessionIds.map(getSession).filter(Boolean)
  }
}

function hasLocalData(snapshot) {
  return Boolean(snapshot?.profile || snapshot?.sessions?.length)
}

function restoreLocalData(snapshot) {
  if (!snapshot) return
  if (snapshot.profile) write(PROFILE_KEY, snapshot.profile)
  const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : []
  const sessionIds = Array.isArray(snapshot.sessionIds) ? snapshot.sessionIds : sessions.map((item) => item.sessionId)
  write(SESSION_IDS_KEY, sessionIds)
  sessions.forEach((session) => write(SESSION_PREFIX + session.sessionId, session))
}

/** 切换正式账号时保存旧账号活动区并恢复目标账号，杜绝同一浏览器串号。 */
export function activateLocalAccount(uid) {
  const nextUid = String(uid || '').trim()
  if (!nextUid) return
  const currentUid = String(localStorage.getItem(ACTIVE_ACCOUNT_KEY) || '')
  if (currentUid === nextUid) return

  const currentData = captureActiveLocalData()
  if (hasLocalData(currentData)) {
    if (currentUid) write(ACCOUNT_DATA_PREFIX + currentUid, currentData)
    else write(`${ACCOUNT_ARCHIVE_PREFIX}legacy-${Date.now()}`, { ...currentData, archivedAt: Date.now(), source: 'legacy_anonymous' })
  }
  clearActiveLocalData()
  localStorage.setItem(ACTIVE_ACCOUNT_KEY, nextUid)
  restoreLocalData(read(ACCOUNT_DATA_PREFIX + nextUid, null))
  window.dispatchEvent(new CustomEvent('gsyg:local-data-changed'))
}

/**
 * 退出但保留本机记录：按正式账号保存后清空活动区；同一账号再次登录可恢复。
 */
export function archiveLocalDataForLogout() {
  const uid = String(localStorage.getItem(ACTIVE_ACCOUNT_KEY) || '')
  const data = captureActiveLocalData()
  if (hasLocalData(data)) {
    if (uid) write(ACCOUNT_DATA_PREFIX + uid, data)
    write(`${ACCOUNT_ARCHIVE_PREFIX}${Date.now()}`, {
      archivedAt: Date.now(),
      accountUid: uid || null,
      ...data
    })
  }
  clearActiveLocalData()
  localStorage.removeItem(ACTIVE_ACCOUNT_KEY)
  window.dispatchEvent(new CustomEvent('gsyg:local-data-changed'))
}

/** 退出并清除本机资料、活动记录及此前归档。 */
export function clearAllLocalDataForLogout() {
  clearActiveLocalData()
  localStorage.removeItem(ACTIVE_ACCOUNT_KEY)
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)
    if (key && (key.startsWith(ACCOUNT_ARCHIVE_PREFIX) || key.startsWith(ACCOUNT_DATA_PREFIX))) localStorage.removeItem(key)
  }
  window.dispatchEvent(new CustomEvent('gsyg:local-data-changed'))
}

export function formatDate(ts) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(new Date(ts))
}
