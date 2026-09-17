import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testPort } from './test-port.mjs'
import { materialTrustLevels, materialTrustOf } from './validation.mjs'

const port = testPort(48100, 150)
const baseUrl = `http://127.0.0.1:${port}`
const headers = { 'x-user-id': 'trust-user', 'content-type': 'application/json' }

function startServer() {
  const testDataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-trust-')), 'data.json')
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

test('素材可信度三档：缺省与历史素材都读成 verified', () => {
  assert.deepEqual([...materialTrustLevels].sort(), ['derived', 'sourced', 'verified'])
  assert.equal(materialTrustOf({ material_trust: 'sourced' }), 'sourced')
  assert.equal(materialTrustOf({ material_trust: 'derived' }), 'derived')
  assert.equal(materialTrustOf({}), 'verified', '历史素材没有这个字段，按 verified 读')
  assert.equal(materialTrustOf({ material_trust: '外部资料' }), 'verified', '非法值退回 verified')
  assert.equal(materialTrustOf(null), 'verified')
})

test('手动上传与手动新建默认 verified，客户端不能自封可信度', async t => {
  const server = startServer()
  t.after(() => server.kill())
  await waitReady()

  const uploaded = await post('/api/materials/import', { name: '访谈记录', content: '他说，先把一条讲透，再谈放大。' })
  assert.equal(uploaded.status, 201)
  const material = await uploaded.json()
  assert.equal(material.material_trust, 'verified')

  const forged = await post('/api/materials/import', { name: '自封来源', content: '这条想把自己标成 sourced。', material_trust: 'sourced' })
  assert.equal(forged.status, 201)
  assert.equal((await forged.json()).material_trust, 'verified', '只有火狐采集那条路能给 sourced，上传不能自封')

  const atom = await post('/api/materials/atoms', { text: '先把一条讲透', kind: 'quote', source_id: material.id })
  assert.equal(atom.status, 201)
  assert.equal((await atom.json()).material_trust, 'verified')

  const listed = await (await fetch(`${baseUrl}/api/materials`, { headers })).json()
  assert.equal(listed.length, 3)
  assert.ok(listed.every(item => item.material_trust === 'verified'), '不带查询参数的列表也要带可信度')

  const paged = await (await fetch(`${baseUrl}/api/materials?page=1&page_size=50`, { headers })).json()
  assert.equal(paged.items.length, 3)
  assert.ok(paged.items.every(item => item.material_trust === 'verified'), '分页列表也要带可信度')
})

test('可信度筛选、计数与来源缺失', async t => {
  const server = startServer()
  t.after(() => server.kill())
  await waitReady()

  // 手动上传走 verified。
  await post('/api/materials/import', { name: '访谈记录', content: '他说，先把一条讲透。' })

  // 火狐采集走 sourced：热搜收录进研究库，再从研究条目转素材。
  const collected = await post('/api/research/hot-search/collect', { platform: '小红书', entries: [{ title: '追光小牛上了热搜', url: 'https://example.com/hot/1', heat: 88 }, { title: '一条没有链接的热点' }] })
  assert.equal(collected.status, 200)
  const research = (await collected.json()).items
  assert.equal(research.length, 2)
  for (const entry of research) {
    const converted = await post(`/api/research/${entry.id}/collect`, {})
    assert.equal(converted.status, 201)
    assert.equal((await converted.json()).material_trust, 'sourced', '火狐采集默认 sourced')
  }

  const counts = await (await fetch(`${baseUrl}/api/materials?kind_counts=1`, { headers })).json()
  assert.equal(counts.trust_counts.verified, 1)
  assert.equal(counts.trust_counts.sourced, 2)
  assert.equal(counts.trust_counts.derived, 0)

  const sourced = await (await fetch(`${baseUrl}/api/materials?trust=sourced&page=1`, { headers })).json()
  assert.equal(sourced.total, 2)
  assert.ok(sourced.items.every(item => item.material_trust === 'sourced'))
  assert.deepEqual(sourced.items.map(item => item.url).filter(Boolean), ['https://example.com/hot/1'], '采集素材要带来源链接')
  assert.equal(sourced.items.filter(item => !item.url).length, 1, '缺来源链接的那条要能被前端识别出来标「来源缺失」')

  const verified = await (await fetch(`${baseUrl}/api/materials?trust=verified&page=1`, { headers })).json()
  assert.equal(verified.total, 1)
  assert.equal(verified.items[0].name, '访谈记录')
})
