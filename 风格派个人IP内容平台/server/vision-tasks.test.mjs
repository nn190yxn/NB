import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 4400 + Math.floor(Math.random() * 100)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-vision-')), 'data.json')
writeFileSync(dataFile, JSON.stringify({ shooting: [{ id: 1, owner_id: 'demo-user', draft_id: 9, title: '创业复盘', platform: '抖音', status: 'ready_to_shoot', version: 1 }] }))
function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile, API_CONFIG_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('视觉任务 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timer); resolve(child) } })
    child.once('error', reject)
  })
}

test('视觉截图任务支持多图、API3失败保留和重试', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const session = await fetch(`${baseUrl}/api/auth/session`, { method: 'POST' })
  const cookie = session.headers.get('set-cookie')?.split(';')[0]
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=', 'base64')
  const upload = await fetch(`${baseUrl}/api/private-files`, { method: 'POST', headers: { cookie, 'content-type': 'image/png', 'x-file-name': 'capture.png' }, body: png })
  assert.equal(upload.status, 201)
  const file = await upload.json()
  const created = await fetch(`${baseUrl}/api/vision-tasks`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ screenshot_file_ids: [file.id, file.id] }) })
  assert.equal(created.status, 202)
  const task = await created.json()
  assert.deepEqual(task.screenshot_file_ids, [file.id])
  assert.equal((await (await fetch(`${baseUrl}/api/vision-tasks`, { headers: { cookie } })).json()).length, 1)
  await new Promise(resolve => setTimeout(resolve, 30))
  const failed = await (await fetch(`${baseUrl}/api/vision-tasks/${task.id}`, { headers: { cookie } })).json()
  assert.equal(failed.status, 'failed')
  const candidates = await fetch(`${baseUrl}/api/vision-tasks/${task.id}/matches`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ platform: '抖音', title: '创业复盘' }) })
  assert.equal((await candidates.json())[0].resource_id, 1)
  const confirmed = await fetch(`${baseUrl}/api/vision-tasks/${task.id}/confirm`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ shooting_id: 1, metrics: { views: null }, corrected_fields: ['views'] }) })
  assert.equal(confirmed.status, 201)
  assert.equal((await confirmed.json()).status, 'confirmed')
  const repeated = await fetch(`${baseUrl}/api/vision-tasks/${task.id}/confirm`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ shooting_id: 1, metrics: { views: 1 } }) })
  assert.equal(repeated.status, 409)
  assert.match(failed.error, /视觉模型未配置/)
  const retry = await fetch(`${baseUrl}/api/vision-tasks/${task.id}/retry`, { method: 'POST', headers: { cookie } })
  assert.equal(retry.status, 202)
})
