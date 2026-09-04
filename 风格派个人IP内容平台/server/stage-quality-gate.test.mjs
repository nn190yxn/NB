import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const port = 46000 + Math.floor(Math.random() * 1000)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'stage-quality-gate-')), 'legacy.json')
const legacyState = {
  drafts: [
    { id: 1, title: '旧草稿', body: '旧正文', platform: '抖音', status: 'draft', version: 1, source_refs: [{ type: 'topic', id: 9 }] },
    { id: 2, title: '已有确认草稿', body: '正文', platform: '小红书', status: 'ready_to_shoot', version: 4, approval: { status: 'approved', user_id: 'demo-user', approved_at: '2026-08-01T00:00:00.000Z' } },
  ],
  shooting: [{ id: 1, draft_id: 2, title: '旧拍摄项', status: 'todo', version: 1, source_refs: [{ type: 'topic', id: 9 }] }],
}
writeFileSync(dataFile, JSON.stringify(legacyState))

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('阶段质量门 API 启动超时')), 5000)
    child.stdout.on('data', data => {
      if (String(data).includes('Content IP API listening')) {
        clearTimeout(timeout)
        resolve(child)
      }
    })
    child.once('error', reject)
    child.once('exit', code => {
      if (code !== null) reject(new Error(`阶段质量门 API 异常退出: ${code}`))
    })
  })
}

const headers = { 'x-user-id': 'demo-user', 'content-type': 'application/json' }

test('legacy JSON workflow records receive safe defaults and remain operable', async t => {
  const server = await startServer()
  t.after(() => server.kill())

  const draftsResponse = await fetch(`${baseUrl}/api/drafts`, { headers })
  assert.equal(draftsResponse.status, 200)
  const drafts = await draftsResponse.json()
  const pending = drafts.find(item => item.id === 1)
  const approved = drafts.find(item => item.id === 2)
  assert.equal(pending.owner_id, 'demo-user')
  assert.equal(pending.workflow_status, 'draft')
  assert.deepEqual(pending.checks, { persona: null, quality: null, publish_checklist: null })
  assert.equal(pending.approval.status, 'pending')
  assert.equal(pending.approval.checks_snapshot, null)
  assert.equal(pending.variant_type, 'legacy')
  assert.equal(approved.approval.status, 'approved')
  assert.equal(approved.approval.user_id, 'demo-user')
  assert.equal(approved.approval.revoked_at, null)

  const shootingResponse = await fetch(`${baseUrl}/api/shooting/today`, { headers })
  assert.equal(shootingResponse.status, 200)
  const shooting = (await shootingResponse.json())[0]
  assert.equal(shooting.owner_id, 'demo-user')
  assert.equal(shooting.status, 'ready_to_shoot')
  assert.equal(shooting.approval_required, undefined)

  const legacyPublish = await fetch(`${baseUrl}/api/shooting/${shooting.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ status: 'published', version: shooting.version }),
  })
  assert.equal(legacyPublish.status, 200)
  assert.equal((await legacyPublish.json()).status, 'published')
})
