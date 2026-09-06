import test from 'node:test'
import assert from 'node:assert/strict'
import { decryptApiKey, emptyPublicApiConfigs, encryptApiKey, parseApiConfigKey, publicApiConfig, runtimeApiConfig, updateApiConfig } from './api-settings.mjs'

const key = parseApiConfigKey('11'.repeat(32))

test('AES-256-GCM API Key encryption round-trips without storing plaintext', () => {
  const encrypted = encryptApiKey('sk-sensitive-value', key)
  assert.equal(decryptApiKey(encrypted, key), 'sk-sensitive-value')
  assert.doesNotMatch(JSON.stringify(encrypted), /sk-sensitive-value/)
  assert.equal(encrypted.algorithm, 'aes-256-gcm')
})

test('wrong master key fails closed without exposing the API Key', () => {
  const encrypted = encryptApiKey('sk-do-not-leak', key)
  assert.throws(() => decryptApiKey(encrypted, parseApiConfigKey('22'.repeat(32))), /解密失败/)
})

test('public API config exposes only a mask and fixed capability role', () => {
  const stored = updateApiConfig(null, 'vision', { enabled: true, base_url: 'https://vision.example/v1/', model: 'vision-model', api_key: 'secret-123456' }, key)
  const publicValue = publicApiConfig(stored)
  assert.deepEqual(publicValue, {
    slot: 'vision', role: 'vision', enabled: true, base_url: 'https://vision.example/v1', model: 'vision-model', configured: true, api_key_masked: '••••3456', updated_at: stored.updated_at,
  })
  assert.equal(runtimeApiConfig(stored, key).api_key, 'secret-123456')
  assert.doesNotMatch(JSON.stringify(publicValue), /secret-123456/)
})

test('API Key remains unchanged unless a complete replacement is supplied', () => {
  const first = updateApiConfig(null, 'text_primary', { enabled: true, base_url: 'https://text.example/v1', model: 'm1', api_key: 'first-key' }, key)
  const metadataOnly = updateApiConfig(first, 'text_primary', { enabled: false, model: 'm2' }, key)
  assert.equal(decryptApiKey(metadataOnly.encrypted_api_key, key), 'first-key')
  assert.equal(runtimeApiConfig(metadataOnly, key), null)
  assert.equal(runtimeApiConfig(metadataOnly, key, { requireEnabled: false }).api_key, 'first-key')
  const replaced = updateApiConfig(metadataOnly, 'text_primary', { enabled: true, api_key: 'second-key' }, key)
  assert.equal(decryptApiKey(replaced.encrypted_api_key, key), 'second-key')
})

test('empty public settings define the two text roles and isolated vision role', () => {
  assert.deepEqual(emptyPublicApiConfigs().map(item => [item.slot, item.role]), [
    ['text_primary', 'text_primary'], ['text_fallback', 'text_fallback'], ['vision', 'vision'],
  ])
})

test('invalid key length and unsupported URL protocols are rejected', () => {
  assert.throws(() => parseApiConfigKey('short'), /32 字节/)
  assert.throws(() => updateApiConfig(null, 'text_primary', { enabled: true, base_url: 'file:///tmp', model: 'm', api_key: 'k' }, key), /http 或 https/)
})
