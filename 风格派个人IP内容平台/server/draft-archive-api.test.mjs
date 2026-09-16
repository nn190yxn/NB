import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'
const llmMock = await startSharedLlmMock()

const port = testPort(44000, 1000)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'draft-archive-test-')), 'data.json')
writeFileSync(dataFile, '{}')

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...llmMock.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

const jsonHeaders = owner => ({ 'x-user-id': owner, 'content-type': 'application/json' })

test('archiving only hides a draft without invalidating its checks or version', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'archive-owner'
  const other = 'archive-other'
  const generated = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ topic: { title: '归档用例', strategy_layer: 'trust', goal_refs: [] } }) })
  assert.equal(generated.status, 201)
  const draft = (await generated.json())[0]
  assert.equal(draft.archived_at, null)

  const archivedResponse = await fetch(`${baseUrl}/api/drafts/${draft.id}/archive`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ archived: true }) })
  assert.equal(archivedResponse.status, 200)
  const archived = await archivedResponse.json()
  assert.ok(archived.archived_at, '归档后应记录 archived_at')
  assert.equal(archived.version, draft.version, '归档不应改动版本号')
  assert.equal(archived.workflow_status, draft.workflow_status, '归档不应改动创作状态')
  assert.deepEqual(archived.checks, draft.checks, '归档不应让已通过的检查失效')
  assert.deepEqual(archived.approval, draft.approval, '归档不应改动人工确认状态')
  assert.equal(archived.history?.length || 0, 0, '归档不应写入版本历史')

  const otherAttempt = await fetch(`${baseUrl}/api/drafts/${draft.id}/archive`, { method: 'POST', headers: jsonHeaders(other), body: JSON.stringify({ archived: true }) })
  assert.equal(otherAttempt.status, 404)

  const invalidBody = await fetch(`${baseUrl}/api/drafts/${draft.id}/archive`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ archived: 'yes' }) })
  assert.equal(invalidBody.status, 422)

  const unarchived = await (await fetch(`${baseUrl}/api/drafts/${draft.id}/archive`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ archived: false }) })).json()
  assert.equal(unarchived.archived_at, null, '取消归档应清空 archived_at')

  const missing = await fetch(`${baseUrl}/api/drafts/999999/archive`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ archived: true }) })
  assert.equal(missing.status, 404)
})

test('manual variant copy is marked as a variant of its source draft', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'variant-owner'
  const generated = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ topic: { title: '变体用例', strategy_layer: 'trust', goal_refs: [] } }) })
  const source = (await generated.json())[0]

  await fetch(`${baseUrl}/api/drafts/${source.id}/archive`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ archived: true }) })

  const copyResponse = await fetch(`${baseUrl}/api/drafts/${source.id}/copy`, { method: 'POST', headers: jsonHeaders(owner) })
  assert.equal(copyResponse.status, 201)
  const variant = await copyResponse.json()
  assert.equal(variant.variant_type, 'manual')
  assert.equal(variant.variant_of, source.id)
  assert.equal(variant.variant_group_id, source.variant_group_id, '变体应保留变体组，发布前检查依赖它')
  assert.equal(variant.archived_at, null, '变体复制出来应是可用的，不带归档状态')
  assert.equal(variant.platform, source.platform)
  assert.match(variant.title, /（变体）$/)
  assert.equal(variant.version, 1)
  assert.deepEqual(variant.checks, { persona: null, quality: null, publish_checklist: null })
  const drafts = await (await fetch(`${baseUrl}/api/drafts`, { headers: { 'x-user-id': owner } })).json()
  assert.equal(drafts.length, 5)
  assert.equal(drafts.find(item => item.id === source.id).archived_at !== null, true, '源草稿的归档状态不应被复制动作影响')
})
