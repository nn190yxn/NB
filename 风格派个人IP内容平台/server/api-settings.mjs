import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export const apiConfigSlots = Object.freeze(['text_primary', 'text_fallback', 'vision'])
export const apiConfigRoles = Object.freeze({ text_primary: 'text_primary', text_fallback: 'text_fallback', vision: 'vision' })

export function parseApiConfigKey(value) {
  const input = String(value || '').trim()
  const key = /^[0-9a-f]{64}$/i.test(input) ? Buffer.from(input, 'hex') : Buffer.from(input, 'base64')
  if (key.length !== 32) throw new Error('API_CONFIG_ENCRYPTION_KEY 必须是 32 字节的十六进制或 Base64 密钥')
  return key
}

export function encryptApiKey(value, masterKey) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv)
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  return { version: 1, algorithm: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }
}

export function decryptApiKey(payload, masterKey) {
  try {
    if (!payload || payload.algorithm !== 'aes-256-gcm' || payload.version !== 1) throw new Error('unsupported payload')
    const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(payload.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('API Key 解密失败，请检查服务端主密钥')
  }
}

export function maskApiKey(value) {
  const secret = String(value || '')
  return secret ? `••••${secret.slice(-4)}` : ''
}

function normalizedBaseUrl(value) {
  let url
  try { url = new URL(String(value || '').trim()) } catch { throw new Error('Base URL 格式不正确') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Base URL 仅支持 http 或 https')
  return url.toString().replace(/\/$/, '')
}

export function updateApiConfig(existing, slot, input, masterKey) {
  if (!apiConfigSlots.includes(slot)) throw new Error('不支持的 API 配置槽位')
  const apiKey = input.api_key === undefined ? null : String(input.api_key).trim()
  const encryptedApiKey = apiKey ? encryptApiKey(apiKey, masterKey) : existing?.encrypted_api_key
  const baseUrlValue = input.base_url === undefined ? existing?.base_url : input.base_url
  const modelValue = input.model === undefined ? existing?.model : String(input.model || '').trim()
  const enabled = input.enabled === undefined ? existing?.enabled !== false : input.enabled === true
  if (encryptedApiKey && (!String(baseUrlValue || '').trim() || !modelValue)) throw new Error('Base URL 和模型名不能为空')
  if (enabled && !encryptedApiKey) throw new Error('首次配置必须输入完整 API Key')
  return {
    slot,
    role: apiConfigRoles[slot],
    enabled,
    base_url: encryptedApiKey ? normalizedBaseUrl(baseUrlValue) : '',
    model: encryptedApiKey ? modelValue : '',
    encrypted_api_key: encryptedApiKey || null,
    api_key_masked: encryptedApiKey ? maskApiKey(apiKey || decryptApiKey(encryptedApiKey, masterKey)) : '',
    updated_at: new Date().toISOString(),
  }
}

export function publicApiConfig(config) {
  return {
    slot: config.slot,
    role: config.role,
    enabled: config.enabled === true,
    base_url: config.base_url || '',
    model: config.model || '',
    configured: Boolean(config.encrypted_api_key),
    api_key_masked: config.api_key_masked || '',
    updated_at: config.updated_at || null,
  }
}

export function runtimeApiConfig(config, masterKey) {
  if (!config?.enabled || !config.encrypted_api_key) return null
  return { base_url: config.base_url, model: config.model, api_key: decryptApiKey(config.encrypted_api_key, masterKey) }
}

export function emptyPublicApiConfigs() {
  return apiConfigSlots.map(slot => publicApiConfig({ slot, role: apiConfigRoles[slot], enabled: false }))
}
