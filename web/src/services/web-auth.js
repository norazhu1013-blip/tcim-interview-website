import { cloudbaseConfigured, getCloudAuth } from './cloudbase.js'
import { createGatewaySession, getGatewaySession, clearGatewaySession } from './web-gateway.js'

async function getAnonymousAccessToken() {
  const auth = getCloudAuth()
  try {
    const scope = await auth.loginScope()
    if (scope === 'anonymous') {
      const tokenResult = await auth.getAccessToken()
      if (tokenResult && tokenResult.accessToken) return tokenResult.accessToken
    }
  } catch {
    // 旧登录态或损坏凭证都重新走匿名登录。
  }

  try {
    await auth.signOut()
  } catch {
    // 没有可清理的旧凭证时继续匿名登录。
  }
  await auth.signInAnonymously()
  const tokenResult = await auth.getAccessToken()
  return tokenResult && tokenResult.accessToken
}

/**
 * 首页加载时执行：已有网关会话直接通过；否则用 CloudBase 匿名登录换取网关会话。
 */
export async function ensureWebLogin() {
  if (!cloudbaseConfigured) return { ok: false, error: 'cloudbase_auth_not_configured' }

  const gatewaySession = await getGatewaySession()
  if (gatewaySession.ok) return gatewaySession

  let accessToken
  try {
    accessToken = await getAnonymousAccessToken()
  } catch {
    return { ok: false, error: 'cloudbase_anonymous_login_failed' }
  }
  if (!accessToken) return { ok: false, error: 'cloudbase_anonymous_login_failed' }

  // 已有 CloudBase 凭证但网关不可用时显示明确错误，不能错误地反复跳回登录页。
  return createGatewaySession(accessToken)
}

export async function getWebLoginState() {
  if (!cloudbaseConfigured) return { ok: false, error: 'cloudbase_auth_not_configured' }
  return getGatewaySession()
}

/** 业务动作的兜底：网关会话失效时重新走匿名登录。 */
export async function requireWebLogin() {
  const session = await ensureWebLogin()
  return Boolean(session.ok)
}

export async function signOutWebUser() {
  await clearGatewaySession()
  try {
    await getCloudAuth().signOut()
  } catch {
    // 网关 Cookie 已清理时，CloudBase 本地凭证清理失败不应阻塞退出。
  }
}
