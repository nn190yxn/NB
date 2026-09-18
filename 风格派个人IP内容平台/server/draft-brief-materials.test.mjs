import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { draftNumbers, unbackedNumberHits } from './draft-checks.mjs'
import { buildDraftBrief, groupMaterialsByRole } from './draft-writing.mjs'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

test('按认知角色分组，范围外的角色和空内容被丢掉', () => {
  const groups = groupMaterialsByRole([
    { id: 3, unit_type: 'CAS', content: '一个家政老板的真实案例', name: '案例A', material_trust: 'verified' },
    { id: 1, unit_type: 'QST', content: '客户为什么不来问价' },
    { id: 2, unit_type: 'OPI', content: '内容要按成交写' },
    { id: 4, unit_type: 'XXX', content: '不该出现的角色' },
    { id: 5, unit_type: 'CON', content: '   ' },
  ])
  assert.deepEqual(groups.CAS.map(item => item.text), ['一个家政老板的真实案例'])
  assert.equal(groups.CAS[0].trust, 'verified')
  assert.equal(groups.QST.length, 1)
  assert.equal(groups.OPI.length, 1)
  assert.deepEqual(groups.SOL, [])
  assert.equal(groups.XXX, undefined, '范围外的角色不建组')
})

test('同一批素材无论传入顺序如何，简报里的顺序都按 id 升序稳定', () => {
  const materials = [
    { id: 9, unit_type: 'CAS', content: '后面那条' },
    { id: 2, unit_type: 'CAS', content: '前面那条' },
  ]
  const first = groupMaterialsByRole(materials)
  const second = groupMaterialsByRole([...materials].reverse())
  assert.deepEqual(first.CAS.map(item => item.text), ['前面那条', '后面那条'])
  assert.deepEqual(first, second, '顺序不稳定会让同一选题两次生成的简报不同，出问题无法复现')
})

test('没有素材时简报明确说明在裸写，有素材时不提示', () => {
  const empty = buildDraftBrief({ topic: { title: '空手写' } })
  assert.match(empty.material_gap, /没有可用素材/)
  assert.match(empty.material_gap, /不要编/)
  assert.deepEqual(empty.material_roles.CAS, [])

  const withMaterial = buildDraftBrief({ topic: { title: '有料' }, materials: [{ id: 1, unit_type: 'CAS', content: '真实案例' }] })
  assert.equal(withMaterial.material_gap, null)
  assert.equal(withMaterial.material_roles.CAS[0].text, '真实案例')
})

test('只抓像数据声明的数字，个位数修辞不误伤', () => {
  assert.deepEqual(draftNumbers('发了半年没人问，786 条数据、3 个动作、涨了 30%'), ['786', '30%'])
  assert.deepEqual(draftNumbers('一步就好，三个动作，2 个方法'), [], '个位数且无单位的数字是修辞，当成数据只会误伤')
  assert.deepEqual(draftNumbers(''), [])
})

test('素材和简报里没有的数字才标记，有的不标记', () => {
  const body = '我有个客户，发了半年没人问，后来做到 786 条数据、涨了 30%'
  assert.deepEqual(unbackedNumberHits(body, '786 条数据'), ['30%'], '素材里有的不标，没有的才标')
  assert.deepEqual(unbackedNumberHits(body, '素材里只有 786 和 30%'), [])
  assert.deepEqual(unbackedNumberHits(body, ''), ['786', '30%'])
})

const llmMock = await startSharedLlmMock()
const port = testPort(49000, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'draft-brief-test-')), 'data.json')
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

test('选中的角色素材进简报并进溯源；一条素材都没有也照样生成', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'brief-materials-owner'
  const headers = { 'x-user-id': owner, 'content-type': 'application/json' }

  const created = await (await fetch(`${baseUrl}/api/materials/atoms`, { method: 'POST', headers, body: JSON.stringify({ kind: 'experience', text: '我有个做家政的客户，发了半年没人来咨询', name: '家政客户案例', unit_type: 'CAS', source_label: '实测' }) })).json()
  assert.ok(created.id, '先得真的建出一条素材')

  const response = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title: '为什么发了半年没人来问', strategy_layer: 'trust', goal_refs: [] }, material_ids: [created.id] }) })
  assert.equal(response.status, 201)
  const drafts = await response.json()
  const brief = drafts[0].generation_context.brief
  assert.equal(brief.material_roles.CAS[0].text, '我有个做家政的客户，发了半年没人来咨询', '选中的 CAS 素材要进简报')
  assert.equal(brief.material_gap, null, '有素材就不该提示裸写')
  assert.ok(drafts[0].source_refs.some(ref => ref.type === 'material' && ref.id === created.id), '用到的素材要进溯源')

  // 9.3：一条素材都不给也要能生成，并在简报里说明在裸写、不许编。
  const bare = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title: '没有任何素材的选题', strategy_layer: 'trust', goal_refs: [] } }) })
  assert.equal(bare.status, 201, '没有素材不是错误，必须能生成')
  const bareDrafts = await bare.json()
  assert.match(bareDrafts[0].generation_context.brief.material_gap, /没有可用素材/)
  // 数字标记只记录、不拦停：干净的一版不该有误报，但字段必须在。
  assert.deepEqual(drafts[0].generation_context.gate.unbacked_numbers, [], '正文里的数字都来自素材时不该误报')
  assert.ok(Array.isArray(bareDrafts[0].generation_context.gate.unbacked_numbers), '标记字段不能因为没问题就不存在')
})
