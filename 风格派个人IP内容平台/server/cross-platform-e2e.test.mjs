import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 4550 + Math.floor(Math.random() * 80)
const base = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-cross-platform-')), 'data.json')

async function start() {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('跨端链路 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timer); resolve() } })
    child.once('error', reject)
  })
  const auth = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { 'x-user-id': 'cross-platform-user' } })
  return { child, cookie: auth.headers.get('set-cookie').split(';', 1)[0] }
}

test('热点到素材、创作、发布和表现快照保持统一来源链路', async t => {
  const { child, cookie } = await start(); t.after(() => child.kill())
  const headers = { cookie, 'content-type': 'application/json' }
  await fetch(`${base}/api/profile`, { method: 'PUT', headers, body: JSON.stringify({ role: '创业顾问', audiences: ['创业者'], pillars: ['真实复盘'] }) })
  const research = (await (await fetch(`${base}/api/research/search`, { method: 'POST', headers, body: JSON.stringify({ keyword: '创业', platform: '抖音' }) })).json()).items[0]
  const material = await (await fetch(`${base}/api/research/${research.id}/collect`, { method: 'POST', headers })).json()
  const topics = await (await fetch(`${base}/api/topics/generate`, { method: 'POST', headers, body: JSON.stringify({ material_ids: [material.id] }) })).json()
  const drafts = await (await fetch(`${base}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic_id: topics[0].id }) })).json()
  const draft = drafts.find(item => item.platform === '抖音')
  assert.ok(draft.source_refs.some(ref => ref.type === 'material' && ref.id === material.id))
  await fetch(`${base}/api/drafts/${draft.id}`, { method: 'PUT', headers, body: JSON.stringify({ status: 'ready_to_shoot', version: draft.version }) })
  const shooting = (await (await fetch(`${base}/api/shooting/today`, { headers })).json()).find(item => item.draft_id === draft.id)
  const published = await fetch(`${base}/api/shooting/${shooting.id}`, { method: 'PUT', headers, body: JSON.stringify({ status: 'published', platform: '抖音', published_at: '2026-09-01T08:00:00Z', version: shooting.version }) })
  assert.equal(published.status, 200)
  const snapshot = await (await fetch(`${base}/api/performance-snapshots`, { method: 'POST', headers, body: JSON.stringify({ draft_id: draft.id, shooting_id: shooting.id, platform: '抖音', metrics: { views: 1200, likes: null }, status: 'confirmed' }) })).json()
  assert.equal(snapshot.shooting_id, shooting.id)
  assert.equal(snapshot.metrics.likes, null)
})
