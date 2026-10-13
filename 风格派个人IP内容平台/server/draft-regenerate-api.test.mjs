import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

const llmMock = await startSharedLlmMock()
const port = testPort(44100, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'draft-regenerate-test-')), 'data.json')
writeFileSync(dataFile, JSON.stringify({
  topics: [
    { id: 11, owner_id: 'regen-owner', title: '同一选题只留一轮', rationale: '', content_job: 'trust', strategy_layer: 'trust', workflow_status: 'approved', goal_refs: [], source_refs: [] },
    { id: 12, owner_id: 'regen-owner', title: '另一条选题', rationale: '', content_job: 'trust', strategy_layer: 'trust', workflow_status: 'approved', goal_refs: [], source_refs: [] },
  ],
}))

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...llmMock.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 20000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

const jsonHeaders = owner => ({ 'x-user-id': owner, 'content-type': 'application/json' })

test('同一选题再次生成会归档上一轮未确认草稿，不影响其他选题和已确认稿', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = jsonHeaders('regen-owner')
  const other = jsonHeaders('regen-other')

  const first = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers: owner, body: JSON.stringify({ topic_id: 11 }) })
  assert.equal(first.status, 201)
  const firstDrafts = await first.json()
  assert.equal(firstDrafts.length, 2)
  assert.ok(firstDrafts.every(item => !item.archived_at))

  const otherTopic = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers: owner, body: JSON.stringify({ topic_id: 12 }) })
  assert.equal(otherTopic.status, 201)
  const otherIds = (await otherTopic.json()).map(item => item.id)

  const second = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers: owner, body: JSON.stringify({ topic_id: 11 }) })
  assert.equal(second.status, 201)
  const secondDrafts = await second.json()
  assert.equal(secondDrafts.length, 2)
  assert.ok(secondDrafts.every(item => !item.archived_at))
  assert.ok(secondDrafts.every(item => !firstDrafts.some(previous => previous.id === item.id)))

  const all = await (await fetch(`${baseUrl}/api/drafts`, { headers: owner })).json()
  const topic11 = all.filter(item => item.topic_id === 11)
  assert.equal(topic11.filter(item => item.archived_at).length, 2)
  assert.equal(topic11.filter(item => !item.archived_at).length, 2)
  assert.deepEqual(topic11.filter(item => !item.archived_at).map(item => item.id).sort(), secondDrafts.map(item => item.id).sort())
  assert.ok(otherIds.every(id => all.find(item => item.id === id && !item.archived_at)), '其他选题的草稿不应被归档')

  const stranger = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers: other, body: JSON.stringify({ topic: { title: '别人的稿', strategy_layer: 'trust', goal_refs: [] } }) })
  assert.equal(stranger.status, 201)
  const afterStranger = await (await fetch(`${baseUrl}/api/drafts`, { headers: owner })).json()
  assert.equal(afterStranger.filter(item => item.topic_id === 11 && !item.archived_at).length, 2)
})
