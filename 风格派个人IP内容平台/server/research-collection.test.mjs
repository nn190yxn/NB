import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let nextPort = 3850 + Math.floor(Math.random() * 80)
async function start() {
  const port = nextPort++
  const dir = mkdtempSync(join(tmpdir(), 'research-collect-'))
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: join(dir, 'data.json') }, stdio: ['ignore', 'pipe', 'pipe'] })
  const base = `http://127.0.0.1:${port}`
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timer); resolve() } })
    child.once('error', reject)
  })
  const auth = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { 'x-user-id': 'research-user' } })
  return { base, cookie: auth.headers.get('set-cookie').split(';', 1)[0], child }
}

test('research collection creates one hotspot material with traceable source', async t => {
  const { base, cookie, child } = await start(); t.after(() => child.kill())
  const headers = { cookie, 'content-type': 'application/json' }
  const search = await fetch(`${base}/api/research/search`, { method: 'POST', headers, body: JSON.stringify({ keyword: '创业', platform: '小红书' }) })
  assert.equal(search.status, 200)
  const research = (await search.json()).items[0]
  const collect = await fetch(`${base}/api/research/${research.id}/collect`, { method: 'POST', headers })
  assert.equal(collect.status, 201)
  const material = await collect.json()
  assert.equal(material.material_kind, 'hotspot')
  assert.equal(material.source_type, 'research')
  assert.equal(material.source_id, research.id)
  assert.equal(material.source_refs[0].type, 'research')
  assert.equal(material.url, research.url)

  const repeated = await fetch(`${base}/api/research/${research.id}/collect`, { method: 'POST', headers })
  assert.equal(repeated.status, 200)
  assert.equal((await repeated.json()).duplicate, true)
  const materials = await fetch(`${base}/api/materials?kind=hotspot`, { headers })
  assert.equal((await materials.json()).total, 1)
  const researchList = await fetch(`${base}/api/research?sort=latest`, { headers })
  assert.equal((await researchList.json()).items.find(item => item.id === research.id).collected, true)
})

test('research collection is isolated between accounts', async t => {
  const { base, cookie, child } = await start(); t.after(() => child.kill())
  const headers = { cookie, 'content-type': 'application/json' }
  const search = await fetch(`${base}/api/research/search`, { method: 'POST', headers, body: JSON.stringify({ keyword: '增长', platform: '抖音' }) })
  const research = (await search.json()).items[0]
  const otherAuth = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { 'x-user-id': 'other-user' } })
  const otherCookie = otherAuth.headers.get('set-cookie').split(';', 1)[0]
  const denied = await fetch(`${base}/api/research/${research.id}/collect`, { method: 'POST', headers: { cookie: otherCookie, 'content-type': 'application/json' } })
  assert.equal(denied.status, 404)
})
