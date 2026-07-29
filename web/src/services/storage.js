const PROFILE_KEY = 'gsyg:web:profile'
const SESSION_IDS_KEY = 'gsyg:web:session_ids'
const SESSION_PREFIX = 'gsyg:web:session:'

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

export function formatDate(ts) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(new Date(ts))
}
