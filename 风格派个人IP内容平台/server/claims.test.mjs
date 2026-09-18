import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseClaims } from './claims.mjs'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

const llmMock = await startSharedLlmMock()
const port = testPort(48700, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'claims-test-')), 'data.json')
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
const post = (path, owner, body) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: headers(owner), body: JSON.stringify(body) })

test('提主张：三栏齐全、超两条给提示但不拦、确认后才落 OPI 素材', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'claims-owner'
  const materials = async () => (await (await fetch(`${baseUrl}/api/materials`, { headers: headers(owner) })).json()).length

  assert.equal((await post('/api/skills/claims', owner, {})).status, 422, '没给素材要拦下来')

  const before = await materials()
  const response = await post('/api/skills/claims', owner, { text: '内容要按成交写。点赞会撒谎，询盘不会。案例比观点更能带来咨询。' })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.claims.length, 3)
  assert.ok(result.mechanism, '要有核心机制')
  assert.ok(result.judgement && result.scope && result.why, '核心判断 / 适用范围 / 为什么重要三栏都要有')
  assert.match(result.notice, /超过建议的 2 条/, '超过两条要提示')
  assert.equal(await materials(), before, '提主张只是提案，不能自己写进素材库')

  const edited = `核心判断（我改过的版本）：${result.judgement}`
  const saved = await post('/api/materials/atoms', owner, { kind: 'insight', text: edited, name: '主张', unit_type: 'OPI', source_label: '提主张' })
  assert.equal(saved.status, 201)
  const material = await saved.json()
  assert.equal(material.content, edited, '入库的是用户改后的文本')
  assert.equal(material.unit_type, 'OPI')
  assert.equal(material.material_trust, 'verified')
  assert.equal(await materials(), before + 1, '确认后恰好新增一条')
})

test('解析：一条主张不提示、零主张明确说明未提取到、缺核心判断直接报错', () => {
  const single = parseClaims(JSON.stringify({ claims: [' 先给判断再给动作 '], judgement: '立一条', mechanism: '机制', scope: '范围', why: '原因' }))
  assert.deepEqual(single.claims, ['先给判断再给动作'])
  assert.equal(single.notice, null, '一条主张不该被提示')

  const none = parseClaims(JSON.stringify({ claims: [], judgement: '没有可立的判断', mechanism: '', scope: '', why: '' }))
  assert.deepEqual(none.claims, [])
  assert.match(none.notice, /没有提取到可检验的主张/, '零主张要说清楚，不编一个')

  const many = parseClaims(JSON.stringify({ claims: ['一', '二', '三'], judgement: '三条', mechanism: '', scope: '', why: '' }))
  assert.match(many.notice, /超过建议的 2 条/)

  assert.throws(() => parseClaims(JSON.stringify({ claims: ['一'] })), /核心判断/)
  assert.throws(() => parseClaims('[]'), /不是对象/)
})
