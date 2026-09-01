const baseUrl = (import.meta.env?.VITE_WEB_API_BASE_URL || '').replace(/\/$/, '')

export function gatewayConfigured() {
  return Boolean(baseUrl)
}

async function gatewayRequest(path, options = {}) {
  if (!baseUrl) return { ok: false, error: 'web_gateway_not_configured' }
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      credentials: 'include',
      ...options,
      headers: { ...(options.headers || {}) }
    })
    const result = await response.json().catch(() => null)
    return result || { ok: false, error: `gateway_http_${response.status}` }
  } catch (error) {
    return { ok: false, error: error?.message || 'gateway_network_error' }
  }
}

/** 将已由 CloudBase 签发的短期 access token 换为本网关 HttpOnly 会话 Cookie。 */
export function createGatewaySession(accessToken) {
  return gatewayRequest('/auth/session', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })
}

/** 无需邮箱或密码，由网关签发彼此隔离的临时研究测试身份。 */
export function createTestGatewaySession() {
  return gatewayRequest('/auth/test-session', { method: 'POST' })
}

export function getGatewaySession() {
  return gatewayRequest('/auth/session')
}

export function clearGatewaySession() {
  return gatewayRequest('/auth/logout', { method: 'POST' })
}

/**
 * 网页专用 HTTPS 网关协议：POST {baseUrl}/call
 * body: { action: 'reportSession', data: {...} }
 * response: 与原云函数一致的 { ok, ... }。
 *
 * 身份只来自网关验证后的 HttpOnly 会话 Cookie；业务数据中不携带可伪造的
 * openid、uid 或 CloudBase access token。小程序仍保留 wx.cloud.callFunction 原路径。
 */
export function callGateway(action, data = {}, options = {}) {
  return gatewayRequest('/call', {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: JSON.stringify({ action, data })
  })
}
