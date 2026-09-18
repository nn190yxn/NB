import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'
import { dimensionPassScore, evaluateTopic } from './topic-evaluation.mjs'

const recent = () => new Date().toISOString()

test('选题把关：全部维度不达标才拦停，并给出「不建议做」与第一步', () => {
  const blocked = evaluateTopic({ title: '第一最好最强的内容', strategy_layer: 'reach' }, { research: [], materials: [], structures: [], profile: {}, strategy: {} })
  assert.equal(blocked.blocked, true, '七个维度全部低于及格线，就该明确不建议做')
  assert.equal(blocked.decision, 'defer', '拦停时决策必须落到暂缓，不能还留「建议改方向」')
  assert.match(blocked.conclusion, /不建议做/)
  assert.match(blocked.first_step, /先别做这一条/)
  const scores = Object.values(blocked.dimensions).map(item => item.score)
  assert.equal(scores.length, 7, '维度数量要保持七个，不因为「五维诊断」的说法砍掉制作成本和合规风险')
  assert.ok(scores.every(score => score < dimensionPassScore))
})

test('选题把关：只要有一个维度达标就不拦停，第一步取自最弱的那一维', () => {
  const context = {
    research: [{ title: 'ZZZ', captured_at: recent(), metrics: { discussions: 5000, growth: 30 } }],
    materials: [{}],
    structures: [{}],
    profile: { pillars: ['客户'], audiences: ['老板'] },
    strategy: {},
  }
  const result = evaluateTopic({ title: '客户为什么不来问价', strategy_layer: 'trust' }, context)
  assert.equal(result.blocked, false, '还有维度达标就不该拦停：误杀比放过贵')
  assert.notEqual(result.decision, 'defer')
  assert.match(result.conclusion, /建议/)
  assert.doesNotMatch(result.conclusion, /不建议做/)
  // 最弱的一维是变现空间，第一步应当指向补变现目标或获客路径。
  const weakest = Object.entries(result.dimensions).sort((left, right) => left[1].score - right[1].score)[0][0]
  assert.equal(weakest, 'monetization')
  assert.match(result.first_step, /变现|获客/)
  assert.ok(result.suggestions.length > 0, '建议清单要保留，第一步只是其中一条')
})

const llmMock = await startSharedLlmMock()
const port = testPort(48900, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'topic-gate-test-')), 'data.json')
writeFileSync(dataFile, '{}')

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...llmMock.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

test('内容质量差的选题走完生成也不拦停：稿子照常入库，只标成待修改', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'topic-gate-owner'
  const headers = { 'x-user-id': owner, 'content-type': 'application/json' }

  // 这条选题在把关里是七维全部不达标的（风险词命中、没有来源、没有素材）。
  const badTopic = { title: '第一最好绝对靠谱的方法', strategy_layer: 'reach', goal_refs: [] }
  assert.equal(evaluateTopic(badTopic, { research: [], materials: [], structures: [], profile: {}, strategy: {} }).blocked, true, '前提：这条选题在关里是被拦的')

  const response = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: badTopic }) })
  assert.ok(response.ok, `生成链路不得因为内容质量返回 4xx/5xx，实际 ${response.status}`)
  const drafts = await response.json()
  assert.ok(Array.isArray(drafts) && drafts.length > 0, '质量差也要真的产出草稿，不空手返回')
  assert.ok(drafts.every(draft => draft.body && String(draft.body).length > 0), '每条草稿都要有正文')

  // 闸门结果只记录、不丢弃：状态是 draft 或 needs_revision，两种都算入库。
  assert.ok(drafts.every(draft => ['draft', 'needs_revision'].includes(draft.workflow_status)), `状态只能是 draft / needs_revision，实际 ${drafts.map(draft => draft.workflow_status).join('、')}`)
  assert.ok(drafts.every(draft => draft.generation_context?.gate && typeof draft.generation_context.gate.failed === 'boolean'), '闸门验收结果要记进 generation_context.gate')

  const persisted = await (await fetch(`${baseUrl}/api/drafts`, { headers })).json()
  assert.equal(persisted.length, drafts.length, '被闸门拦下的稿子必须还在库里，不能悄悄丢掉')
})
