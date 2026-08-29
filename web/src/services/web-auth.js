import { cloudbaseConfigured, getCloudAuth } from './cloudbase.js'
import { createGatewaySession, getGatewaySession, clearGatewaySession } from './web-gateway.js'
import { activateLocalAccount } from './storage.js'

const localResearchMode = String(import.meta.env.VITE_LOCAL_RESEARCH_MODE || '').trim() === '1'
const localResearchUid = 'tcim-local-research'

function localResearchSession() {
  activateLocalAccount(localResearchUid)
  return {
    ok: true,
    local: true,
    user: { uid: localResearchUid, identityType: 'web_account' }
  }
}

function notifyAuthState(state) {
  window.dispatchEvent(new CustomEvent('gsyg:web-auth-changed', { detail: { state } }))
}

function isAnonymousLogin(scope, state) {
  const loginType = String(state?.user?.loginType || state?.user?.login_type || '').toLowerCase()
  return scope === 'anonymous' || loginType.includes('anonymous')
}

let pendingRegistration = null
let pendingPasswordReset = null

async function finishAccountLogin(auth, authResult = null) {
  const tokenResult = await auth.getAccessToken()
  if (!tokenResult?.accessToken) return { ok: false, error: 'account_login_failed' }
  const session = await createGatewaySession(tokenResult.accessToken)
  if (!session.ok) {
    await auth.signOut().catch(() => {})
    return session
  }
  const state = await auth.getLoginState().catch(() => null)
  const uid = String(authResult?.data?.user?.uid || state?.user?.uid || '').trim()
  if (!uid) {
    await clearGatewaySession().catch(() => {})
    await auth.signOut().catch(() => {})
    return { ok: false, error: 'account_login_failed' }
  }
  activateLocalAccount(uid)
  notifyAuthState('signed_in')
  return session
}

async function getExistingAccountSession() {
  const auth = getCloudAuth()
  const [scope, state] = await Promise.all([
    auth.loginScope().catch(() => ''),
    auth.getLoginState().catch(() => null)
  ])
  if (!state?.user || isAnonymousLogin(scope, state)) {
    if (state?.user || scope === 'anonymous') await auth.signOut().catch(() => {})
    return null
  }
  const tokenResult = await auth.getAccessToken()
  const uid = String(state.user.uid || '').trim()
  return tokenResult?.accessToken && uid ? { accessToken: tokenResult.accessToken, uid } : null
}

/** 仅恢复已经登录的正式账号；不会自动创建匿名身份。 */
export async function ensureWebLogin() {
  if (localResearchMode) {
    const session = localResearchSession()
    notifyAuthState('signed_in')
    return session
  }
  if (!cloudbaseConfigured) return { ok: false, error: 'cloudbase_auth_not_configured' }

  const gatewaySession = await getGatewaySession()
  if (gatewaySession.ok && gatewaySession.user?.identityType === 'web_account') {
    const state = await getCloudAuth().getLoginState().catch(() => null)
    if (state?.user?.uid) activateLocalAccount(state.user.uid)
    notifyAuthState('signed_in')
    return gatewaySession
  }

  let accountSession = null
  try {
    accountSession = await getExistingAccountSession()
  } catch {
    return { ok: false, error: 'account_session_invalid' }
  }
  if (!accountSession) return { ok: false, error: 'account_login_required' }

  const session = await createGatewaySession(accountSession.accessToken)
  if (session.ok) {
    activateLocalAccount(accountSession.uid)
    notifyAuthState('signed_in')
  }
  return session
}

export async function signInWebUser(account, password) {
  if (localResearchMode) return localResearchSession()
  if (!cloudbaseConfigured) return { ok: false, error: 'cloudbase_auth_not_configured' }
  const username = String(account || '').trim()
  if (!username || !password) return { ok: false, error: 'account_and_password_required' }

  const auth = getCloudAuth()
  await clearGatewaySession().catch(() => {})
  await auth.signOut().catch(() => {})

  try {
    const credentials = username.includes('@') ? { email: username.toLowerCase(), password } : { username, password }
    const result = await auth.signInWithPassword(credentials)
    if (result?.error) return { ok: false, error: 'invalid_account_or_password' }
    return finishAccountLogin(auth, result)
  } catch {
    return { ok: false, error: 'invalid_account_or_password' }
  }
}

export async function beginWebRegistration({ username, email, password }) {
  if (!cloudbaseConfigured) return { ok: false, error: 'cloudbase_auth_not_configured' }
  const account = String(username || '').trim()
  const mailbox = String(email || '').trim().toLowerCase()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:+@-]{4,23}$/.test(account)) {
    return { ok: false, error: 'invalid_registration_username' }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailbox)) return { ok: false, error: 'invalid_registration_email' }
  if (String(password || '').length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return { ok: false, error: 'weak_registration_password' }
  }

  const auth = getCloudAuth()
  await clearGatewaySession().catch(() => {})
  await auth.signOut().catch(() => {})
  pendingRegistration = null
  try {
    const result = await auth.signUp({ username: account, email: mailbox, password })
    if (result?.error) {
      const code = String(result.error.code || '')
      if (/already|exist|registered/i.test(code)) return { ok: false, error: 'registration_account_exists' }
      return { ok: false, error: 'registration_send_failed' }
    }
    const verifyOtp = result?.data?.verifyOtp
    if (typeof verifyOtp !== 'function') return { ok: false, error: 'registration_send_failed' }
    pendingRegistration = { auth, verifyOtp, email: mailbox }
    return { ok: true, email: mailbox }
  } catch {
    return { ok: false, error: 'registration_send_failed' }
  }
}

export async function completeWebRegistration(code) {
  const token = String(code || '').trim()
  if (!pendingRegistration) return { ok: false, error: 'registration_expired' }
  if (!/^\d{4,8}$/.test(token)) return { ok: false, error: 'invalid_verification_code' }
  try {
    const result = await pendingRegistration.verifyOtp({ token })
    if (result?.error) return { ok: false, error: 'invalid_verification_code' }
    const auth = pendingRegistration.auth
    pendingRegistration = null
    return finishAccountLogin(auth, result)
  } catch {
    return { ok: false, error: 'invalid_verification_code' }
  }
}

export async function beginPasswordReset(email) {
  if (!cloudbaseConfigured) return { ok: false, error: 'cloudbase_auth_not_configured' }
  const mailbox = String(email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailbox)) return { ok: false, error: 'invalid_reset_email' }

  const auth = getCloudAuth()
  await clearGatewaySession().catch(() => {})
  await auth.signOut().catch(() => {})
  pendingPasswordReset = null
  try {
    const result = await auth.resetPasswordForEmail(mailbox)
    if (result?.error || typeof result?.data?.updateUser !== 'function') {
      return { ok: false, error: 'password_reset_send_failed' }
    }
    pendingPasswordReset = { auth, updateUser: result.data.updateUser, email: mailbox }
    return { ok: true, email: mailbox }
  } catch {
    return { ok: false, error: 'password_reset_send_failed' }
  }
}

export async function completePasswordReset({ code, password }) {
  const token = String(code || '').trim()
  if (!pendingPasswordReset) return { ok: false, error: 'password_reset_expired' }
  if (!/^\d{4,8}$/.test(token)) return { ok: false, error: 'invalid_reset_code' }
  if (String(password || '').length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return { ok: false, error: 'weak_registration_password' }
  }
  try {
    const result = await pendingPasswordReset.updateUser({ nonce: token, password })
    if (result?.error) return { ok: false, error: 'invalid_reset_code' }
    const auth = pendingPasswordReset.auth
    pendingPasswordReset = null
    return finishAccountLogin(auth, result)
  } catch {
    return { ok: false, error: 'invalid_reset_code' }
  }
}

export async function getWebLoginState() {
  if (localResearchMode) return localResearchSession()
  if (!cloudbaseConfigured) return { ok: false, error: 'cloudbase_auth_not_configured' }
  return getGatewaySession()
}

/** 业务动作的兜底：会话失效时只恢复正式账号，不创建匿名账号。 */
export async function requireWebLogin() {
  const session = await ensureWebLogin()
  if (!session.ok) notifyAuthState('signed_out')
  return Boolean(session.ok)
}

export async function signOutWebUser() {
  if (localResearchMode) {
    notifyAuthState('signed_out')
    return { ok: true, local: true }
  }
  const gatewayResult = await clearGatewaySession()
  let cloudbaseSignedOut = true
  try {
    await getCloudAuth().signOut()
  } catch {
    cloudbaseSignedOut = false
  }
  if (!gatewayResult.ok || !cloudbaseSignedOut) return { ok: false, error: 'web_logout_failed' }
  notifyAuthState('signed_out')
  return { ok: true }
}
