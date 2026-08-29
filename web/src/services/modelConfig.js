const configuredBaseUrl = String(import.meta.env?.VITE_DIALOGUE_AGENT_API_BASE_URL || '')

function isLoopbackHostname(value) {
  const host = String(value || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1') return true
  const parts = host.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** 密钥配置端点必须是绝对回环地址；误配时在 fetch 之前阻断。 */
export function resolveLocalModelConfigBaseUrl(rawValue = configuredBaseUrl) {
  let parsed
  try {
    parsed = new URL(String(rawValue || ''))
  } catch {
    throw new Error('本机模型设置地址尚未正确配置')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !isLoopbackHostname(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('为保护 API 密钥，模型设置只允许连接本机 127.0.0.1 或 localhost')
  }
  return parsed.href.replace(/\/$/, '')
}

async function requestModelConfig(path, options = {}) {
  const baseUrl = resolveLocalModelConfigBaseUrl()
  let response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    })
  } catch {
    const error = new Error('本机 Dialogue Agent 服务未启动')
    error.code = 'dialogue_agent_unavailable'
    throw error
  }

  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.message || payload?.error || '模型设置没有保存成功')
    error.code = payload?.error || `http_${response.status}`
    throw error
  }
  return payload
}

/** 只读取“是否已配置”，服务端绝不返回密钥本身。 */
export function getDialogueModelConfig() {
  return requestModelConfig('/v1/model-config')
}

/** 密钥只发送到 localhost/127.0.0.0/8/[::1] 回环服务，不写入 localStorage。 */
export function configureDialogueModel({ provider, apiKey = '' }) {
  const body = { provider }
  if (String(apiKey).trim()) body.api_key = String(apiKey).trim()
  return requestModelConfig('/v1/model-config', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}
