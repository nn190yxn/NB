import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'
const llmMock = await startSharedLlmMock()

const port = testPort(43000, 1000)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'draft-workflow-test-')), 'data.json')
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

test('opening slot stays account-isolated and platform variants remain independent', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'draft-owner'
  const other = 'draft-other'
  const generated = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ topic: { title: '真实创业复盘', strategy_layer: 'trust', goal_refs: [], source_refs: [{ type: 'material', id: 9 }] } }) })
  assert.equal(generated.status, 201)
  const drafts = await generated.json()
  assert.equal(drafts.length, 2)
  assert.equal(new Set(drafts.map(item => item.variant_group_id)).size, 1)
  assert.ok(drafts.every(item => item.variant_type === 'platform' && item.workflow_status === 'draft'))
  assert.deepEqual(drafts[0].source_refs, [{ type: 'material', id: 9 }])

  // 开头只有一个入口：开头句槽位（从方法库取范式）。
  const openingStructure = await fetch(`${baseUrl}/api/structures`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ title: '对标dbs·开头范式一：预测攻击式', steps: ['公式：反常识断言 + 能力反转'], content_type: '开头钩子' }) })
  assert.equal(openingStructure.status, 201)
  const catalog = await (await fetch(`${baseUrl}/api/draft-slots?platform=${encodeURIComponent(drafts[0].platform)}`, { headers: { 'x-user-id': owner } })).json()
  const openingOption = catalog.options.opening[0]
  assert.equal(openingOption.source, '对标dbs')

  const opened = await fetch(`${baseUrl}/api/drafts/${drafts[0].id}/slots/opening`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ option_id: openingOption.id }) })
  assert.equal(opened.status, 200)
  const openedBody = await opened.json()
  const openedDraft = (await (await fetch(`${baseUrl}/api/drafts`, { headers: { 'x-user-id': owner } })).json()).find(item => item.id === drafts[0].id)
  assert.equal(openedBody.updated_count, 1, '开头只作用当前平台草稿')
  assert.equal(openedDraft.workflow_status, 'content_ready')
  assert.equal(openedDraft.opening_ref.option_id, openingOption.id)
  assert.equal(openedDraft.opening_ref.source, '对标dbs')
  assert.match(openedDraft.body, /改写后的开头段/)

  // 归属隔离：别人的草稿既看不到槽位目录结果也不能改写。
  const otherAccess = await fetch(`${baseUrl}/api/drafts/${drafts[0].id}/slots/opening`, { method: 'POST', headers: jsonHeaders(other), body: JSON.stringify({ option_id: openingOption.id }) })
  assert.equal(otherAccess.status, 404)
  const otherSelection = await fetch(`${baseUrl}/api/drafts/${drafts[0].id}`, { method: 'PUT', headers: jsonHeaders(other), body: JSON.stringify({ title: '越权改名', version: openedDraft.version }) })
  assert.equal(otherSelection.status, 404)
  const badHook = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ topic: { title: '测试', strategy_layer: 'trust', goal_refs: [] }, hook_text: 'a'.repeat(61) }) })
  assert.equal(badHook.status, 422)

  const changedOtherPlatform = await fetch(`${baseUrl}/api/drafts/${drafts[1].id}`, { method: 'PUT', headers: jsonHeaders(owner), body: JSON.stringify({ title: '只改一个平台', version: drafts[1].version }) })
  assert.equal(changedOtherPlatform.status, 200)
  const allDrafts = await (await fetch(`${baseUrl}/api/drafts`, { headers: { 'x-user-id': owner } })).json()
  assert.equal(allDrafts.find(item => item.id === drafts[0].id).title, '真实创业复盘')
})
