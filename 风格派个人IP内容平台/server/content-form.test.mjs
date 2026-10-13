import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { contentForms, parseFormJudgement } from './content-form.mjs'
import { draftVideoFormats } from './draft-writing.mjs'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

const llmMock = await startSharedLlmMock()
const port = testPort(48800, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'content-form-test-')), 'data.json')
writeFileSync(dataFile, '{}')

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...llmMock.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 20000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

const judge = (owner, topic) => fetch(`${baseUrl}/api/skills/form`, { method: 'POST', headers: { 'x-user-id': owner, 'content-type': 'application/json' }, body: JSON.stringify({ topic }) })

test('形式判断：给出推荐形式与理由，形式落在写作层认得的集合里', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'form-owner'

  assert.equal((await judge(owner, '')).status, 422, '没给选题要拦下来')

  const response = await judge(owner, '为什么内容要按成交写')
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.ok(contentForms.includes(result.form), `推荐形式必须可用：${result.form}`)
  assert.ok(result.reason, '要给出推荐理由')

  const long = await (await judge(owner, '长文：把内容当成一次成交实验')).json()
  assert.equal(long.form, '长文', '选集里写明长文的，应推荐长文')

  // 模型给了范围外的形式：透出契约错误，并标记为不可重试，别让人一直点重试。
  const bad = await judge(owner, '错形式：随便挑一个')
  assert.equal(bad.status, 502)
  const badBody = await bad.json()
  assert.match(badBody.error, /不在可用范围内/)
  assert.equal(badBody.retryable, false)
})

test('解析：形式集合与写作层一致，范围外的形式与缺理由都直接报错', () => {
  assert.deepEqual(contentForms, [...Object.keys(draftVideoFormats), '长文'])
  assert.throws(() => parseFormJudgement(JSON.stringify({ form: '播客', reason: '播客能讲得深' })), /不在可用范围内/)
  assert.throws(() => parseFormJudgement(JSON.stringify({ form: '短视频' })), /缺少推荐理由/)
  assert.throws(() => parseFormJudgement('[]'), /不是对象/)

  const trimmed = parseFormJudgement(JSON.stringify({ form: ' 短视频 ', reason: ' 一句话判断就够 ' }))
  assert.deepEqual(trimmed, { form: '短视频', reason: '一句话判断就够' })
})
