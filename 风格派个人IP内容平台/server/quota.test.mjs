import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { testPort, listenLocal } from './test-port.mjs'

const port = testPort(47300, 200)
const baseUrl = `http://127.0.0.1:${port}`
let mockUrl = ''
const headers = { 'content-type': 'application/json', 'x-user-id': 'quota-user' }

const upstreamHits = { redfox: 0, llm: 0 }
// 生成闸门有「字数严重不足（低于目标下限六成）」一条，假模型回的长短必须写够平台下限，
// 否则生成会走重写路径，额度测试拿不到首轮草稿。四个平台的措辞彼此不同，避免被判成「四平台同一篇」。
const fillTo = (seed, min) => { let out = ''; while (out.length < min) out += seed; return out }
const mockBodies = title => ({
  master: fillTo(`母版：${title}。先给判断，再拆常见做法，最后给一步能做的动作。`, 320),
  小红书: fillTo(`小红书正文：${title}。昨天有个做家政的老板来问，账号发了半年还是没人咨询。我让她把最近十条翻出来，发现全在讲行业趋势。`, 400),
  抖音: fillTo(`抖音口播：${title}。上周我翻了后台，点赞会撒谎，询盘不会。别再为流量写，为成交写。`, 300),
  视频号: fillTo(`视频号口播：${title}。上周我翻了后台，泛泛而谈找路人，讲具体场面才找得着人。`, 300),
  公众号: fillTo(`公众号正文：${title}。上周我翻了后台，把内容当作品会自嗨。把内容当一次实验，看有没有人来问怎么买。`, 1000),
})
const mockServer = createServer((request, response) => {
  let body = ''
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    const json = payload => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(payload)) }
    if (request.url.startsWith('/story/api/xhsUser/searchArticle')) { upstreamHits.redfox += 1; return json({ code: 2000, msg: '成功', data: { list: [{ workId: 'w1', workTitle: `共享搜索结果 ${upstreamHits.redfox}`, workUrl: 'https://example.com/w', commentCount: 10 }] } }) }
    if (request.url.includes('/chat/completions')) {
      upstreamHits.llm += 1
      const messages = JSON.parse(body).messages || []
      if (String(messages[0]?.content || '').includes('文案写手')) {
        const brief = JSON.parse(messages.at(-1).content)
        return json({ choices: [{ message: { content: JSON.stringify(mockBodies(brief.title)) } }] })
      }
      return json({ choices: [{ message: { content: '[{"memory_type":"style","content":"共享模型提炼的记忆"}]' } }] })
    }
    response.writeHead(404); response.end('{}')
  })
})

function startServer(extraEnv = {}) {
  const testDataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-quota-')), 'data.json')
  writeFileSync(testDataFile, '{}')
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port), NODE_ENV: 'test', DATA_FILE: testDataFile,
      REDFOX_API_URL: mockUrl, PROJECT_REDFOX_API_KEY: 'shared-redfox-key',
      REDFOX_DAILY_LIMIT: '2', LLM_DAILY_LIMIT: '1',
      PROJECT_LLM_BASE_URL: mockUrl, PROJECT_LLM_API_KEY: 'shared-llm-key', PROJECT_LLM_MODEL: 'shared-model',
      ...extraEnv,
    },
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

test('共享额度：默认走共享 Key，超额 429，自有 Key 豁免', async t => {
  mockUrl = (await listenLocal(mockServer)).baseUrl
  t.after(() => new Promise(resolve => mockServer.close(resolve)))
  const server = await startServer()
  t.after(() => server.kill())

  const search = () => fetch(`${baseUrl}/api/research/search`, { method: 'POST', headers, body: JSON.stringify({ keyword: '副业', platform: '小红书' }) })
  const first = await search()
  assert.equal(first.status, 200)
  assert.equal((await first.json()).source, 'redfox')
  assert.equal(await search().then(response => response.status), 200)
  const third = await search()
  assert.equal(third.status, 429)
  assert.match((await third.json()).error, /共享搜索额度已用完/)

  const usage = await (await fetch(`${baseUrl}/api/usage/today`, { headers })).json()
  assert.equal(usage.redfox.used, 2)
  assert.equal(usage.redfox.limit, 2)
  assert.equal(usage.redfox.shared, true)

  const ownSession = await fetch(`${baseUrl}/api/auth/session`, { method: 'POST', headers: { 'x-user-id': 'own-key-user' } })
  const ownCookie = ownSession.headers.get('set-cookie').split(';', 1)[0]
  const saveKey = await fetch(`${baseUrl}/api/redfox-settings`, {
    method: 'PUT',
    headers: { cookie: ownCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ base_url: mockUrl, api_key: 'own-redfox-key' }),
  })
  assert.equal(saveKey.status, 200)
  const ownSearch = await fetch(`${baseUrl}/api/research/search`, { method: 'POST', headers: { cookie: ownCookie, 'content-type': 'application/json' }, body: JSON.stringify({ keyword: '副业', platform: '小红书' }) })
  assert.equal(ownSearch.status, 200)
  const ownUsage = await (await fetch(`${baseUrl}/api/usage/today`, { headers: { cookie: ownCookie } })).json()
  assert.equal(ownUsage.redfox.shared, false)
  assert.equal(ownUsage.redfox.used, 0)

  const extract = body => fetch(`${baseUrl}/api/memories/extract`, { method: 'POST', headers, body: JSON.stringify({ text: body }) })
  const firstExtract = await extract('第一段对话：我开头从来不用问句。')
  assert.equal(firstExtract.status, 200)
  assert.equal((await firstExtract.json()).provider, 'primary')
  const secondExtract = await extract('第二段对话：失败复盘类选题我数据更好。')
  assert.equal(secondExtract.status, 429)
  assert.match((await secondExtract.json()).error, /共享 AI 额度已用完/)
  assert.equal(usage.date, (await (await fetch(`${baseUrl}/api/usage/today`, { headers })).json()).date)

  const exhaustedDraft = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title: '额度耗尽', strategy_layer: 'trust', goal_refs: [] } }) })
  assert.equal(exhaustedDraft.status, 429)

  const draftSession = await fetch(`${baseUrl}/api/auth/session`, { method: 'POST', headers: { 'x-user-id': 'quota-draft-user' } })
  const draftCookie = draftSession.headers.get('set-cookie').split(';', 1)[0]
  const draftHeaders = { cookie: draftCookie, 'content-type': 'application/json' }
  const generated = await (await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers: draftHeaders, body: JSON.stringify({ topic: { title: '额度降级测试', strategy_layer: 'trust', goal_refs: [] } }) })).json()
  const draft = generated[0]
  assert.ok(draft.body.startsWith('小红书正文：额度降级测试'))
  const redfoxHitsBeforeCompliance = upstreamHits.redfox
  const compliance = await fetch(`${baseUrl}/api/drafts/${draft.id}/compliance`, { method: 'POST', headers: draftHeaders, body: JSON.stringify({ text: '这是最好的测试内容' }) })
  assert.equal(compliance.status, 200)
  assert.equal((await compliance.json()).source, 'builtin')
  assert.equal(upstreamHits.redfox, redfoxHitsBeforeCompliance)
  assert.equal((await (await fetch(`${baseUrl}/api/usage/today`, { headers })).json()).redfox.used, 2)

  const adaptation = await fetch(`${baseUrl}/api/drafts/${draft.id}/adapt`, { method: 'POST', headers: draftHeaders, body: JSON.stringify({ platform: '小红书' }) })
  assert.equal(adaptation.status, 200)
  assert.ok((await adaptation.json()).adaptations['小红书'])
  const snapshot = await (await fetch(`${baseUrl}/api/performance-snapshots`, { method: 'POST', headers: draftHeaders, body: JSON.stringify({ draft_id: draft.id, platform: '抖音', metrics: { 播放量: 1000, 点赞数: 80 }, status: 'confirmed' }) })).json()
  const retrospect = await fetch(`${baseUrl}/api/performance-snapshots/${snapshot.id}/retrospect`, { method: 'POST', headers: draftHeaders, body: '{}' })
  assert.equal(retrospect.status, 200)
  assert.ok(['winner', 'ok', 'underperformed'].includes((await retrospect.json()).snapshot.retrospect.verdict))

  const fallbackSession = await fetch(`${baseUrl}/api/auth/session`, { method: 'POST', headers: { 'x-user-id': 'fallback-only-user' } })
  const fallbackCookie = fallbackSession.headers.get('set-cookie').split(';', 1)[0]
  const fallbackHeaders = { cookie: fallbackCookie, 'content-type': 'application/json' }
  const saveFallback = await fetch(`${baseUrl}/api/api-settings/text_fallback`, {
    method: 'PUT', headers: fallbackHeaders,
    body: JSON.stringify({ enabled: true, base_url: mockUrl, model: 'own-fallback-model', api_key: 'own-fallback-key' }),
  })
  assert.equal(saveFallback.status, 200)
  const fallbackExtract = text => fetch(`${baseUrl}/api/memories/extract`, { method: 'POST', headers: fallbackHeaders, body: JSON.stringify({ text }) })
  assert.equal((await fallbackExtract('只配置备用模型的第一次调用')).status, 200)
  assert.equal((await fallbackExtract('只配置备用模型的第二次调用')).status, 429)
  const fallbackUsage = await (await fetch(`${baseUrl}/api/usage/today`, { headers: fallbackHeaders })).json()
  assert.equal(fallbackUsage.llm.shared, true)
  assert.equal(fallbackUsage.llm.used, 1)

  const ownLlmSession = await fetch(`${baseUrl}/api/auth/session`, { method: 'POST', headers: { 'x-user-id': 'own-llm-user' } })
  const ownLlmCookie = ownLlmSession.headers.get('set-cookie').split(';', 1)[0]
  const ownLlmHeaders = { cookie: ownLlmCookie, 'content-type': 'application/json' }
  const saveOwnPrimary = await fetch(`${baseUrl}/api/api-settings/text_primary`, {
    method: 'PUT', headers: ownLlmHeaders,
    body: JSON.stringify({ enabled: true, base_url: mockUrl, model: 'own-primary-model', api_key: 'own-primary-key' }),
  })
  assert.equal(saveOwnPrimary.status, 200)
  const ownExtract = text => fetch(`${baseUrl}/api/memories/extract`, { method: 'POST', headers: ownLlmHeaders, body: JSON.stringify({ text }) })
  assert.equal((await ownExtract('自有主模型第一次调用')).status, 200)
  assert.equal((await ownExtract('自有主模型第二次调用')).status, 200)
  const ownLlmUsage = await (await fetch(`${baseUrl}/api/usage/today`, { headers: ownLlmHeaders })).json()
  assert.equal(ownLlmUsage.llm.shared, false)
  assert.equal(ownLlmUsage.llm.used, 0)
})
