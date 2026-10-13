// 逻辑检查接口。查的是接线对不对：
// 参数校验、省钱闸门（圈不出范围就不调模型）、以及解析出来的引用必须真在正文里。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

const llmMock = await startSharedLlmMock()
const port = testPort(48800, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'logic-check-test-')), 'data.json')
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

const headers = owner => ({ 'x-user-id': owner, 'content-type': 'application/json' })
const post = (path, owner, body) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: headers(owner), body: JSON.stringify(body) })

// 既有问题、也有办法，才会被送去查。
const checkableDraft = [
  '你现在的痛点是不是这样：一打开摄像头，脑子一片空白。',
  '或者想着“这句话会不会得罪人”、“那个表情自不自然”。',
  '你以为需要灵感，其实你需要的是把念头切成碎片。',
].join('\n')

test('逻辑检查：空正文拦下来，圈不出范围不调模型，能查到就给引用', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'logic-check-owner'

  assert.equal((await post('/api/skills/logic-check', owner, {})).status, 422, '没给正文要拦下来')

  // 只提问、没给办法：无从判断治没治错病，直接返回空，别浪费一次调用。
  const noRemedy = await post('/api/skills/logic-check', owner, { body: '你是不是也这样？是不是很难？为什么总是做不好？' })
  assert.equal(noRemedy.status, 200)
  assert.deepEqual(await noRemedy.json(), { findings: [], checked: false }, '圈不出范围就不该送模型查')

  // 平铺直叙的稿子同理。
  const flat = await post('/api/skills/logic-check', owner, { body: '今天讲三个动作。第一个是抬手。第二个是转身。' })
  assert.deepEqual(await flat.json(), { findings: [], checked: false })

  // 既有问题又有办法：送查，并把引用挂回来。
  const found = await post('/api/skills/logic-check', owner, { body: checkableDraft })
  assert.equal(found.status, 200)
  const result = await found.json()
  assert.equal(result.checked, true)
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].code, 'problem_remedy_mismatch')
  assert.equal(result.findings[0].scope, 'locatable')
  // severity 是 DraftCheck.evidence 要求的字段，缺了前端按对象渲染会缺一块。
  assert.equal(result.findings[0].severity, 'warning')
  assert.ok(result.findings[0].message, '每条要有可直接显示的话')
  assert.ok(checkableDraft.includes(result.findings[0].quote), '引用必须真在正文里')
})

test('逻辑检查：模型编造的引用一律丢掉，不能放行', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'logic-check-forge'

  // 「编造引用」会让模拟模型回一句正文里根本没有的话。查一遍就该拦住。
  const body = `${checkableDraft}\n编造引用`
  const response = await post('/api/skills/logic-check', owner, { body })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.deepEqual(result.findings, [], '引用不在正文里就必须丢，宁可空手而归')
  // 丢掉这件事本身要说出来：不说的话，「模型报了但全被丢掉」和「模型说没问题」长得一样（finding 2026-09-20）。
  assert.equal(result.reported, 1, '模型报了几条')
  assert.equal(result.unverifiable, 1, '其中几条因为引用对不上被丢掉')
})
