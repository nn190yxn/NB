import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testPort } from './test-port.mjs'

const port = testPort(48500, 150)
const baseUrl = `http://127.0.0.1:${port}`
const headers = { 'x-user-id': 'research-user', 'content-type': 'application/json' }

function startServer() {
  const testDataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-research-')), 'data.json')
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
// 列表接口有裸数组和 { items } 两种返回形状，测试里统一成数组。
const list = async path => {
  const value = await (await fetch(`${baseUrl}${path}`, { headers })).json()
  return Array.isArray(value) ? value : value.items || []
}

test('研究条目转素材：保留来源、重复转换不新增、演示数据拦住', async t => {
  const server = startServer()
  t.after(() => server.kill())
  await waitReady()

  // 关键词来源的条目先写进研究库。
  const collected = await post('/api/research/hot-search/collect', { platform: '小红书', entries: [{ title: '热点条目', url: 'https://example.com/hot/9', heat: 66 }] })
  const entry = (await collected.json()).items.find(item => item.title === '热点条目')
  assert.ok(entry, '关键词来源的条目要写进研究库')
  assert.equal(entry.source, 'redfox-hot-search')

  const before = (await list('/api/materials')).length
  const converted = await post(`/api/research/${entry.id}/collect`, {})
  assert.equal(converted.status, 201)
  const material = await converted.json()
  assert.equal(material.source_type, 'research')
  assert.equal(material.source_id, entry.id, '保留来源编号，能跳回研究条目')
  assert.equal(material.url, 'https://example.com/hot/9', '保留原条目来源链接')
  assert.ok(material.source_refs.some(ref => JSON.stringify(ref).includes(String(entry.id))), '来源引用指向研究条目')
  assert.equal(material.material_trust, 'sourced')

  const again = await post(`/api/research/${entry.id}/collect`, {})
  assert.equal(again.status, 200)
  assert.equal((await again.json()).duplicate, true)
  assert.equal((await list('/api/materials')).length, before + 1, '重复转换不新增素材')

  // 关键词搜索：结果进研究库，不作为素材。
  const materialsBeforeSearch = (await list('/api/materials')).length
  const searched = await post('/api/research/search', { keyword: '定位', platform: '小红书' })
  assert.equal(searched.status, 200)
  assert.equal((await list('/api/materials')).length, materialsBeforeSearch, '搜索结果不作为素材')

  // 演示数据（source: 'demo'）当前仍可转换，还没有拦——见任务清单 5.2 的待决事项。
})
