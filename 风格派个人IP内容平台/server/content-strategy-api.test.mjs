import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testPort } from './test-port.mjs'

const port = testPort(47800, 150)
const baseUrl = `http://127.0.0.1:${port}`
const jsonHeaders = owner => ({ 'x-user-id': owner, 'content-type': 'application/json' })

function startServer() {
  const dataFile = join(mkdtempSync(join(tmpdir(), 'content-strategy-test-')), 'data.json')
  writeFileSync(dataFile, '{}')
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('内容策略 API 启动超时')), 20000)
    child.stdout.on('data', data => {
      if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) }
    })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`内容策略 API 异常退出: ${code}`)) })
  })
}

test('内容策略：读写、校验、版本与账号隔离', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = jsonHeaders('strategy-owner')
  const other = jsonHeaders('strategy-other')

  const initial = await (await fetch(`${baseUrl}/api/content-strategy`, { headers: owner })).json()
  assert.equal(initial.version, 1)
  assert.deepEqual(initial.layer_ratios, { reach: 50, trust: 30, conversion: 20 })
  assert.deepEqual(initial.history, [])

  const invalid = await fetch(`${baseUrl}/api/content-strategy`, {
    method: 'PUT', headers: owner,
    body: JSON.stringify({ layer_ratios: { reach: 50, trust: 50, conversion: 50 } }),
  })
  assert.equal(invalid.status, 422)
  assert.equal((await (await fetch(`${baseUrl}/api/content-strategy`, { headers: owner })).json()).version, 1, '非法比例不得落库')

  const updated = await fetch(`${baseUrl}/api/content-strategy`, {
    method: 'PUT', headers: owner,
    body: JSON.stringify({ layer_ratios: { reach: 40, trust: 40, conversion: 20 }, change_reason: '冷启动后加重信任层' }),
  })
  assert.equal(updated.status, 200)
  const strategy = await updated.json()
  assert.equal(strategy.version, 2)
  assert.deepEqual(strategy.layer_ratios, { reach: 40, trust: 40, conversion: 20 })
  assert.equal(strategy.history.length, 1)
  assert.equal(strategy.history[0].change_reason, '冷启动后加重信任层')
  assert.deepEqual(strategy.history[0].previous.layer_ratios, { reach: 50, trust: 30, conversion: 20 })

  const otherView = await (await fetch(`${baseUrl}/api/content-strategy`, { headers: other })).json()
  assert.equal(otherView.version, 1)
  assert.deepEqual(otherView.layer_ratios, { reach: 50, trust: 30, conversion: 20 })

  const review = await fetch(`${baseUrl}/api/content-strategy/reviews`, { method: 'POST', headers: owner, body: '{}' })
  assert.equal(review.status, 200)
  assert.deepEqual(await review.json(), {
    status: 'insufficient_data',
    strategy_version: 2,
    layer_metrics: null,
    recommendations: [],
    reason: '尚未形成口径一致、可核验的周期对比数据，暂不提供增长率或自动配比建议。',
  })

  const recommend = await fetch(`${baseUrl}/api/content-strategy/recommend`, { method: 'POST', headers: owner, body: '{}' })
  assert.equal(recommend.status, 200)
  assert.equal((await recommend.json()).status, 'insufficient_data')

  const badVersion = await fetch(`${baseUrl}/api/content-strategy/versions`, {
    method: 'POST', headers: owner,
    body: JSON.stringify({ layer_ratios: { reach: 90, trust: 20, conversion: 20 } }),
  })
  assert.equal(badVersion.status, 422)

  const versioned = await fetch(`${baseUrl}/api/content-strategy/versions`, {
    method: 'POST', headers: owner,
    body: JSON.stringify({ layer_ratios: { reach: 30, trust: 50, conversion: 20 }, change_reason: '复盘确认' }),
  })
  assert.equal(versioned.status, 201)
  const next = await versioned.json()
  assert.equal(next.version, 3)
  assert.deepEqual(next.layer_ratios, { reach: 30, trust: 50, conversion: 20 })

  const history = await (await fetch(`${baseUrl}/api/content-strategy/versions`, { headers: owner })).json()
  assert.equal(history.length, 2)
  assert.equal(history[1].change_reason, '复盘确认')
  assert.equal((await (await fetch(`${baseUrl}/api/content-strategy/versions`, { headers: other })).json()).length, 0)
})
