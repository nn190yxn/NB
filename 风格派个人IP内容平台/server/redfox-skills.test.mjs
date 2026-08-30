import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'

const port = 3900 + Math.floor(Math.random() * 150)
const mockPort = port + 500
const baseUrl = `http://127.0.0.1:${port}`
const mockUrl = `http://127.0.0.1:${mockPort}`
const headers = { 'content-type': 'application/json', 'x-user-id': 'skill-user' }

const mockRequests = []
const mockServer = createServer((request, response) => {
  let body = ''
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    mockRequests.push({ url: request.url, apiKey: request.headers['x-api-key'] || '', body })
    const json = payload => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(payload)) }
    if (request.url.startsWith('/v1/search')) return json({ items: [{ platform: 'B站', title: '红狐搜索结果：副业复盘', author: '真实作者', metrics: { discussions: 555, growth: 12 } }] })
    if (request.url.startsWith('/v1/hot-search')) return json({ items: [{ rank: 1, title: '红狐热榜第一名', heat: 9999 }] })
    if (request.url.startsWith('/v1/prohibited-check')) return json({ hits: [{ word: '第一', level: '极限词', suggestion: '红狐建议' }] })
    if (request.url.startsWith('/v1/similar-accounts')) return json({ items: [{ nickname: '红狐对标号', followers: '2.5w', pillar: '方法拆解', similarity: 0.88, reason: '内容支柱接近' }] })
    response.writeHead(404); response.end('{}')
  })
})

function startServer(extraEnv = {}) {
  const testDataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-skills-')), 'data.json')
  writeFileSync(testDataFile, '{}')
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: testDataFile, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 5000)
    child.stdout.on('data', data => {
      if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) }
    })
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

test('红狐 Skill：无配置走演示数据双轨，六条路由可用', async t => {
  const server = await startServer()
  t.after(() => server.kill())

  const search = await (await fetch(`${baseUrl}/api/research/search`, { method: 'POST', headers, body: JSON.stringify({ keyword: '副业复盘', platform: '小红书' }) })).json()
  assert.equal(search.source, 'demo')
  assert.ok(search.added >= 1)
  assert.ok(search.items.some(item => item.title.includes('副业复盘')))

  const hotSearch = await (await fetch(`${baseUrl}/api/research/hot-search`, { method: 'POST', headers, body: JSON.stringify({ platform: '小红书' }) })).json()
  assert.equal(hotSearch.source, 'demo')
  assert.ok(hotSearch.items.length >= 1)

  const similar = await (await fetch(`${baseUrl}/api/research/similar`, { method: 'POST', headers, body: JSON.stringify({ account: '某某聊IP', platform: '抖音' }) })).json()
  assert.equal(similar.source, 'demo')
  assert.ok(similar.items.some(item => item.nickname.includes('某某聊IP')))

  const draft = (await (await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title: '最好的一课' } }) })).json())[0]
  const compliance = await (await fetch(`${baseUrl}/api/drafts/${draft.id}/compliance`, { method: 'POST', headers, body: JSON.stringify({}) })).json()
  assert.equal(compliance.source, 'demo')
  assert.ok(compliance.hits.some(hit => hit.word === '最好'))

  const suggest = await (await fetch(`${baseUrl}/api/research/suggest`, { headers })).json()
  assert.ok(Array.isArray(suggest.suggestions) && suggest.suggestions.length >= 1)

  const invalidSearch = await fetch(`${baseUrl}/api/research/search`, { method: 'POST', headers, body: JSON.stringify({}) })
  assert.equal(invalidSearch.status, 422)
})

test('红狐 Skill：请求头配置走真实调用并携带 x-api-key，热搜可入库', async t => {
  await new Promise(resolve => mockServer.listen(mockPort, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => mockServer.close(resolve)))
  const server = await startServer()
  t.after(() => server.kill())
  mockRequests.length = 0

  const foxHeaders = { ...headers, 'x-redfox-base-url': mockUrl, 'x-redfox-api-key': 'skill-fox-key' }

  const search = await (await fetch(`${baseUrl}/api/research/search`, { method: 'POST', headers: foxHeaders, body: JSON.stringify({ keyword: '定位', platform: 'B站' }) })).json()
  assert.equal(search.source, 'redfox')
  assert.ok(search.items.some(item => item.title.includes('红狐搜索结果')))
  const searchCall = mockRequests.find(entry => entry.url.startsWith('/v1/search'))
  assert.equal(searchCall.apiKey, 'skill-fox-key')
  assert.match(searchCall.url, /platform=B%E7%AB%99|platform=B站/)

  const hotSearch = await (await fetch(`${baseUrl}/api/research/hot-search`, { method: 'POST', headers: foxHeaders, body: JSON.stringify({ platform: '小红书' }) })).json()
  assert.equal(hotSearch.source, 'redfox')

  const collect = await (await fetch(`${baseUrl}/api/research/hot-search/collect`, { method: 'POST', headers, body: JSON.stringify({ entries: [{ title: '红狐热榜第一名', heat: 9999 }], platform: '小红书' }) })).json()
  assert.equal(collect.added, 1)
  assert.ok(collect.items.some(item => item.title === '红狐热榜第一名'))

  const similar = await (await fetch(`${baseUrl}/api/research/similar`, { method: 'POST', headers: foxHeaders, body: JSON.stringify({ account: '某某聊IP' }) })).json()
  assert.equal(similar.source, 'redfox')
  assert.equal(similar.items[0].nickname, '红狐对标号')

  const draft = (await (await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title: '普通草稿' } }) })).json())[0]
  const compliance = await (await fetch(`${baseUrl}/api/drafts/${draft.id}/compliance`, { method: 'POST', headers: foxHeaders, body: JSON.stringify({ text: '这是第一名的 absolute 文案' }) })).json()
  assert.equal(compliance.source, 'redfox')
  assert.equal(compliance.hits[0].word, '第一')
})

test('红狐 Skill：环境变量回退与上游错误处理', async t => {
  await new Promise(resolve => mockServer.listen(mockPort, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => mockServer.close(resolve)))
  const server = await startServer({ REDFOX_API_URL: mockUrl, PROJECT_REDFOX_API_KEY: 'env-fox-key' })
  t.after(() => server.kill())
  mockRequests.length = 0

  const search = await (await fetch(`${baseUrl}/api/research/search`, { method: 'POST', headers, body: JSON.stringify({ keyword: '定位', platform: '小红书' }) })).json()
  assert.equal(search.source, 'redfox')
  assert.equal(mockRequests.find(entry => entry.url.startsWith('/v1/search')).apiKey, 'env-fox-key')

  const hotSearch = await (await fetch(`${baseUrl}/api/research/hot-search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: '微博' }) })).json()
  assert.equal(hotSearch.source, 'redfox')
  assert.equal(hotSearch.items[0].title, '红狐热榜第一名')
})
