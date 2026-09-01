import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 4100 + Math.floor(Math.random() * 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-sync-ui-')), 'data.json')
writeFileSync(dataFile, '{}')

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('同步管理测试 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
  })
}

test('同步管理接口支持目录生命周期并保持账号边界', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const session = await fetch(`${baseUrl}/api/auth/session`, { method: 'POST' })
  const cookie = session.headers.get('set-cookie')?.split(';')[0]
  const heartbeat = await fetch(`${baseUrl}/api/devices/heartbeat`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'desktop-test', name: '测试桌面' }) })
  assert.equal(heartbeat.status, 200)
  const created = await fetch(`${baseUrl}/api/sync-directories`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ local_path: 'D:\\content', device_id: 'desktop-test' }) })
  assert.equal(created.status, 201)
  const directory = await created.json()
  assert.equal(directory.sync_status, 'pending_verification')
  assert.equal((await (await fetch(`${baseUrl}/api/sync-directories`, { headers: { cookie } })).json()).length, 1)
  const watching = await fetch(`${baseUrl}/api/sync-directories/${directory.id}`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ sync_status: 'watching', sync_error: null }) })
  assert.equal((await watching.json()).sync_status, 'watching')
  const paused = await fetch(`${baseUrl}/api/sync-directories/${directory.id}`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) })
  const pausedDirectory = await paused.json()
  assert.equal(pausedDirectory.enabled, false)
  assert.equal(pausedDirectory.sync_status, 'paused')
  const removed = await fetch(`${baseUrl}/api/sync-directories/${directory.id}`, { method: 'DELETE', headers: { cookie } })
  assert.equal(removed.status, 200)
  assert.equal((await (await fetch(`${baseUrl}/api/sync-directories`, { headers: { cookie } })).json()).length, 0)
})
