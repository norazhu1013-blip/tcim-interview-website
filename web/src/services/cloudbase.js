import cloudbase from '@cloudbase/js-sdk'

const env = String(import.meta.env.VITE_CLOUDBASE_ENV_ID || '').trim()
const region = String(import.meta.env.VITE_CLOUDBASE_REGION || 'ap-shanghai').trim()

export const cloudbaseConfigured = Boolean(env)
export const cloud = cloudbaseConfigured ? cloudbase.init({ env, region }) : null

export function getCloudAuth() {
  if (!cloud) throw new Error('cloudbase_auth_not_configured')
  return cloud.auth({ persistence: 'local' })
}
