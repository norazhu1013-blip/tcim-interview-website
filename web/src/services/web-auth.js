import cloudbase from '@cloudbase/js-sdk'
import { createGatewaySession, getGatewaySession, clearGatewaySession } from './web-gateway.js'

const ENV_ID = String(import.meta.env.VITE_CLOUDBASE_ENV_ID || '').trim()
const REGION = String(import.meta.env.VITE_CLOUDBASE_REGION || 'ap-shanghai').trim()
const PROVIDER_ID = 'wx_open'
const STATE_KEY = 'gsyg:web:wechat-login-state'
const RETURN_KEY = 'gsyg:web:wechat-login-return'
const CALLBACK_KEY = 'gsyg:web:wechat-login-callback'
const ALLOW_ANONYMOUS_BOOTSTRAP = String(import.meta.env.VITE_CLOUDBASE_ENABLE_FIRST_LOGIN_BIND || '').toLowerCase() === 'true'

let authInstance

function configured() {
  return Boolean(ENV_ID)
}

function getAuth() {
  if (!configured()) throw new Error('cloudbase_auth_not_configured')
  if (!authInstance) {
    const app = cloudbase.init({ env: ENV_ID, region: REGION })
    authInstance = app.auth({ persistence: 'local' })
  }
  return authInstance
}

function callbackUrl() {
  return `${window.location.origin}${window.location.pathname}`
}

function randomState() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

function normalizedError(error) {
  if (!error) return ''
  return String(error.error || error.code || error.message || error.error_description || '').toLowerCase()
}

function isUserNotFound(error) {
  const value = normalizedError(error)
  return value.includes('not_found') || value.includes('user_not_found') || value.includes('用户不存在')
}

function clearCallbackParams() {
  const url = new URL(window.location.href)
  for (const key of ['code', 'state', 'provider', 'error', 'error_description']) url.searchParams.delete(key)
  window.history.replaceState(null, '', url.toString())
}

/**
 * 跳转到 CloudBase 生成的微信开放平台扫码登录地址。
 * state 只存于当前浏览器会话，回调时必须逐字匹配。
 */
export async function beginWeChatLogin(returnTo = window.location.hash || '#/') {
  if (!configured()) throw new Error('cloudbase_auth_not_configured')

  const state = randomState()
  const redirectUri = callbackUrl()
  sessionStorage.setItem(STATE_KEY, state)
  sessionStorage.setItem(RETURN_KEY, returnTo)
  sessionStorage.setItem(CALLBACK_KEY, redirectUri)

  const auth = getAuth()
  const { uri } = await auth.genProviderRedirectUri({
    provider_id: PROVIDER_ID,
    provider_redirect_uri: redirectUri,
    state
  })
  if (!uri) throw new Error('wechat_login_uri_missing')
  window.location.assign(uri)
}

/**
 * 首次扫码帐号若尚未绑定 CloudBase 用户，可用匿名帐号做一次性本地引导并立即绑定微信。
 * 这要求管理员同时开启 CloudBase 匿名登录；绑定成功后该帐号不再以匿名身份使用本网关。
 */
async function signInProvider(auth, providerToken) {
  try {
    await auth.signInWithProvider({ provider_token: providerToken })
  } catch (error) {
    if (!isUserNotFound(error) || !ALLOW_ANONYMOUS_BOOTSTRAP) throw error
    await auth.signInAnonymously()
    await auth.bindWithProvider({ provider_token: providerToken })
  }
}

/**
 * 处理微信返回的 code。访问令牌只提交给网关一次以换取 HttpOnly 网关会话，
 * 业务请求始终只使用该会话 Cookie。
 */
export async function completeWeChatLoginFromCallback() {
  const url = new URL(window.location.href)
  const providerCode = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')
  if (!providerCode && !returnedState) return { handled: false }

  const expectedState = sessionStorage.getItem(STATE_KEY)
  const redirectUri = sessionStorage.getItem(CALLBACK_KEY)
  if (!configured() || !providerCode || !returnedState || !expectedState || returnedState !== expectedState || !redirectUri) {
    clearCallbackParams()
    sessionStorage.removeItem(STATE_KEY)
    return { handled: true, ok: false, error: 'wechat_login_state_invalid' }
  }

  try {
    const auth = getAuth()
    const { provider_token: providerToken } = await auth.grantProviderToken({
      provider_id: PROVIDER_ID,
      provider_redirect_uri: redirectUri,
      provider_code: providerCode
    })
    if (!providerToken) throw new Error('wechat_provider_token_missing')

    await signInProvider(auth, providerToken)
    const { accessToken } = await auth.getAccessToken()
    const session = await createGatewaySession(accessToken)
    if (!session.ok) throw new Error(session.error || 'gateway_session_failed')

    const returnTo = sessionStorage.getItem(RETURN_KEY) || '#/'
    clearCallbackParams()
    sessionStorage.removeItem(STATE_KEY)
    sessionStorage.removeItem(CALLBACK_KEY)
    sessionStorage.removeItem(RETURN_KEY)
    return { handled: true, ok: true, returnTo, user: session.user || null }
  } catch (error) {
    clearCallbackParams()
    sessionStorage.removeItem(STATE_KEY)
    sessionStorage.removeItem(CALLBACK_KEY)
    return {
      handled: true,
      ok: false,
      error: isUserNotFound(error) && !ALLOW_ANONYMOUS_BOOTSTRAP
        ? 'wechat_first_login_binding_required'
        : normalizedError(error) || 'wechat_login_failed'
    }
  }
}

export async function getWebLoginState() {
  if (!configured()) return { ok: false, error: 'cloudbase_auth_not_configured' }
  return getGatewaySession()
}

/** 未登录时跳转扫码；返回 true 表示当前已拥有可用网关会话。 */
export async function requireWebLogin(returnTo = window.location.hash || '#/') {
  const state = await getWebLoginState()
  if (state.ok) return true
  await beginWeChatLogin(returnTo)
  return false
}

export async function signOutWebUser() {
  await clearGatewaySession()
  try {
    if (authInstance) await authInstance.signOut()
  } catch {
    // CloudBase 本地凭证清理失败不应阻塞网关 Cookie 清理。
  }
}

export const webAuthConfigured = configured
