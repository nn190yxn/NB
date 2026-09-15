import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDraftBrief, draftBriefPrompt, draftPlatforms, parseDraftBodies } from './draft-writing.mjs'
import { startGenerationMock } from './generation-test-helper.mjs'

const port = 46000 + Math.floor(Math.random() * 500)
const baseUrl = `http://127.0.0.1:${port}`
const headers = { 'content-type': 'application/json', 'x-user-id': 'draft-writing-user' }
const noModelEnv = { PROJECT_LLM_BASE_URL: '', PROJECT_LLM_API_KEY: '', PROJECT_LLM_MODEL: '' }

function startServer(extraEnv = {}) {
  const dataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-draft-writing-')), 'data.json')
  writeFileSync(dataFile, '{}')
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, ...noModelEnv, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('草稿写作 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`草稿写作 API 异常退出: ${code}`)) })
  })
}

const generate = () => fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title: '真实正文测试', strategy_layer: 'trust', goal_refs: [] }, quote_ids: [], experience_ids: [] }) })

test('写作简报与模型输出解析保持纯函数行为', () => {
  const brief = buildDraftBrief({ topic: { title: '标题', strategy_layer: 'reach' }, structure: { steps: ['开场', '案例'] }, quotes: [{ content: '金句' }], experiences: [{ content: '经历' }], memories: [{ content: '偏好' }], hookText: 'Hook' })
  assert.equal(brief.title, '标题')
  assert.equal(brief.strategy_layer, 'reach')
  assert.deepEqual(brief.structure, ['开场', '案例'])
  assert.deepEqual(brief.platforms, draftPlatforms)
  assert.match(draftBriefPrompt({ role: '顾问' }), /身份：顾问/)

  const bodies = parseDraftBodies('前言 {"master":"母版","小红书":"只给了小红书"} 结尾')
  assert.equal(bodies['小红书'], '只给了小红书')
  assert.equal(bodies['抖音'], '母版')
  assert.throws(() => parseDraftBodies('没有 JSON 的回复'), /JSON/)
  assert.throws(() => parseDraftBodies('{"小红书":"缺少母版"}'), /母版/)
})

test('未配置模型时草稿生成 422 且不落库', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const response = await generate()
  assert.equal(response.status, 422)
  assert.equal((await response.json()).reason, 'llm_not_configured')
  const drafts = await (await fetch(`${baseUrl}/api/drafts`, { headers })).json()
  assert.deepEqual(drafts, [])
})

test('模型返回无效内容时 502 且不落库，成功时正文来自模型', async t => {
  const mock = await startGenerationMock()
  t.after(() => mock.close())
  const server = await startServer(mock.env)
  t.after(() => server.kill())

  mock.setMode('invalid')
  const failed = await generate()
  assert.equal(failed.status, 502)
  assert.deepEqual(await (await fetch(`${baseUrl}/api/drafts`, { headers })).json(), [])

  mock.setMode('success')
  const created = await generate()
  assert.equal(created.status, 201)
  const drafts = await created.json()
  assert.equal(drafts.length, 4)
  assert.equal(drafts[0].body, '小红书正文：真实正文测试')
  assert.equal(drafts.find(item => item.platform === '抖音').body, '抖音口播：真实正文测试')
  assert.equal(drafts[0].generation_context.provider, 'primary')
  assert.equal(drafts[0].generation_context.brief.title, '真实正文测试')
  assert.ok(drafts.every(item => item.body && !item.body.includes('平台：')))
})
