import { cloudbaseConfigured, getCloudAuth } from './cloudbase.js'
import { createGatewaySession, getGatewaySession, clearGatewaySession } from './web-gateway.js'

function callbackUrl() {
  // CloudBase 默认登录页与回调页面必须位于同一网页域名，才能共享浏览器登录态。
  return `${window.location.origin}${window.location.pathname}`
}

function redirectToDefaultLogin() {
  getCloudAuth().toDefaultLoginPage({ redirect_uri: callbackUrl() })
  return { ok: false, redirecting: true }
}

/**
 * 首页加载时执行：已有网关会话直接通过；已有 CloudBase 登录态则换取会话；
 * 两者都没有时自动跳转 CloudBase 默认登录页，教师无需点击登录按钮。
 */
export async function ensureWebLogin() {
  if (!cloudbaseConfigured) return { ok: false, error: 'cloudbase_auth_not_configured' }

  const gatewaySession = await getGatewaySession()
  if (gatewaySession.ok) return gatewaySession

  let accessToken
  try {
    // 默认登录页成功回跳后，SDK 已将凭证保存在同域浏览器中。
    ({ accessToken } = await getCloudAuth().getAccessToken())
  } catch {
    return redirectToDefaultLogin()
  }
  if (!accessToken) return redirectToDefaultLogin()

  // 已有 CloudBase 凭证但网关不可用时显示明确错误，不能错误地反复跳回登录页。
  return createGatewaySession(accessToken)
}

export async function getWebLoginState() {
  if (!cloudbaseConfigured) return { ok: false, error: 'cloudbase_auth_not_configured' }
  return getGatewaySession()
}

/** 业务动作的兜底：网关会话失效时同样自动进入默认登录页。 */
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
