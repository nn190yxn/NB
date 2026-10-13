import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testPort } from './test-port.mjs'

const port = testPort(47900, 150)
const baseUrl = `http://127.0.0.1:${port}`
const jsonHeaders = owner => ({ 'x-user-id': owner, 'content-type': 'application/json' })
const now = '2026-09-17T00:00:00.000Z'

function draftRecord({ id, owner_id, title, body, version, approvalStatus, history }) {
  return {
    id,
    owner_id,
    title,
    body,
    platform: '抖音',
    status: 'draft',
    workflow_status: 'content_ready',
    version,
    topic_id: 1,
    strategy_layer: 'trust',
    goal_refs: [],
    source_refs: [{ type: 'topic', id: 1 }],
    fact_check_status: 'needs_review',
    checks: { persona: null, quality: null, publish_checklist: null },
    approval: {
      status: approvalStatus,
      user_id: approvalStatus === 'approved' ? owner_id : null,
      approved_at: approvalStatus === 'approved' ? now : null,
      revoked_at: null,
      revoked_by: null,
      revoke_reason: null,
      draft_version: approvalStatus === 'approved' ? version : null,
      revoked_draft_version: null,
      checks_snapshot: null,
    },
    history,
    archived_at: null,
    created_at: now,
    updated_at: now,
  }
}

function startServer() {
  const dataFile = join(mkdtempSync(join(tmpdir(), 'draft-restore-test-')), 'data.json')
  writeFileSync(dataFile, JSON.stringify({
    drafts: [
      draftRecord({
        id: 1,
        owner_id: 'restore-owner',
        title: '当前标题',
        body: '当前正文',
        version: 2,
        approvalStatus: 'pending',
        history: [{ version: 1, title: '旧标题', body: '旧正文', platform: '抖音', topic_id: 1, strategy_layer: 'trust', goal_refs: [], source_refs: [{ type: 'topic', id: 1 }], fact_check_status: 'needs_review', snapshot_at: now }],
      }),
      draftRecord({
        id: 2,
        owner_id: 'restore-owner',
        title: '已确认标题',
        body: '已确认正文',
        version: 3,
        approvalStatus: 'approved',
        history: [{ version: 2, title: '确认前标题', body: '确认前正文', platform: '抖音', snapshot_at: now }],
      }),
    ],
  }))
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('草稿恢复 API 启动超时')), 20000)
    child.stdout.on('data', data => {
      if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) }
    })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`草稿恢复 API 异常退出: ${code}`)) })
  })
}

test('草稿恢复：回滚正文、隔离账号、已确认必须先撤回', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = jsonHeaders('restore-owner')
  const other = jsonHeaders('restore-other')

  const restored = await fetch(`${baseUrl}/api/drafts/1/restore`, { method: 'POST', headers: owner, body: JSON.stringify({ version: 1 }) })
  assert.equal(restored.status, 200)
  const draft = await restored.json()
  assert.equal(draft.title, '旧标题')
  assert.equal(draft.body, '旧正文')
  assert.equal(draft.version, 3, '恢复应写入新版本，而不是覆盖当前版本号')
  assert.equal(draft.history.length, 2, '恢复前的当前稿应进入历史')
  assert.equal(draft.history.at(-1).title, '当前标题')

  const isolated = await fetch(`${baseUrl}/api/drafts/1/restore`, { method: 'POST', headers: other, body: JSON.stringify({ version: 1 }) })
  assert.equal(isolated.status, 404)

  const missingVersion = await fetch(`${baseUrl}/api/drafts/1/restore`, { method: 'POST', headers: owner, body: JSON.stringify({ version: 99 }) })
  assert.equal(missingVersion.status, 404)

  const missingDraft = await fetch(`${baseUrl}/api/drafts/999/restore`, { method: 'POST', headers: owner, body: JSON.stringify({ version: 1 }) })
  assert.equal(missingDraft.status, 404)

  const approved = await fetch(`${baseUrl}/api/drafts/2/restore`, { method: 'POST', headers: owner, body: JSON.stringify({ version: 2 }) })
  assert.equal(approved.status, 409)
  assert.equal((await approved.json()).code, 'invalid_transition')
})
