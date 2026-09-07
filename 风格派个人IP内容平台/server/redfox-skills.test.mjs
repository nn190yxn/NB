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
    mockRequests.push({ url: request.url, method: request.method, apiKey: request.headers['redfox_api_key'] || '', body })
    const json = payload => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(payload)) }
    if (request.url.startsWith('/story/api/hotKeyword/list')) return json({ code: 2000, msg: '成功', data: [{ hotSpotList: [{ platName: '小红书', title: '红狐聚合热点', maxHotScore: 5555, url: 'https://example.com/hot' }] }] })
    if (request.url.startsWith('/story/api/hotSpot/getListByPlatformWithKeyword')) return json({ code: 2000, msg: '成功', data: { bdList: [{ index: 1, title: '红狐关键词热点', hotCount: '888', url: 'https://example.com/kw' }] } })
    if (request.url.startsWith('/story/api/hotSpot/getListByPlatform')) return json({ code: 2000, msg: '成功', data: [{ index: 1, title: '红狐热榜第一名', hotCount: '9999' }] })
    if (request.url.startsWith('/story/api/xhsUser/searchArticle')) return json({ code: 2000, msg: '成功', data: { list: [{ workId: 'w1', workTitle: '红狐搜索结果：副业复盘', workDesc: '正文', workUrl: 'https://example.com/w1', commentCount: 555 }] } })
    if (request.url.startsWith('/story/api/xhsUser/searchUser')) return json({ code: 2000, msg: '成功', data: { list: [{ accountName: '红狐对标号', accountFans: 25000, accountLikes: 88000, accountDesc: '内容支柱接近', accountId: 'acc-1' }] } })
    if (request.url.startsWith('/story/api/bili/data/workSearch')) return json({ code: 2000, msg: '成功', data: { workList: [{ bvId: 'BV1fox', title: '红狐搜索结果：副业复盘', description: '简介' }] } })
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

test('红狐 Skill：无配置时研究走演示数据、合规走本地词库，六条路由可用', async t => {
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
  assert.equal(compliance.source, 'builtin')
  assert.ok(compliance.hits.some(hit => hit.word === '最好'))

  const suggest = await (await fetch(`${baseUrl}/api/research/suggest`, { headers })).json()
  assert.ok(Array.isArray(suggest.suggestions) && suggest.suggestions.length >= 1)

  const invalidSearch = await fetch(`${baseUrl}/api/research/search`, { method: 'POST', headers, body: JSON.stringify({}) })
  assert.equal(invalidSearch.status, 422)
})

test('红狐 Skill：请求头配置走官网真实接口并携带 REDFOX_API_KEY，热搜可入库', async t => {
  await new Promise(resolve => mockServer.listen(mockPort, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => mockServer.close(resolve)))
  const server = await startServer()
  t.after(() => server.kill())
  mockRequests.length = 0

  const foxHeaders = { ...headers, 'x-redfox-base-url': mockUrl, 'x-redfox-api-key': 'skill-fox-key' }

  const search = await (await fetch(`${baseUrl}/api/research/search`, { method: 'POST', headers: foxHeaders, body: JSON.stringify({ keyword: '定位', platform: 'B站' }) })).json()
  assert.equal(search.source, 'redfox')
  assert.ok(search.items.some(item => item.title.includes('红狐搜索结果')))
  const searchCall = mockRequests.find(entry => entry.url.startsWith('/story/api/bili/data/workSearch'))
  assert.equal(searchCall.method, 'POST')
  assert.equal(searchCall.apiKey, 'skill-fox-key')
  assert.deepEqual(JSON.parse(searchCall.body).keyword, '定位')

  const hotSearch = await (await fetch(`${baseUrl}/api/research/hot-search`, { method: 'POST', headers: foxHeaders, body: JSON.stringify({ platform: '小红书' }) })).json()
  assert.equal(hotSearch.source, 'redfox')
  const hotCall = mockRequests.find(entry => entry.url.startsWith('/story/api/hotSpot/getListByPlatform'))
  assert.equal(hotCall.method, 'GET')
  assert.match(hotCall.url, /platform=6/)

  const keywordHot = await (await fetch(`${baseUrl}/api/research/keyword-hot-search`, { method: 'POST', headers: foxHeaders, body: JSON.stringify({ keyword: '副业', days: 7 }) })).json()
  assert.equal(keywordHot.source, 'redfox')
  assert.equal(keywordHot.items[0].title, '红狐关键词热点')
  assert.equal(keywordHot.items[0].platform, '百度')
  const kwCall = mockRequests.find(entry => entry.url.startsWith('/story/api/hotSpot/getListByPlatformWithKeyword'))
  assert.equal(kwCall.method, 'POST')
  assert.deepEqual(JSON.parse(kwCall.body).keywords, ['副业'])

  const collect = await (await fetch(`${baseUrl}/api/research/hot-search/collect`, { method: 'POST', headers, body: JSON.stringify({ entries: [{ title: '红狐热榜第一名', heat: 9999 }], platform: '小红书' }) })).json()
  assert.equal(collect.added, 1)
  assert.ok(collect.items.some(item => item.title === '红狐热榜第一名'))

  const similar = await (await fetch(`${baseUrl}/api/research/similar`, { method: 'POST', headers: foxHeaders, body: JSON.stringify({ account: '某某聊IP' }) })).json()
  assert.equal(similar.source, 'redfox')
  assert.equal(similar.items[0].nickname, '红狐对标号')

  const draft = (await (await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title: '普通草稿' } }) })).json())[0]
  const compliance = await (await fetch(`${baseUrl}/api/drafts/${draft.id}/compliance`, { method: 'POST', headers: foxHeaders, body: JSON.stringify({ text: '这是第一名的 absolute 文案' }) })).json()
  assert.equal(compliance.source, 'builtin')
  assert.equal(compliance.hits[0].word, '第一')

  const trending = await (await fetch(`${baseUrl}/api/research/refresh`, { method: 'POST', headers: foxHeaders, body: '{}' })).json()
  assert.equal(trending.source, 'redfox')
  assert.ok(trending.items.some(item => item.title === '红狐聚合热点'))
})

test('红狐 Skill：环境变量回退与上游错误处理', async t => {
  await new Promise(resolve => mockServer.listen(mockPort, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => mockServer.close(resolve)))
  const server = await startServer({ REDFOX_API_URL: mockUrl, PROJECT_REDFOX_API_KEY: 'env-fox-key' })
  t.after(() => server.kill())
  mockRequests.length = 0

  const search = await (await fetch(`${baseUrl}/api/research/search`, { method: 'POST', headers, body: JSON.stringify({ keyword: '定位', platform: '小红书' }) })).json()
  assert.equal(search.source, 'redfox')
  const searchCall = mockRequests.find(entry => entry.url.startsWith('/story/api/xhsUser/searchArticle'))
  assert.equal(searchCall.apiKey, 'env-fox-key')
  assert.deepEqual(JSON.parse(searchCall.body), { keyword: '定位', offset: 0, sortType: '_0', exactMatch: false })

  const hotSearch = await (await fetch(`${baseUrl}/api/research/hot-search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: '微博' }) })).json()
  assert.equal(hotSearch.source, 'redfox')
  assert.equal(hotSearch.items[0].title, '红狐热榜第一名')
})
