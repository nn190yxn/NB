import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const port = 45000 + Math.floor(Math.random() * 1000)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'draft-approval-api-')), 'data.json')
writeFileSync(dataFile, '{}')
const headers = owner => ({ 'x-user-id': owner, 'content-type': 'application/json' })

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('人工确认 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`人工确认 API 异常退出: ${code}`)) })
  })
}

async function body(response) { return response.json() }

async function createCheckedDraft(owner, title = '真实创业复盘') {
  const generated = await body(await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ topic: { title, strategy_layer: 'trust', goal_refs: ['trust'], source_refs: [{ type: 'topic', id: title }] } }) }))
  let draft = generated[0]
  draft = await body(await fetch(`${baseUrl}/api/drafts/${draft.id}/hooks`, { method: 'POST', headers: headers(owner), body: '{}' }))
  draft = await body(await fetch(`${baseUrl}/api/drafts/${draft.id}`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ selected_hook_id: draft.hooks[0].id, version: draft.version }) }))
  draft = await body(await fetch(`${baseUrl}/api/drafts/${draft.id}`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ fact_check_status: 'verified', version: draft.version }) }))
  draft = await body(await fetch(`${baseUrl}/api/drafts/${draft.id}/checks/persona`, { method: 'POST', headers: headers(owner), body: '{}' }))
  draft = await body(await fetch(`${baseUrl}/api/drafts/${draft.id}/checks/quality`, { method: 'POST', headers: headers(owner), body: '{}' }))
  draft = await body(await fetch(`${baseUrl}/api/drafts/${draft.id}/checks/publish`, { method: 'POST', headers: headers(owner), body: '{}' }))
  assert.equal(draft.workflow_status, 'publish_ready')
  return draft
}

let server
test.before(async () => { server = await startServer() })
test.after(() => server?.kill())

test('approval validates state, isolates owners and creates one traceable shooting item', async () => {
  const owner = 'approval-owner'
  const raw = await body(await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ topic: { title: '未检查草稿', source_refs: [{ type: 'topic', id: 1 }] } }) }))
  const bypass = await fetch(`${baseUrl}/api/drafts/${raw[0].id}`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ status: 'ready_to_shoot', version: raw[0].version }) })
  assert.equal(bypass.status, 409)
  const forged = await fetch(`${baseUrl}/api/drafts/${raw[0].id}`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ approval: { status: 'approved' }, version: raw[0].version }) })
  assert.equal(forged.status, 422)
  const unready = await fetch(`${baseUrl}/api/drafts/${raw[0].id}/approve`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ version: raw[0].version }) })
  assert.equal(unready.status, 409)

  const draft = await createCheckedDraft(owner)
  const other = await fetch(`${baseUrl}/api/drafts/${draft.id}/approve`, { method: 'POST', headers: headers('approval-other'), body: JSON.stringify({ version: draft.version }) })
  assert.equal(other.status, 404)
  const stale = await fetch(`${baseUrl}/api/drafts/${draft.id}/approve`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ version: draft.version - 1 }) })
  assert.equal(stale.status, 409)
  assert.equal((await body(stale)).code, 'version_conflict')

  const approvedResponse = await fetch(`${baseUrl}/api/drafts/${draft.id}/approve`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ version: draft.version }) })
  assert.equal(approvedResponse.status, 200)
  const approved = await body(approvedResponse)
  assert.equal(approved.draft.workflow_status, 'ready_to_shoot')
  assert.equal(approved.draft.approval.status, 'approved')
  assert.equal(approved.draft.approval.user_id, owner)
  assert.equal(approved.draft.approval.draft_version, draft.version)
  assert.equal(approved.draft.approval.checks_snapshot.publish_checklist.status, 'passed')
  assert.equal(approved.shooting.source_refs[0].id, '真实创业复盘')
  assert.equal(approved.shooting.script, draft.body)

  const replay = await body(await fetch(`${baseUrl}/api/drafts/${draft.id}/approve`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ version: draft.version }) }))
  assert.equal(replay.shooting.id, approved.shooting.id)
  const otherRevoke = await fetch(`${baseUrl}/api/drafts/${draft.id}/revoke-approval`, { method: 'POST', headers: headers('approval-other'), body: JSON.stringify({ version: approved.draft.version, reason: '越权撤回' }) })
  assert.equal(otherRevoke.status, 404)
  let shooting = await body(await fetch(`${baseUrl}/api/shooting/today`, { headers: headers(owner) }))
  assert.equal(shooting.filter(item => item.draft_id === draft.id).length, 1)
  const changed = await body(await fetch(`${baseUrl}/api/drafts/${draft.id}`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ title: '确认后修改标题', version: approved.draft.version }) }))
  assert.equal(changed.approval.status, 'pending')
  assert.equal(changed.workflow_status, 'content_ready')
  assert.equal(changed.checks.quality, null)
  assert.equal(changed.checks.publish_checklist, null)
  shooting = await body(await fetch(`${baseUrl}/api/shooting/today`, { headers: headers(owner) }))
  assert.equal(shooting.find(item => item.draft_id === draft.id).status, 'needs_revision')
})

test('revocation keeps approval snapshot, updates shooting and protects published work', async () => {
  const owner = 'revoke-owner'
  let draft = await createCheckedDraft(owner, '撤回测试')
  let approved = await body(await fetch(`${baseUrl}/api/drafts/${draft.id}/approve`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ version: draft.version }) }))
  const originalSnapshot = structuredClone(approved.draft.approval.checks_snapshot)
  const missingReason = await fetch(`${baseUrl}/api/drafts/${draft.id}/revoke-approval`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ version: approved.draft.version }) })
  assert.equal(missingReason.status, 422)
  const revoked = await body(await fetch(`${baseUrl}/api/drafts/${draft.id}/revoke-approval`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ version: approved.draft.version, reason: '补充案例' }) }))
  assert.equal(revoked.draft.workflow_status, 'needs_revision')
  assert.equal(revoked.draft.approval.revoke_reason, '补充案例')
  assert.deepEqual(revoked.draft.approval.checks_snapshot, originalSnapshot)
  assert.equal(revoked.shooting.status, 'needs_revision')
  const blockedPublish = await fetch(`${baseUrl}/api/shooting/${revoked.shooting.id}`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ status: 'published', version: revoked.shooting.version }) })
  assert.equal(blockedPublish.status, 409)
  const replay = await body(await fetch(`${baseUrl}/api/drafts/${draft.id}/revoke-approval`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ version: approved.draft.version, reason: '补充案例' }) }))
  assert.equal(replay.draft.version, revoked.draft.version)

  draft = await body(await fetch(`${baseUrl}/api/drafts/${draft.id}/checks/persona`, { method: 'POST', headers: headers(owner), body: '{}' }))
  draft = await body(await fetch(`${baseUrl}/api/drafts/${draft.id}/checks/quality`, { method: 'POST', headers: headers(owner), body: '{}' }))
  draft = await body(await fetch(`${baseUrl}/api/drafts/${draft.id}/checks/publish`, { method: 'POST', headers: headers(owner), body: '{}' }))
  approved = await body(await fetch(`${baseUrl}/api/drafts/${draft.id}/approve`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ version: draft.version }) }))
  const publishedResponse = await fetch(`${baseUrl}/api/shooting/${approved.shooting.id}`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ status: 'published', version: approved.shooting.version, published_at: '2026-09-03T10:00:00.000Z' }) })
  assert.equal(publishedResponse.status, 200)
  const cannotRevoke = await fetch(`${baseUrl}/api/drafts/${draft.id}/revoke-approval`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ version: approved.draft.version, reason: '不应成功' }) })
  assert.equal(cannotRevoke.status, 409)
})
