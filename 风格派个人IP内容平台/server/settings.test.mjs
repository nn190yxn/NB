import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'

const port = 3800 + Math.floor(Math.random() * 150)
const mockPort = port + 500
const baseUrl = `http://127.0.0.1:${port}`
const mockUrl = `http://127.0.0.1:${mockPort}`

const mockRequests = []
const mockServer = createServer((request, response) => {
  let body = ''
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    mockRequests.push({ url: request.url, authorization: request.headers.authorization || '', apiKey: request.headers['x-api-key'] || '' })
    if (request.url.startsWith('/models')) {
      if (request.headers.authorization === 'Bearer good-key') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'demo-model' }] })) }
      else { response.writeHead(401); response.end('{}') }
      return
    }
    if (request.url.startsWith('/v1/trending')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ items: [] }))
      return
    }
    response.writeHead(404); response.end('{}')
  })
})

function startServer(extraEnv = {}) {
  const testDataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-settings-')), 'data.json')
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

test('API 中心连通测试与红狐配置透传', async t => {
  await new Promise(resolve => mockServer.listen(mockPort, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => mockServer.close(resolve)))

  const server = await startServer()
  t.after(() => server.kill())

  const missingType = await fetch(`${baseUrl}/api/settings/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ base_url: mockUrl }) })
  assert.equal(missingType.status, 422)

  const badUrl = await fetch(`${baseUrl}/api/settings/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'llm', base_url: 'not-a-url' }) })
  assert.equal(badUrl.status, 422)

  const badProtocol = await fetch(`${baseUrl}/api/settings/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'llm', base_url: 'ftp://example.com' }) })
  assert.equal(badProtocol.status, 422)

  const llmOk = await fetch(`${baseUrl}/api/settings/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'llm', base_url: mockUrl, api_key: 'good-key' }) })
  assert.equal(llmOk.status, 200)
  assert.deepEqual(await llmOk.json(), { ok: true })

  const llmBadKey = await fetch(`${baseUrl}/api/settings/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'llm', base_url: mockUrl, api_key: 'wrong-key' }) })
  const llmBadKeyResult = await llmBadKey.json()
  assert.equal(llmBadKeyResult.ok, false)
  assert.equal(llmBadKeyResult.status, 401)
  assert.match(llmBadKeyResult.error, /API Key/)

  const redfoxOk = await fetch(`${baseUrl}/api/settings/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'redfox', base_url: mockUrl, api_key: 'fox-key' }) })
  assert.equal(redfoxOk.status, 200)
  assert.deepEqual(await redfoxOk.json(), { ok: true })
  assert.match(mockRequests.at(-1).url, /^\/v1\/trending/)
  assert.equal(mockRequests.at(-1).apiKey, 'fox-key')

  const unreachable = await fetch(`${baseUrl}/api/settings/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'llm', base_url: 'http://127.0.0.1:9', api_key: 'k' }) })
  const unreachableResult = await unreachable.json()
  assert.equal(unreachableResult.ok, false)
  assert.match(unreachableResult.error, /连接/)

  const headerConfig = { 'content-type': 'application/json', 'x-redfox-base-url': mockUrl, 'x-redfox-api-key': 'header-fox-key' }
  const refresh = await fetch(`${baseUrl}/api/research/refresh`, { method: 'POST', headers: headerConfig, body: '{}' })
  assert.equal(refresh.status, 200)
  const foxCall = mockRequests.filter(entry => entry.url.startsWith('/v1/trending')).at(-1)
  assert.equal(foxCall.apiKey, 'header-fox-key')
})
