import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseDeconstruction } from './deconstruct.mjs'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

const llmMock = await startSharedLlmMock()
const port = testPort(48600, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'deconstruct-test-')), 'data.json')
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

const headers = owner => ({ 'x-user-id': owner, 'content-type': 'application/json' })

test('拆概念返回四段式产出并判定 Question 还是 Problem', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'deconstruct-owner'

  const missing = await fetch(`${baseUrl}/api/skills/deconstruct`, { method: 'POST', headers: headers(owner), body: JSON.stringify({}) })
  assert.equal(missing.status, 422, '没给概念词要拦下来')

  const response = await fetch(`${baseUrl}/api/skills/deconstruct`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ term: '定位' }) })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.term, '定位')
  assert.ok(result.assumed, '要有「你以为它是什么」')
  assert.ok(result.usages.length >= 2, '至少两个场景的用法')
  assert.ok(result.restored, '要有概念还原')
  assert.ok(result.plain, '要有大白话版本')
  assert.equal(result.kind, 'question')
  assert.equal(result.unit_type, 'CON', 'Question 是概念没对齐，产出物是还原后的概念')
})

test('解析：无效 kind 退回 question，usages 清掉空值，缺概念还原直接报错', () => {
  const parsed = parseDeconstruction(JSON.stringify({ assumed: ' a ', usages: ['培训里当卖点说', '', '   '], restored: '其实指一组可重复的动作', plain: '就是照着做的那套步骤', kind: 'unknown' }))
  assert.equal(parsed.kind, 'question', 'kind 不认识时按概念处理，不能默默当成问题')
  assert.equal(parsed.unit_type, 'CON')
  assert.deepEqual(parsed.usages, ['培训里当卖点说'])
  assert.equal(parsed.assumed, 'a', '首尾空白要清掉')

  const problem = parseDeconstruction(JSON.stringify({ restored: '边界清楚的问题', kind: 'problem' }))
  assert.equal(problem.kind, 'problem')
  assert.equal(problem.unit_type, 'QST')
  assert.deepEqual(problem.usages, [], '没给用法就是空数组，不是 undefined')

  assert.throws(() => parseDeconstruction(JSON.stringify({ kind: 'question' })), /概念还原/)
  assert.throws(() => parseDeconstruction('[]'), /不是对象/)
})
