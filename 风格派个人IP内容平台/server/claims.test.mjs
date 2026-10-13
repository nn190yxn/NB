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
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 20000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

const headers = owner => ({ 'x-user-id': owner, 'content-type': 'application/json' })
const post = (path, owner, body) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: headers(owner), body: JSON.stringify(body) })

test('提主张：一对角度各出主张、超两条给提示但不拦、逐条确认后才落 OPI 素材', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'claims-owner'
  const materials = async () => (await (await fetch(`${baseUrl}/api/materials`, { headers: headers(owner) })).json()).length

  assert.equal((await post('/api/skills/claims', owner, {})).status, 422, '没给素材要拦下来')

  const before = await materials()
  const response = await post('/api/skills/claims', owner, { text: '内容要按成交写。点赞会撒谎，询盘不会。案例比观点更能带来咨询。', angles: ['老板', '员工'] })
  assert.equal(response.status, 200)
  const result = await response.json()
  // 一对角度分两次问：每个角度各出自己的主张，合起来 4 条。
  assert.equal(result.claims.length, 4)
  assert.ok(result.mechanism, '要有核心机制')
  assert.ok(result.judgement && result.scope && result.why, '核心判断 / 适用范围 / 为什么重要三栏都要有')
  assert.match(result.notice, /超过建议的 2 条/, '超过两条要提示')
  assert.equal(await materials(), before, '提主张只是提案，不能自己写进素材库')

  // 每条主张带自己的角度：一组主张要能看出谁是老板视角、谁是员工视角。
  assert.deepEqual(result.angles, ['老板', '员工'])
  assert.ok(result.run_id, '一次运行要有编号，反方才查得出来')
  assert.equal(result.claim_items.length, 4)
  assert.deepEqual([...new Set(result.claim_items.map(item => item.angle))].sort(), ['员工', '老板'], '两个角度都要有自己的主张，反方才不是空的')
  assert.equal(result.per_angle.length, 2, '每个角度各自的四段式都要能回看')

  // 逐条入库：勾两条就落两条，不再揉成一段话。
  const stored = []
  for (const item of result.claim_items.slice(0, 2)) {
    const saved = await post('/api/materials/atoms', owner, { kind: 'insight', text: item.text, name: item.text.slice(0, 40), unit_type: 'OPI', source_label: '提主张', angle: item.angle, claims_run: result.run_id })
    assert.equal(saved.status, 201)
    stored.push(await saved.json())
  }
  assert.equal(await materials(), before + 2, '勾几条落几条')
  assert.deepEqual(stored.map(item => item.unit_type), ['OPI', 'OPI'])
  assert.equal(stored[0].material_trust, 'verified')
  assert.ok(stored[0].angle, '角度要存进素材')
  assert.equal(stored[0].claims_run, result.run_id, '同一次拆解的主张共享编号')

  // 重复确认同一条：并回原来那条，不叠加。
  const again = await post('/api/materials/atoms', owner, { kind: 'insight', text: result.claim_items[0].text, unit_type: 'OPI', source_label: '提主张', angle: result.claim_items[0].angle })
  assert.equal((await again.json()).duplicate, true)
  assert.equal(await materials(), before + 2, '同一句主张再确认不该多出第二条')

  const edited = `核心判断（我改过的版本）：${result.judgement}`
  const saved = await post('/api/materials/atoms', owner, { kind: 'insight', text: edited, name: '主张', unit_type: 'OPI', source_label: '提主张' })
  assert.equal(saved.status, 201)
  assert.equal((await saved.json()).content, edited, '入库的是用户改后的文本')
  assert.equal(await materials(), before + 3, '核心判断另存一条')
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

  // 反驳式的第二个角度可以回答「提不出不同说法」：那是没有角度差异，不是模型坏了，不该抛错。
  const silent = parseClaims(JSON.stringify({ claims: [], judgement: '', mechanism: '', scope: '', why: '' }), ['员工'])
  assert.deepEqual(silent.claim_items, [])
  assert.match(silent.notice, /没有提取到可检验的主张/)
  assert.throws(() => parseClaims('[]'), /不是对象/)
})

// 真模型跑 M2 时唯一未过的那一步就是这个：第二个角度交了白卷，反方于是空的。
// 白卷本身合法（素材可能真没角度差），但第一轮常常是懒得换位——所以逼问一次，再空就如实空着。
test('第二个角度交白卷时逼问一次，逼出来的是它自己的立场', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'claims-blank-owner'
  const response = await post('/api/skills/claims', owner, { text: '空角度：内容要按成交写。点赞会撒谎，询盘不会。', angles: ['老板', '员工'] })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.per_angle.length, 2)
  assert.equal(result.per_angle[0].claims.length, 2, '主角度照常出主张')
  assert.equal(result.per_angle[1].claims.length, 2, '第二个角度第一轮交白卷，逼问一次要真的再问一轮')
  assert.deepEqual([...new Set(result.claim_items.map(item => item.angle))].sort(), ['员工', '老板'], '配对关系不能因为一次白卷就丢')
  assert.equal(result.claims.length, 4)
})
