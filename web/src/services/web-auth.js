import { cloudbaseConfigured, getCloudAuth } from './cloudbase.js'
import { createGatewaySession, getGatewaySession, clearGatewaySession } from './web-gateway.js'

function notifyAuthState(state) {
  window.dispatchEvent(new CustomEvent('gsyg:web-auth-changed', { detail: { state } }))
}

function isAnonymousLogin(scope, state) {
  const loginType = String(state?.user?.loginType || state?.user?.login_type || '').toLowerCase()
  return scope === 'anonymous' || loginType.includes('anonymous')
}

async function getExistingAccountAccessToken() {
  const auth = getCloudAuth()
  const [scope, state] = await Promise.all([
    auth.loginScope().catch(() => ''),
    auth.getLoginState().catch(() => null)
  ])
  if (!state?.user || isAnonymousLogin(scope, state)) {
    if (state?.user || scope === 'anonymous') await auth.signOut().catch(() => {})
    return ''
  }
  const tokenResult = await auth.getAccessToken()
  return tokenResult?.accessToken || ''
}

/** 仅恢复已经登录的正式账号；不会自动创建匿名身份。 */
export async function ensureWebLogin() {
  if (!cloudbaseConfigured) return { ok: false, error: 'cloudbase_auth_not_configured' }

  const gatewaySession = await getGatewaySession()
  if (gatewaySession.ok && gatewaySession.user?.identityType === 'web_account') {
    notifyAuthState('signed_in')
    return gatewaySession
  }

  let accessToken = ''
  try {
    accessToken = await getExistingAccountAccessToken()
  } catch {
    return { ok: false, error: 'account_session_invalid' }
  }
  if (!accessToken) return { ok: false, error: 'account_login_required' }

  const session = await createGatewaySession(accessToken)
  if (session.ok) notifyAuthState('signed_in')
  return session
}

export async function signInWebUser(account, password) {
  if (!cloudbaseConfigured) return { ok: false, error: 'cloudbase_auth_not_configured' }
  const username = String(account || '').trim()
  if (!username || !password) return { ok: false, error: 'account_and_password_required' }

  const auth = getCloudAuth()
  await clearGatewaySession().catch(() => {})
  await auth.signOut().catch(() => {})

  try {
    const result = await auth.signInWithPassword({ username, password })
    if (result?.error) return { ok: false, error: 'invalid_account_or_password' }
    const tokenResult = await auth.getAccessToken()
    if (!tokenResult?.accessToken) return { ok: false, error: 'account_login_failed' }
    const session = await createGatewaySession(tokenResult.accessToken)
    if (!session.ok) {
      await auth.signOut().catch(() => {})
      return session
    }
    notifyAuthState('signed_in')
    return session
  } catch {
    return { ok: false, error: 'invalid_account_or_password' }
  }
}

export async function getWebLoginState() {
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
