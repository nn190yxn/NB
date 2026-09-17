import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testPort } from './test-port.mjs'
import { migrateUnitTypes, unitTypeFromKind, unitTypes } from './unit-types.mjs'

const port = testPort(48300, 150)
const baseUrl = `http://127.0.0.1:${port}`
const headers = { 'x-user-id': 'unit-user', 'content-type': 'application/json' }

function startServer() {
  const testDataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-unit-')), 'data.json')
  writeFileSync(testDataFile, '{}')
  return spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: testDataFile },
    stdio: 'ignore',
  })
}

async function waitReady() {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/materials`, { headers })
      if (response.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('测试 API 启动超时')
}

const post = (path, body) => fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })

test('迁移映射：金句是主张、热点是问题、经历是案例', () => {
  assert.deepEqual(unitTypes, ['QST', 'CON', 'OPI', 'CAS', 'SOL'])
  assert.equal(unitTypeFromKind('quote'), 'OPI')
  assert.equal(unitTypeFromKind('hotspot'), 'QST')
  assert.equal(unitTypeFromKind('experience'), 'CAS')
  assert.equal(unitTypeFromKind('insight'), null, 'insight 分不出概念还是案例，留空等人工')
  assert.equal(unitTypeFromKind('article'), null, 'article 是容器，不生成角色')
  assert.equal(unitTypeFromKind(undefined), null)
})

test('迁移可重入：只补空的、不覆盖人工判定、不删除记录', () => {
  const materials = [
    { id: 1, material_kind: 'quote' },
    { id: 2, material_kind: 'insight' },
    { id: 3, material_kind: 'article' },
    { id: 4, material_kind: 'experience', unit_type: 'SOL' },
    { id: 5, material_kind: 'hotspot' },
  ]
  const ids = materials.map(item => item.id)

  const report = migrateUnitTypes(materials)
  assert.deepEqual(report, { scanned: 5, assigned: 2, pending: 1, skipped: 1 })
  assert.deepEqual(materials.map(item => item.id), ids, '不删除记录')
  assert.equal(materials[0].unit_type, 'OPI')
  assert.equal(materials[1].unit_type, undefined, '无法判定的留空待人工')
  assert.equal(materials[2].unit_type, undefined, 'article 不生成角色')
  assert.equal(materials[3].unit_type, 'SOL', '人工定过的不被覆盖')

  const second = migrateUnitTypes(materials)
  assert.equal(second.assigned, 0, '再跑一次没有新指派')
  assert.equal(second.scanned, 5, '再跑一次仍然扫全量')
  assert.deepEqual(materials.map(item => item.unit_type), ['OPI', undefined, undefined, 'SOL', 'QST'])
})

test('素材库按认知角色读写、筛选与计数', async t => {
  const server = startServer()
  t.after(() => server.kill())
  await waitReady()

  const quote = await post('/api/materials/atoms', { text: '先把一条讲透，再谈放大', kind: 'quote' })
  assert.equal(quote.status, 201)
  assert.equal((await quote.json()).unit_type, 'OPI', '金句按映射落 OPI')

  const experience = await post('/api/materials/atoms', { text: '我开过一家店，第三个月才回本', kind: 'experience' })
  assert.equal((await experience.json()).unit_type, 'CAS')

  const solution = await post('/api/materials/atoms', { text: '三步走：先定位，再取材，最后改稿', kind: 'insight', unit_type: 'SOL' })
  assert.equal((await solution.json()).unit_type, 'SOL', '人工能直接指定角色，不用等迁移')

  // 采集素材走真实链路：热搜收录 → 研究条目转素材，落 QST。
  const collected = await post('/api/research/hot-search/collect', { platform: '小红书', entries: [{ title: '一条热点标题', url: 'https://example.com/1' }] })
  const research = (await collected.json()).items
  const hotspot = await (await post(`/api/research/${research[0].id}/collect`, {})).json()
  assert.equal(hotspot.unit_type, 'QST')

  // 上传的知识点分不出概念还是案例，留空。
  await post('/api/materials/import', { name: '一份知识点', content: '知识的定义与边界，先讲清楚再谈用。', material_kind: 'insight' })
  // 文章是容器不是认知单元，不该进「待定」列表。
  await post('/api/materials/import', { name: '一篇文章', content: '正文很长的文章内容，用来确认文章容器不会进待定列表。' })

  const counts = await (await fetch(`${baseUrl}/api/materials?kind_counts=1`, { headers })).json()
  assert.equal(counts.unit_type_counts.OPI, 1)
  assert.equal(counts.unit_type_counts.CAS, 1)
  assert.equal(counts.unit_type_counts.QST, 1)
  assert.equal(counts.unit_type_counts.SOL, 1)
  assert.equal(counts.unit_type_counts.CON, 0)
  assert.equal(counts.unit_type_counts.unset, 1, '留空的单独计数，等着人工判定')

  const filtered = await (await fetch(`${baseUrl}/api/materials?unit_type=OPI&page=1`, { headers })).json()
  assert.equal(filtered.total, 1)
  assert.equal(filtered.items[0].unit_type, 'OPI')

  const empty = await (await fetch(`${baseUrl}/api/materials?unit_type=SOL&page=1`, { headers })).json()
  assert.equal(empty.total, 1)

  const pending = await (await fetch(`${baseUrl}/api/materials?unit_type=unset&page=1`, { headers })).json()
  assert.equal(pending.total, 1, '待定只列真该人工判定的，文章容器不算')
  assert.equal(pending.items[0].name, '一份知识点')

  const listed = await (await fetch(`${baseUrl}/api/materials`, { headers })).json()
  assert.equal(listed.length, 6)
  assert.ok(listed.every(item => 'unit_type' in item), '列表里每一条都要带 unit_type，没有就是 null')
})
