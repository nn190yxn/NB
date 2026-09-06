import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let nextPort = 3500 + Math.floor(Math.random() * 150)
function startServer() {
  const port = nextPort++
  const baseUrl = `http://127.0.0.1:${port}`
  const logs = []
  const dataFile = join(mkdtempSync(join(tmpdir(), 'api-settings-test-')), 'data.json')
  writeFileSync(dataFile, '{}')
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile,
      API_CONFIG_ENCRYPTION_KEY: '33'.repeat(32),
      PROJECT_DB_HOST: '', PROJECT_DB_NAME: '', PROJECT_DB_USER: '', PROJECT_DB_PASSWORD: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', data => logs.push(String(data)))
  child.stderr.on('data', data => logs.push(String(data)))
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('API 配置测试服务启动超时')), 5000)
    child.stdout.on('data', data => {
      if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve({ child, logs, baseUrl, dataFile }) }
    })
    child.once('error', reject)
  })
}

async function session(baseUrl, userId) {
  const response = await fetch(`${baseUrl}/api/auth/session`, { method: 'POST', headers: { 'x-user-id': userId } })
  return response.headers.get('set-cookie').split(';', 1)[0]
}

async function startMockLlm(handler) {
  const upstream = createServer(handler)
  await new Promise((resolve, reject) => { upstream.once('error', reject); upstream.listen(0, '127.0.0.1', resolve) })
  return { upstream, baseUrl: `http://127.0.0.1:${upstream.address().port}` }
}

test('API settings are encrypted, masked and isolated by account', async t => {
  const { child, logs, baseUrl, dataFile } = await startServer()
  t.after(() => child.kill())
  const cookie = await session(baseUrl, 'api-user-a')
  const secret = 'sk-server-side-secret-9876'
  const saved = await fetch(`${baseUrl}/api/api-settings/text_primary`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true, base_url: 'https://text.example/v1', model: 'text-model', api_key: secret }),
  })
  assert.equal(saved.status, 200)
  const publicValue = await saved.json()
  assert.equal(publicValue.api_key_masked, '••••9876')
  assert.equal(publicValue.configured, true)
  assert.equal('api_key' in publicValue, false)
  assert.equal('encrypted_api_key' in publicValue, false)

  const persisted = readFileSync(dataFile, 'utf8')
  assert.doesNotMatch(persisted, new RegExp(secret))
  assert.match(persisted, /aes-256-gcm/)

  const otherCookie = await session(baseUrl, 'api-user-b')
  const other = await fetch(`${baseUrl}/api/api-settings`, { headers: { cookie: otherCookie } })
  const otherPrimary = (await other.json()).find(item => item.slot === 'text_primary')
  assert.equal(otherPrimary.configured, false)
  assert.doesNotMatch(logs.join(''), new RegExp(secret))
})

test('legacy browser migration endpoint requires an explicit request and stores both text slots', async t => {
  const { child, baseUrl } = await startServer()
  t.after(() => child.kill())
  const cookie = await session(baseUrl, 'migration-user')
  const before = await fetch(`${baseUrl}/api/api-settings`, { headers: { cookie } }).then(response => response.json())
  assert.equal(before.some(item => item.configured), false)

  const migrated = await fetch(`${baseUrl}/api/api-settings/migrate`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      text_primary: { enabled: true, base_url: 'https://primary.example/v1', model: 'p', api_key: 'primary-secret' },
      text_fallback: { enabled: true, base_url: 'https://fallback.example/v1', model: 'f', api_key: 'fallback-secret' },
    }),
  })
  assert.equal(migrated.status, 200)
  const values = await migrated.json()
  assert.equal(values.find(item => item.slot === 'text_primary').configured, true)
  assert.equal(values.find(item => item.slot === 'text_fallback').configured, true)
  assert.equal(values.find(item => item.slot === 'vision').configured, false)
})

test('saved text API can be tested through the action endpoint', async t => {
  const upstream = await startMockLlm(async (request, response) => {
    assert.equal(request.method, 'POST')
    assert.equal(request.url, '/chat/completions')
    assert.equal(request.headers.authorization, 'Bearer sk-test-secret')
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))
  })
  const { child, baseUrl } = await startServer()
  t.after(async () => {
    child.kill()
    await new Promise(resolve => upstream.upstream.close(resolve))
  })
  const cookie = await session(baseUrl, 'test-capability-user')
  const saved = await fetch(`${baseUrl}/api/api-settings/text_primary`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: false, base_url: upstream.baseUrl, model: 'test-model', api_key: 'sk-test-secret' }),
  })
  assert.equal(saved.status, 200)

  const tested = await fetch(`${baseUrl}/api/api-settings/text_primary?action=test`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(tested.status, 200)
  assert.deepEqual(await tested.json(), { ok: true, capability: 'text' })
})

test('text API test reports the upstream failure without exposing the key', async t => {
  const upstream = await startMockLlm((_request, response) => {
    response.statusCode = 401
    response.end('unauthorized')
  })
  const { child, logs, baseUrl } = await startServer()
  t.after(async () => {
    child.kill()
    await new Promise(resolve => upstream.upstream.close(resolve))
  })
  const cookie = await session(baseUrl, 'failed-capability-user')
  const secret = 'sk-failure-secret'
  await fetch(`${baseUrl}/api/api-settings/text_primary`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true, base_url: upstream.baseUrl, model: 'test-model', api_key: secret }),
  })

  const tested = await fetch(`${baseUrl}/api/api-settings/text_primary?action=test`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(tested.status, 200)
  assert.deepEqual(await tested.json(), { ok: false, error: '服务返回 401' })
  assert.doesNotMatch(logs.join(''), new RegExp(secret))
})

test('RedFox settings are encrypted per account and reused by research calls', async t => {
  const secret = 'redfox-server-secret'
  const seenMethods = {}
  const upstream = await startMockLlm((request, response) => {
    assert.equal(request.headers['redfox_api_key'], secret)
    seenMethods[request.url.split('?')[0]] = request.method
    const json = payload => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(payload)) }
    if (request.url.startsWith('/story/api/hotKeyword/list')) return json({ code: 2000, msg: '成功', data: [{ hotSpotList: [{ platName: '小红书', title: '账号红狐聚合热点', maxHotScore: 123 }] }] })
    if (request.url.startsWith('/story/api/hotSpot/getListByPlatform')) return json({ code: 2000, msg: '成功', data: [{ index: 1, title: '账号红狐热榜', hotCount: '999' }] })
    response.end(JSON.stringify({ code: 2000, msg: '成功', data: [] }))
  })
  const { child, logs, baseUrl, dataFile } = await startServer()
  t.after(async () => {
    child.kill()
    await new Promise(resolve => upstream.upstream.close(resolve))
  })
  const cookie = await session(baseUrl, 'redfox-account-user')
  const saved = await fetch(`${baseUrl}/api/redfox-settings`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ base_url: upstream.baseUrl, api_key: secret }),
  })
  assert.equal(saved.status, 200)
  const publicValue = await saved.json()
  assert.equal(publicValue.base_url, upstream.baseUrl)
  assert.equal(publicValue.configured, true)
  assert.equal(publicValue.api_key_masked, '••••cret')
  assert.equal('api_key' in publicValue, false)
  assert.doesNotMatch(readFileSync(dataFile, 'utf8'), new RegExp(secret))

  const tested = await fetch(`${baseUrl}/api/redfox-settings?action=test`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' })
  assert.equal(tested.status, 200)
  assert.deepEqual(await tested.json(), { ok: true, capability: 'redfox' })
  assert.equal(seenMethods['/story/api/hotKeyword/list'], 'POST')

  const hotSearch = await fetch(`${baseUrl}/api/research/hot-search`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ platform: '小红书' }) }).then(response => response.json())
  assert.equal(hotSearch.source, 'redfox')
  assert.equal(hotSearch.items[0].title, '账号红狐热榜')

  const otherCookie = await session(baseUrl, 'redfox-other-user')
  const other = await fetch(`${baseUrl}/api/redfox-settings`, { headers: { cookie: otherCookie } }).then(response => response.json())
  assert.equal(other.configured, false)
  assert.doesNotMatch(logs.join(''), new RegExp(secret))
})

test('记忆自动提炼调用账号配置的大模型并去重入库', async t => {
  const upstream = await startMockLlm((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      assert.match(body, /问句/)
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ choices: [{ message: { content: '好的，提炼如下：[{"memory_type":"style","content":"开头不用问句"},{"memory_type":"style","content":"开头不用问句"},{"memory_type":"bogus","content":"无效类型"}]' } }] }))
    })
  })
  const { child, logs, baseUrl } = await startServer()
  t.after(async () => {
    child.kill()
    await new Promise(resolve => upstream.upstream.close(resolve))
  })
  const cookie = await session(baseUrl, 'memory-extract-user')
  const saved = await fetch(`${baseUrl}/api/api-settings/text_primary`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true, base_url: upstream.baseUrl, model: 'test-model', api_key: 'sk-extract-key' }),
  })
  assert.equal(saved.status, 200)

  const extract = await fetch(`${baseUrl}/api/memories/extract`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ text: '昨天直播聊到我的开头从来不用问句，观众更喜欢直接给结论。' }) })
  assert.equal(extract.status, 200)
  const result = await extract.json()
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].content, '开头不用问句')
  assert.equal(result.items[0].source, 'auto')

  const list = await fetch(`${baseUrl}/api/memories`, { headers: { cookie } }).then(response => response.json())
  assert.equal(list.length, 1)
  assert.doesNotMatch(logs.join(''), /sk-extract-key/)
})
