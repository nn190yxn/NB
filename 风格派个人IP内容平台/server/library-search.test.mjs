import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 3600 + Math.floor(Math.random() * 200)
const baseUrl = `http://127.0.0.1:${port}`
const headers = { 'content-type': 'application/json', 'x-user-id': 'library-user' }

function startServer() {
  const testDataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-library-')), 'data.json')
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

test('素材检索：无参数保持数组兼容，带参数返回分页并正确过滤', async t => {
  const server = await startServer()
  t.after(() => server.kill())

  await fetch(`${baseUrl}/api/materials/import`, { method: 'POST', headers, body: JSON.stringify({ name: '访谈记录.md', content: '用户提到金句：真实过程胜过完美包装。' }) })
  await fetch(`${baseUrl}/api/materials/import`, { method: 'POST', headers, body: JSON.stringify({ name: '数据表格.csv', content: '日期,线索\n周一,5\n周二,8' }) })
  await fetch(`${baseUrl}/api/materials/import`, { method: 'POST', headers, body: JSON.stringify({ name: '空文档.txt', content: '' }) })

  const legacy = await fetch(`${baseUrl}/api/materials`, { headers })
  assert.equal(legacy.status, 200)
  const legacyBody = await legacy.json()
  assert.ok(Array.isArray(legacyBody))
  assert.equal(legacyBody.length, 3)

  const byQuery = await (await fetch(`${baseUrl}/api/materials?q=${encodeURIComponent('金句')}`, { headers })).json()
  assert.equal(byQuery.total, 1)
  assert.equal(byQuery.items[0].name, '访谈记录.md')
  assert.equal(byQuery.page_size, 50)

  const byNameQuery = await (await fetch(`${baseUrl}/api/materials?q=${encodeURIComponent('数据表格')}`, { headers })).json()
  assert.equal(byNameQuery.total, 1)

  const failed = await (await fetch(`${baseUrl}/api/materials?status=failed`, { headers })).json()
  assert.equal(failed.total, 1)
  assert.equal(failed.items[0].name, '空文档.txt')

  const ready = await (await fetch(`${baseUrl}/api/materials?status=ready&format=csv`, { headers })).json()
  assert.equal(ready.total, 0)

  const markdownReady = await (await fetch(`${baseUrl}/api/materials?status=ready&format=markdown`, { headers })).json()
  assert.equal(markdownReady.total, 1)

  const byName = await (await fetch(`${baseUrl}/api/materials?sort=name`, { headers })).json()
  assert.equal(byName.items[0].name, '访谈记录.md')

  const pageBeyond = await (await fetch(`${baseUrl}/api/materials?page=9`, { headers })).json()
  assert.equal(pageBeyond.items.length, 0)
  assert.equal(pageBeyond.total, 3)
})

test('研究检索：无参数保持数组兼容，带参数返回分页并正确过滤排序', async t => {
  const server = await startServer()
  t.after(() => server.kill())

  await fetch(`${baseUrl}/api/research/refresh`, { method: 'POST', headers })
  const all = await (await fetch(`${baseUrl}/api/research`, { headers })).json()
  assert.ok(Array.isArray(all))
  assert.ok(all.length >= 1)

  const legacy = await fetch(`${baseUrl}/api/research`, { headers })
  assert.equal(legacy.status, 200)
  assert.ok(Array.isArray(await legacy.json()))

  const paged = await (await fetch(`${baseUrl}/api/research?sort=latest`, { headers })).json()
  assert.equal(paged.total, all.length)
  assert.equal(paged.page, 1)
  assert.equal(paged.page_size, 50)

  const byPlatformMiss = await (await fetch(`${baseUrl}/api/research?platform=${encodeURIComponent('抖音')}`, { headers })).json()
  assert.equal(byPlatformMiss.total, 0)

  const byPlatformHit = await (await fetch(`${baseUrl}/api/research?platform=${encodeURIComponent('小红书')}`, { headers })).json()
  assert.equal(byPlatformHit.total, all.length)

  const byQueryMiss = await (await fetch(`${baseUrl}/api/research?q=${encodeURIComponent('不存在的标题')}`, { headers })).json()
  assert.equal(byQueryMiss.total, 0)

  const byGrowth = await (await fetch(`${baseUrl}/api/research?sort=growth`, { headers })).json()
  assert.equal(byGrowth.items.length, all.length)
})
