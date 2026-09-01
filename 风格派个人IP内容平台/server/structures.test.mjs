import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 3400 + Math.floor(Math.random() * 200)
const baseUrl = `http://127.0.0.1:${port}`
const headers = { 'content-type': 'application/json', 'x-user-id': 'structures-user' }

function startServer() {
  const testDataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-structures-')), 'data.json')
  writeFileSync(testDataFile, '{}')
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: testDataFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 5000)
    child.stdout.on('data', data => {
      if (String(data).includes('Content IP API listening')) {
        clearTimeout(timeout)
        resolve(child)
      }
    })
    child.once('error', reject)
    child.once('exit', code => {
      if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`))
    })
  })
}

test('结构库支持检索、筛选、增删改、收藏与使用计数', async t => {
  const server = await startServer()
  t.after(() => server.kill())

  const empty = await fetch(`${baseUrl}/api/structures`, { headers })
  assert.equal(empty.status, 200)
  assert.deepEqual(await empty.json(), { items: [], total: 0, page: 1, page_size: 50 })

  const invalid = await fetch(`${baseUrl}/api/structures`, { method: 'POST', headers, body: JSON.stringify({ title: '  ', steps: [] }) })
  assert.equal(invalid.status, 400)

  const created = await fetch(`${baseUrl}/api/structures`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: '反常识开场结构', steps: ['反常识开场', '真实案例', '方法拆解'], platform: '小红书', content_type: '观点' }),
  })
  assert.equal(created.status, 201)
  const structure = await created.json()
  assert.equal(structure.source_kind, 'manual')
  assert.equal(structure.usage_count, 0)
  assert.equal(structure.favorite, false)

  await fetch(`${baseUrl}/api/structures`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: '清单型干货框架', steps: ['痛点清单', '逐条方法', '行动号召'], platform: '抖音', content_type: '清单' }),
  })
  await fetch(`${baseUrl}/api/structures`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: '失败复盘故事线', steps: ['公开失败账本', '提炼教训'], platform: '小红书', content_type: '故事' }),
  })

  const searchByStep = await fetch(`${baseUrl}/api/structures?q=${encodeURIComponent('账本')}`, { headers })
  const searchResult = await searchByStep.json()
  assert.equal(searchResult.total, 1)
  assert.equal(searchResult.items[0].title, '失败复盘故事线')

  const byPlatform = await (await fetch(`${baseUrl}/api/structures?platform=${encodeURIComponent('小红书')}`, { headers })).json()
  assert.equal(byPlatform.total, 2)

  const byType = await (await fetch(`${baseUrl}/api/structures?content_type=${encodeURIComponent('清单')}`, { headers })).json()
  assert.equal(byType.total, 1)
  assert.equal(byType.items[0].title, '清单型干货框架')

  const byOpeningMethod = await (await fetch(`${baseUrl}/api/structures?method_category=${encodeURIComponent('开头方法')}`, { headers })).json()
  assert.equal(byOpeningMethod.total, 1)
  assert.equal(byOpeningMethod.items[0].title, '反常识开场结构')

  const byContentStructure = await (await fetch(`${baseUrl}/api/structures?method_category=${encodeURIComponent('内容结构')}`, { headers })).json()
  assert.equal(byContentStructure.total, 2)

  const toggled = await (await fetch(`${baseUrl}/api/structures/${structure.id}`, { method: 'PUT', headers, body: JSON.stringify({ favorite: true }) })).json()
  assert.equal(toggled.favorite, true)

  const favorites = await (await fetch(`${baseUrl}/api/structures?favorite=1`, { headers })).json()
  assert.equal(favorites.total, 1)

  const usage = await (await fetch(`${baseUrl}/api/structures/${structure.id}`, { method: 'PUT', headers, body: JSON.stringify({ record_usage: true }) })).json()
  assert.equal(usage.usage_count, 1)
  const usageAgain = await (await fetch(`${baseUrl}/api/structures/${structure.id}`, { method: 'PUT', headers, body: JSON.stringify({ record_usage: true }) })).json()
  assert.equal(usageAgain.usage_count, 2)

  const byUsage = await (await fetch(`${baseUrl}/api/structures?sort=usage`, { headers })).json()
  assert.equal(byUsage.items[0].id, structure.id)

  const renamed = await (await fetch(`${baseUrl}/api/structures/${structure.id}`, { method: 'PUT', headers, body: JSON.stringify({ title: '反常识开场 2.0', steps: ['反常识开场', '方法拆解'] }) })).json()
  assert.equal(renamed.title, '反常识开场 2.0')
  assert.equal(renamed.steps.length, 2)

  const invalidUpdate = await fetch(`${baseUrl}/api/structures/${structure.id}`, { method: 'PUT', headers, body: JSON.stringify({ title: '' }) })
  assert.equal(invalidUpdate.status, 400)

  const removed = await fetch(`${baseUrl}/api/structures/${structure.id}`, { method: 'DELETE', headers })
  assert.equal(removed.status, 204)
  const afterDelete = await (await fetch(`${baseUrl}/api/structures`, { headers })).json()
  assert.equal(afterDelete.total, 2)
  const idempotentDelete = await fetch(`${baseUrl}/api/structures/${structure.id}`, { method: 'DELETE', headers })
  assert.equal(idempotentDelete.status, 204)
})

test('研究分析自动沉淀结构并幂等，草稿生成累计使用计数', async t => {
  const server = await startServer()
  t.after(() => server.kill())

  await fetch(`${baseUrl}/api/research/refresh`, { method: 'POST', headers })
  const research = await (await fetch(`${baseUrl}/api/research`, { headers })).json()
  assert.ok(research.length >= 1)

  const analyzed = await fetch(`${baseUrl}/api/research/${research[0].id}/analyze`, { method: 'POST', headers })
  assert.equal(analyzed.status, 200)

  const first = await (await fetch(`${baseUrl}/api/structures`, { headers })).json()
  assert.equal(first.total, 1)
  assert.equal(first.items[0].source_kind, 'research')
  assert.equal(first.items[0].source_id, research[0].id)

  await fetch(`${baseUrl}/api/research/${research[0].id}/analyze`, { method: 'POST', headers })
  const second = await (await fetch(`${baseUrl}/api/structures`, { headers })).json()
  assert.equal(second.total, 1)

  const drafts = await (await fetch(`${baseUrl}/api/drafts/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ topic: { title: '测试选题', strategy_layer: 'trust', goal_refs: [] }, structure_id: second.items[0].id }),
  })).json()
  assert.equal(drafts.length, 4)
  assert.ok(drafts[0].body.includes('结构：'))
  assert.ok(drafts[0].source_refs.some(ref => ref.type === 'structure' && ref.id === second.items[0].id))

  const afterUsage = await (await fetch(`${baseUrl}/api/structures`, { headers })).json()
  assert.equal(afterUsage.items[0].usage_count, 1)

  const sortedByUsage = await (await fetch(`${baseUrl}/api/structures?sort=usage`, { headers })).json()
  assert.equal(sortedByUsage.items[0].usage_count, 1)
})
