import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const port = 43000 + Math.floor(Math.random() * 1000)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'draft-workflow-test-')), 'data.json')
writeFileSync(dataFile, '{}')

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

const jsonHeaders = owner => ({ 'x-user-id': owner, 'content-type': 'application/json' })

test('draft hooks remain account-isolated and platform variants remain independent', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'draft-owner'
  const other = 'draft-other'
  const generated = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ topic: { title: '真实创业复盘', strategy_layer: 'trust', goal_refs: [], source_refs: [{ type: 'material', id: 9 }] } }) })
  assert.equal(generated.status, 201)
  const drafts = await generated.json()
  assert.equal(drafts.length, 4)
  assert.equal(new Set(drafts.map(item => item.variant_group_id)).size, 1)
  assert.ok(drafts.every(item => item.variant_type === 'platform' && item.workflow_status === 'draft'))
  assert.deepEqual(drafts[0].source_refs, [{ type: 'material', id: 9 }])

  const hooksResponse = await fetch(`${baseUrl}/api/drafts/${drafts[0].id}/hooks`, { method: 'POST', headers: jsonHeaders(owner), body: '{}' })
  assert.equal(hooksResponse.status, 200)
  const hooked = await hooksResponse.json()
  assert.equal(hooked.workflow_status, 'hooks_ready')
  assert.equal(hooked.hooks.length, 4)
  assert.ok(hooked.hooks.every(item => item.validation.status === 'passed'))

  const selected = await fetch(`${baseUrl}/api/drafts/${hooked.id}`, { method: 'PUT', headers: jsonHeaders(owner), body: JSON.stringify({ selected_hook_id: hooked.hooks[0].id, version: hooked.version }) })
  assert.equal(selected.status, 200)
  const selectedBody = await selected.json()
  assert.equal(selectedBody.workflow_status, 'content_ready')
  assert.equal(selectedBody.selected_hook_id, hooked.hooks[0].id)
  assert.match(selectedBody.body, new RegExp(hooked.hooks[0].text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  const otherAccess = await fetch(`${baseUrl}/api/drafts/${drafts[0].id}/hooks`, { method: 'POST', headers: jsonHeaders(other), body: '{}' })
  assert.equal(otherAccess.status, 404)
  const otherSelection = await fetch(`${baseUrl}/api/drafts/${drafts[0].id}`, { method: 'PUT', headers: jsonHeaders(other), body: JSON.stringify({ selected_hook_id: hooked.hooks[0].id, version: hooked.version }) })
  assert.equal(otherSelection.status, 404)
  const badHook = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ topic: { title: '测试', strategy_layer: 'trust', goal_refs: [] }, hook_text: 'a'.repeat(61) }) })
  assert.equal(badHook.status, 422)

  const changedOtherPlatform = await fetch(`${baseUrl}/api/drafts/${drafts[1].id}`, { method: 'PUT', headers: jsonHeaders(owner), body: JSON.stringify({ title: '只改一个平台', version: drafts[1].version }) })
  assert.equal(changedOtherPlatform.status, 200)
  const allDrafts = await (await fetch(`${baseUrl}/api/drafts`, { headers: { 'x-user-id': owner } })).json()
  assert.equal(allDrafts.find(item => item.id === drafts[0].id).title, '真实创业复盘')
})
