const baseUrl = (import.meta.env.VITE_WEB_API_BASE_URL || '').replace(/\/$/, '')

export function gatewayConfigured() {
  return Boolean(baseUrl)
}

/**
 * 网页专用 HTTPS 网关协议：POST {baseUrl}/call
 * body: { action: 'reportSession', data: {...} }
 * response: 与原云函数一致的 { ok, ... }。
 *
 * 身份由 HttpOnly Cookie 或 Authorization token 交给网关验证，业务数据中不携带
 * 可伪造的 openid/uid。小程序仍保留 wx.cloud.callFunction 原路径。
 */
export async function callGateway(action, data = {}) {
  if (!baseUrl) return { ok: false, error: 'web_gateway_not_configured' }
  try {
    const response = await fetch(`${baseUrl}/call`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, data })
    })
    const result = await response.json().catch(() => null)
    return result || { ok: false, error: `gateway_http_${response.status}` }
  } catch (error) {
    return { ok: false, error: error?.message || 'gateway_network_error' }
  }
}
