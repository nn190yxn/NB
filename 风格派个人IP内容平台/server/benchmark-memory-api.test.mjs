import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'
const llmMock = await startSharedLlmMock()

const port = testPort(44600, 400)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'benchmark-memory-test-')), 'data.json')
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
const readJson = async response => response.json()

test('对标机制必须带来源，并支持把错记的机制纠正过来', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'benchmark-owner'

  const noSource = await fetch(`${baseUrl}/api/memories`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ memory_type: 'benchmark', content: '开头用预测攻击式' }) })
  assert.equal(noSource.status, 422, '对标机制不带来源会被当成创作者本人的表达习惯')

  const created = await fetch(`${baseUrl}/api/memories`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ memory_type: 'benchmark', content: '开头用预测攻击式', source_label: '对标dbs' }) })
  assert.equal(created.status, 201)
  const memory = await readJson(created)
  assert.equal(memory.memory_type, 'benchmark')
  assert.equal(memory.source_label, '对标dbs')

  // 迁移路径：旧记录被错记成 style，改成 benchmark 时必须同时给出来源
  const mislabelled = await readJson(await fetch(`${baseUrl}/api/memories`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ memory_type: 'style', content: '先驰后立：先承认或驳斥受众常见做法' }) }))
  assert.equal(mislabelled.memory_type, 'style')
  const badFix = await fetch(`${baseUrl}/api/memories/${mislabelled.id}`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ memory_type: 'benchmark' }) })
  assert.equal(badFix.status, 422)
  const fixed = await readJson(await fetch(`${baseUrl}/api/memories/${mislabelled.id}`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ memory_type: 'benchmark', source_label: '对标dbs' }) }))
  assert.equal(fixed.memory_type, 'benchmark')
  assert.equal(fixed.source_label, '对标dbs')

  const list = await readJson(await fetch(`${baseUrl}/api/memories?type=benchmark`, { headers: headers(owner) }))
  assert.equal(list.length, 2)
  assert.ok(list.every(item => item.source_label === '对标dbs'))

  const badType = await fetch(`${baseUrl}/api/memories`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ memory_type: 'made-up', content: '类型不存在' }) })
  assert.equal(badType.status, 422)
})

test('对标素材留存来源标注，旧数据回退到名称前缀', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'atom-source-owner'

  const created = await readJson(await fetch(`${baseUrl}/api/materials/atoms`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ kind: 'quote', name: '对标dbs·金句', text: '对标账号的金句要能看出出处', source_label: '对标dbs' }) }))
  assert.equal(created.source_label, '对标dbs')
  assert.equal(created.name, '对标dbs·金句')

  const listed = await readJson(await fetch(`${baseUrl}/api/materials?kind=quote`, { headers: headers(owner) }))
  const row = (listed.items || listed).find(item => item.id === created.id)
  assert.equal(row.source_label, '对标dbs')

  // 手工录入的素材不带来源，界面按手动创建处理
  const manual = await readJson(await fetch(`${baseUrl}/api/materials/atoms`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ kind: 'quote', name: '自己的金句', text: '这是我自己总结的一句话' }) }))
  assert.equal(manual.source_label, null)
})

test('生成简报把对标机制与他本人的表达习惯分开，并带上来源', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'brief-owner'

  await fetch(`${baseUrl}/api/memories`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ memory_type: 'benchmark', content: '结尾三选一：金句复现 / 社会反思提问 / 行动号召', source_label: '对标dbs' }) })
  await fetch(`${baseUrl}/api/memories`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ memory_type: 'style', content: '我的开头从不用问句' }) })
  await fetch(`${baseUrl}/api/memories`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ memory_type: 'feedback', content: '失败复盘类选题数据更好' }) })

  const atom = await readJson(await fetch(`${baseUrl}/api/materials/atoms`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ kind: 'quote', name: '对标dbs·金句', text: '找一个足够大、足够有价值、没被同行研究清楚的领域' }) }))
  const generated = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ topic: { title: '对标机制与自有表达分开', strategy_layer: 'trust', goal_refs: [] }, quote_ids: [atom.id] }) })
  assert.equal(generated.status, 201)
  const [draft] = await readJson(generated)
  const brief = draft.generation_context.brief

  assert.deepEqual(brief.mechanisms, [{ content: '结尾三选一：金句复现 / 社会反思提问 / 行动号召', source: '对标dbs' }])
  assert.deepEqual(brief.style, ['我的开头从不用问句', '失败复盘类选题数据更好'])
  assert.ok(brief.style.every(item => !item.includes('结尾三选一')), '对标机制不能混进 style')
  assert.deepEqual(brief.quotes, [{ text: '找一个足够大、足够有价值、没被同行研究清楚的领域', source: '对标dbs·金句' }])
})
