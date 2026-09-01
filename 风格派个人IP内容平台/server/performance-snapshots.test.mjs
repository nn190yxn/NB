import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 4300 + Math.floor(Math.random() * 100)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-performance-')), 'data.json')
writeFileSync(dataFile, JSON.stringify({ drafts: [{ id: 7, owner_id: 'demo-user', title: '表现测试', platform: '抖音' }] }))

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('表现模型测试 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
  })
}

test('表现快照只追加、保留缺失指标空值并按账号隔离', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const session = await fetch(`${baseUrl}/api/auth/session`, { method: 'POST' })
  const cookie = session.headers.get('set-cookie')?.split(';')[0]
  const otherSession = await fetch(`${baseUrl}/api/auth/session`, { method: 'POST', headers: { 'x-user-id': 'other-user' } })
  const otherCookie = otherSession.headers.get('set-cookie')?.split(';')[0]
  const created = await fetch(`${baseUrl}/api/performance-snapshots`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ draft_id: 7, platform: '抖音', published_at: '2026-09-01T08:00:00Z', metrics: { views: 1200, likes: null }, raw_model_result: { source: 'test' }, confidence: 0.82 }) })
  assert.equal(created.status, 201)
  const snapshot = await created.json()
  assert.equal(snapshot.metrics.likes, null)
  assert.equal(snapshot.status, 'pending_confirmation')
  const second = await fetch(`${baseUrl}/api/performance-snapshots`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ draft_id: 7, platform: '抖音', metrics: { views: 1800 } }) })
  assert.equal(second.status, 201)
  const history = await (await fetch(`${baseUrl}/api/performance-snapshots?draft_id=7`, { headers: { cookie } })).json()
  assert.equal(history.length, 2)
  assert.ok(new Date(history[0].captured_at).getTime() >= new Date(history[1].captured_at).getTime())
  assert.equal((await (await fetch(`${baseUrl}/api/performance-snapshots`, { headers: { cookie: otherCookie } })).json()).length, 0)
  const invalid = await fetch(`${baseUrl}/api/performance-snapshots`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ metrics: { views: 1 } }) })
  assert.equal(invalid.status, 422)
  const foreignReference = await fetch(`${baseUrl}/api/performance-snapshots`, { method: 'POST', headers: { cookie: otherCookie, 'content-type': 'application/json' }, body: JSON.stringify({ draft_id: 7, metrics: { views: 1 } }) })
  assert.equal(foreignReference.status, 422)
})
