const PROFILE_KEY = 'gsyg:web:profile'
const SESSION_IDS_KEY = 'gsyg:web:session_ids'
const SESSION_PREFIX = 'gsyg:web:session:'
const ACCOUNT_ARCHIVE_PREFIX = 'gsyg:web:account_archive:'

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

export function saveProfile(profile) {
  write(PROFILE_KEY, profile)
  return profile
}

export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createSession(dataVersion) {
  const sessionId = uuid()
  const now = Date.now()
  const session = {
    sessionId,
    dataVersion,
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

/**
 * 退出但保留本机记录：把当前账号的数据归档后清空活动区，避免新匿名账号
 * 直接看见上一位教师的资料和测评记录。
 */
export function archiveLocalDataForLogout() {
  const sessionIds = read(SESSION_IDS_KEY, [])
  const profile = read(PROFILE_KEY, null)
  const sessions = sessionIds.map(getSession).filter(Boolean)
  if (profile || sessions.length) {
    write(`${ACCOUNT_ARCHIVE_PREFIX}${Date.now()}`, {
      archivedAt: Date.now(),
      profile,
      sessionIds,
      sessions
    })
  }
  clearActiveLocalData()
  window.dispatchEvent(new CustomEvent('gsyg:local-data-changed'))
}

/** 退出并清除本机资料、活动记录及此前归档。 */
export function clearAllLocalDataForLogout() {
  clearActiveLocalData()
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)
    if (key && key.startsWith(ACCOUNT_ARCHIVE_PREFIX)) localStorage.removeItem(key)
  }
  window.dispatchEvent(new CustomEvent('gsyg:local-data-changed'))
}

export function formatDate(ts) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(new Date(ts))
}
