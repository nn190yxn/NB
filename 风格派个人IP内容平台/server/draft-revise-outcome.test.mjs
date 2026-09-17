import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkReviseOutcome, rewriteAsksForShorter } from './draft-checks.mjs'
import { startGenerationMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

const port = testPort(47000, 400)
const baseUrl = `http://127.0.0.1:${port}`
const headers = { 'content-type': 'application/json', 'x-user-id': 'draft-revise-outcome-user' }
const noModelEnv = { PROJECT_LLM_BASE_URL: '', PROJECT_LLM_API_KEY: '', PROJECT_LLM_MODEL: '' }

function startServer(extraEnv = {}) {
  const dataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-revise-outcome-')), 'data.json')
  writeFileSync(dataFile, '{}')
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, ...noModelEnv, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    // 全量跑时几十个测试文件并发起后台进程，5 秒会偶发不够；失败时把子进程 stderr 带出来，否则只看到超时。
    let stderr = ''
    child.stderr.on('data', data => { stderr += String(data) })
    const timeout = setTimeout(() => reject(new Error(`改写护栏 API 启动超时\n${stderr.slice(-2000)}`)), 20000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`改写护栏 API 异常退出: ${code}\n${stderr.slice(-2000)}`)) })
  })
}

test('改写结果护栏：只认能算清的两件事', () => {
  const long = '点赞会撒谎，询盘不会。'.repeat(20)
  const short = '先看有没有人来问怎么买。'
  const rejectShort = checkReviseOutcome({ before: long, after: short, platform: '小红书' })
  assert.equal(rejectShort.ok, false)
  assert.match(rejectShort.failures[0], /越改越短/)
  assert.match(rejectShort.failures[0], /不得少于 \d+ 字/)

  // 用户自己要求变短时不能拦，否则就是不让人把稿子改短。
  assert.equal(rewriteAsksForShorter('再短一点，开头别设问'), true)
  assert.equal(rewriteAsksForShorter('压到 800 字以内'), true)
  assert.equal(rewriteAsksForShorter('第一句直给结论'), false)
  assert.equal(checkReviseOutcome({ before: long, after: short, platform: '小红书', note: '再短一点' }).ok, true)

  // 原稿本来就超上限时，允许压到上限，但不许压到上限以下。
  const overCap = '口'.repeat(1200)
  assert.equal(checkReviseOutcome({ before: overCap, after: '口'.repeat(1000), platform: '小红书' }).ok, true)
  const underCap = checkReviseOutcome({ before: overCap, after: '口'.repeat(400), platform: '小红书' })
  assert.equal(underCap.ok, false)
  assert.match(underCap.failures[0], /不得少于 1000 字/)

  // 抖音短视频上限 250：原稿 600 字可以压到 250，不能压到 80。
  assert.equal(checkReviseOutcome({ before: '口'.repeat(600), after: '口'.repeat(250), platform: '抖音', format: '短视频' }).ok, true)
  assert.equal(checkReviseOutcome({ before: '口'.repeat(600), after: '口'.repeat(80), platform: '抖音', format: '短视频' }).ok, false)

  // 「按检查意见改写」时，被点名的问题必须真的少下去，不是换个更简单的说法。
  const withIssue = `拆完爆款不会用？${'口'.repeat(360)}`
  const stillQuestion = checkReviseOutcome({ before: withIssue, after: `${withIssue}补充一句。`, platform: '抖音', requireImprove: true })
  assert.equal(stillQuestion.ok, false)
  assert.match(stillQuestion.failures[0], /被点名的问题没减少/)
  const fixed = checkReviseOutcome({ before: withIssue, after: `拆完爆款不会用。${'口'.repeat(360)}`, platform: '抖音', requireImprove: true })
  assert.equal(fixed.ok, true)
})

test('按检查意见改写，模型只压短时拒绝入库', async t => {
  const mock = await startGenerationMock()
  t.after(() => mock.close())
  const server = await startServer(mock.env)
  t.after(() => server.kill())

  const created = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title: '改写护栏', strategy_layer: 'trust', goal_refs: [] }, quote_ids: [], experience_ids: [] }) })
  assert.equal(created.status, 201)
  const drafts = await created.json()
  const douyin = drafts.find(item => item.platform === '抖音')
  assert.ok(douyin)

  // 造一条又长又带问句开头的抖音草稿，正好是「按检查意见改写」要处理的形态。
  const overCap = `拆完爆款不会用？${'口'.repeat(360)}`
  const saved = await fetch(`${baseUrl}/api/drafts/${douyin.id}`, { method: 'PUT', headers, body: JSON.stringify({ body: overCap, version: douyin.version }) })
  assert.equal(saved.status, 200)
  const target = await saved.json()
  await fetch(`${baseUrl}/api/drafts/${douyin.id}/checks/persona`, { method: 'POST', headers, body: '{}' })
  const quality = await fetch(`${baseUrl}/api/drafts/${douyin.id}/checks/quality`, { method: 'POST', headers, body: '{}' })
  assert.equal(quality.status, 200)
  const checked = await quality.json()

  mock.setMode('shrink_revise')
  const shrunk = await fetch(`${baseUrl}/api/drafts/${douyin.id}/revise`, { method: 'POST', headers, body: JSON.stringify({ from_checks: true, version: checked.version }) })
  assert.equal(shrunk.status, 502)
  const failure = await shrunk.json()
  assert.equal(failure.code, 'REVISE_NOT_IMPROVED')
  assert.match(failure.error, /越改越短/)
  assert.match(failure.error, /未改库/)

  // 关键：拒收时库里一个字都不能变，版本号也不能动。
  const afterFailure = await (await fetch(`${baseUrl}/api/drafts`, { headers })).json()
  const kept = afterFailure.find(item => item.id === douyin.id)
  assert.equal(kept.body, overCap)
  assert.equal(kept.version, checked.version)

  // 换成保留原稿的改写，同一条草稿应当正常过。
  mock.setMode('success')
  const improved = await fetch(`${baseUrl}/api/drafts/${douyin.id}/revise`, { method: 'POST', headers, body: JSON.stringify({ from_checks: true, version: checked.version }) })
  assert.equal(improved.status, 200)
  const next = await improved.json()
  assert.equal(next.version, checked.version + 1)
  assert.ok(!next.body.startsWith('拆完爆款不会用？'), '改写后开头不应还是问句')
  assert.ok(next.body.length >= 250, `改写后不该比平台上限还短，实际 ${next.body.length} 字`)
})
