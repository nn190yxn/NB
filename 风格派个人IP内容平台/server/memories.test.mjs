import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 3800 + Math.floor(Math.random() * 150)
const baseUrl = `http://127.0.0.1:${port}`

function startServer(extraEnv = {}) {
  const testDataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-memory-')), 'data.json')
  writeFileSync(testDataFile, '{}')
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: testDataFile, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 5000)
    child.stdout.on('data', data => {
      if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) }
    })
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

const jsonPost = (path, body) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('AI 记忆层：管理、去重与生成注入', async t => {
  const server = await startServer()
  t.after(() => server.kill())

  const badType = await jsonPost('/api/memories', { memory_type: 'other', content: '文本' })
  assert.equal(badType.status, 422)
  const emptyContent = await jsonPost('/api/memories', { memory_type: 'style', content: '  ' })
  assert.equal(emptyContent.status, 422)

  const created = await jsonPost('/api/memories', { memory_type: 'style', content: '我的开头从不用问句' })
  assert.equal(created.status, 201)
  const memory = await created.json()
  assert.equal(memory.provider, 'builtin')
  assert.equal(memory.source, 'manual')

  const duplicate = await jsonPost('/api/memories', { memory_type: 'style', content: '我的开头从不用问句' })
  assert.equal(duplicate.status, 200)
  assert.equal((await duplicate.json()).duplicate, true)

  const feedback = await jsonPost('/api/memories', { memory_type: 'feedback', content: '失败复盘类选题我数据更好' })
  assert.equal(feedback.status, 201)
  const feedbackMemory = await feedback.json()

  const listAll = await (await fetch(`${baseUrl}/api/memories`)).json()
  assert.equal(listAll.length, 2)
  const listStyle = await (await fetch(`${baseUrl}/api/memories?type=style`)).json()
  assert.equal(listStyle.length, 1)

  const extractEmpty = await jsonPost('/api/memories/extract', {})
  assert.equal(extractEmpty.status, 422)
  const extractNoLlm = await jsonPost('/api/memories/extract', { text: '一段没有配置大模型时的提炼文本' })
  assert.equal(extractNoLlm.status, 422)
  assert.equal((await extractNoLlm.json()).reason, 'llm_not_configured')

  const composed = await jsonPost('/api/drafts/generate', { topic: { title: '信任资产的三个证据', strategy_layer: 'trust', goal_refs: [] }, quote_ids: [], experience_ids: [] })
  assert.equal(composed.status, 201)
  const drafts = await composed.json()
  assert.match(drafts[0].body, /创作风格要求/)
  assert.match(drafts[0].body, /我的开头从不用问句/)
  assert.match(drafts[0].body, /失败复盘类选题我数据更好/)

  const archived = await fetch(`${baseUrl}/api/memories/${memory.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'archived' }) })
  assert.equal(archived.status, 200)
  const afterArchive = await jsonPost('/api/drafts/generate', { topic: { title: '新标题', strategy_layer: 'trust', goal_refs: [] }, quote_ids: [], experience_ids: [] })
  const afterArchiveDrafts = await afterArchive.json()
  assert.doesNotMatch(afterArchiveDrafts[0].body, /我的开头从不用问句/)

  const removed = await fetch(`${baseUrl}/api/memories/${feedbackMemory.id}`, { method: 'DELETE' })
  assert.equal(removed.status, 204)
  const afterDelete = await (await fetch(`${baseUrl}/api/memories`)).json()
  assert.equal(afterDelete.length, 1)
  assert.equal(afterDelete[0].status, 'archived')
})
