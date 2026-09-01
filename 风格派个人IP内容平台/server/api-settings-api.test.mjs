import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let nextPort = 3500 + Math.floor(Math.random() * 150)
function startServer() {
  const port = nextPort++
  const baseUrl = `http://127.0.0.1:${port}`
  const logs = []
  const dataFile = join(mkdtempSync(join(tmpdir(), 'api-settings-test-')), 'data.json')
  writeFileSync(dataFile, '{}')
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile,
      API_CONFIG_ENCRYPTION_KEY: '33'.repeat(32),
      PROJECT_DB_HOST: '', PROJECT_DB_NAME: '', PROJECT_DB_USER: '', PROJECT_DB_PASSWORD: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', data => logs.push(String(data)))
  child.stderr.on('data', data => logs.push(String(data)))
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('API 配置测试服务启动超时')), 5000)
    child.stdout.on('data', data => {
      if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve({ child, logs, baseUrl, dataFile }) }
    })
    child.once('error', reject)
  })
}

async function session(baseUrl, userId) {
  const response = await fetch(`${baseUrl}/api/auth/session`, { method: 'POST', headers: { 'x-user-id': userId } })
  return response.headers.get('set-cookie').split(';', 1)[0]
}

test('API settings are encrypted, masked and isolated by account', async t => {
  const { child, logs, baseUrl, dataFile } = await startServer()
  t.after(() => child.kill())
  const cookie = await session(baseUrl, 'api-user-a')
  const secret = 'sk-server-side-secret-9876'
  const saved = await fetch(`${baseUrl}/api/api-settings/text_primary`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true, base_url: 'https://text.example/v1', model: 'text-model', api_key: secret }),
  })
  assert.equal(saved.status, 200)
  const publicValue = await saved.json()
  assert.equal(publicValue.api_key_masked, '••••9876')
  assert.equal(publicValue.configured, true)
  assert.equal('api_key' in publicValue, false)
  assert.equal('encrypted_api_key' in publicValue, false)

  const persisted = readFileSync(dataFile, 'utf8')
  assert.doesNotMatch(persisted, new RegExp(secret))
  assert.match(persisted, /aes-256-gcm/)

  const otherCookie = await session(baseUrl, 'api-user-b')
  const other = await fetch(`${baseUrl}/api/api-settings`, { headers: { cookie: otherCookie } })
  const otherPrimary = (await other.json()).find(item => item.slot === 'text_primary')
  assert.equal(otherPrimary.configured, false)
  assert.doesNotMatch(logs.join(''), new RegExp(secret))
})

test('legacy browser migration endpoint requires an explicit request and stores both text slots', async t => {
  const { child, baseUrl } = await startServer()
  t.after(() => child.kill())
  const cookie = await session(baseUrl, 'migration-user')
  const before = await fetch(`${baseUrl}/api/api-settings`, { headers: { cookie } }).then(response => response.json())
  assert.equal(before.some(item => item.configured), false)

  const migrated = await fetch(`${baseUrl}/api/api-settings/migrate`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      text_primary: { enabled: true, base_url: 'https://primary.example/v1', model: 'p', api_key: 'primary-secret' },
      text_fallback: { enabled: true, base_url: 'https://fallback.example/v1', model: 'f', api_key: 'fallback-secret' },
    }),
  })
  assert.equal(migrated.status, 200)
  const values = await migrated.json()
  assert.equal(values.find(item => item.slot === 'text_primary').configured, true)
  assert.equal(values.find(item => item.slot === 'text_fallback').configured, true)
  assert.equal(values.find(item => item.slot === 'vision').configured, false)
})
