import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { claimCandidates, coreMechanismCheck, parseResonanceResponse, resonanceDimensions } from './resonance.mjs'
import { testPort } from './test-port.mjs'

const llmMock = await startSharedLlmMock()

const makeWorkspace = () => {
  const dir = mkdtempSync(join(tmpdir(), 'resonance-'))
  return { dir, dataFile: join(dir, 'state.json') }
}

function startServer(listenPort, dataFile) {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...llmMock.env, PORT: String(listenPort), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  // 服务自己退出时把它的输出带出来，不然只看到一个退出码，没法查。
  let logs = ''
  child.stdout.on('data', chunk => { logs += String(chunk) })
  child.stderr.on('data', chunk => { logs += String(chunk) })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`服务启动超时：${logs.slice(-500)}`)), 15000)
    child.stdout.on('data', chunk => { if (String(chunk).includes('Content IP API listening')) { clearTimeout(timer); resolve(child) } })
    child.stderr.on('data', chunk => { if (String(chunk).includes('Error')) { clearTimeout(timer) } })
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`服务退出：${code}\n${logs.slice(-800)}`)) })
  })
}

test('核心机制审查：结构行不算主张，判断句多了就提示核心被稀释', () => {
  // 「标题：」这类结构行不是观点，不能算进主张。
  assert.deepEqual(claimCandidates('标题：内容要按成交写\n（镜头）看镜头\n其实就是没人问你'), ['其实就是没人问你'])
  assert.equal(coreMechanismCheck('点赞会撒谎。').verdict, 'clear')

  const two = coreMechanismCheck('其实流量不等于成交。关键是你要的是哪一种客户。')
  assert.equal(two.verdict, 'risk')
  assert.equal(two.claim_count, 2)

  const four = coreMechanismCheck('其实流量不等于成交。别再为流量写。关键是你要哪一种客户。本质上这是筛选问题。')
  assert.equal(four.verdict, 'diluted')
  assert.equal(four.claim_count, 4)
  assert.match(four.note, /核心被稀释/)
})

test('诊断解析：判定不在三档内、维度不认识、指不到原文的整条丢掉', () => {
  const core = coreMechanismCheck('其实流量不等于成交。')
  const report = parseResonanceResponse(JSON.stringify({
    dimensions: [
      { id: 'silence', verdict: '有效', evidence: '点赞会撒谎', detail: '说出不敢公开的判断' },
      { id: 'belief', verdict: '很有效', evidence: '为成交写', detail: '判定不在三档内' },
      { id: 'silence', verdict: '弱', evidence: '', detail: '没关联原文' },
      { id: 'unknown', verdict: '有效', evidence: '随便一句', detail: '维度不认识' },
    ],
    core: { text: '不为流量写', verdict: '明确' },
    emotion_core: { text: '被数字骗过的无力感', from: 'silence' },
    effective_stance: { text: '站在做事的人这边', from: 'unknown' },
    fixes: { cut: ['删绕的那句'], compress: [], strengthen: ['「询盘不会」单独成行'] },
  }), { core })

  assert.equal(report.dimensions.length, 1)
  assert.deepEqual(report.dimensions[0], { id: 'silence', label: '沉默解除', theory: resonanceDimensions[0].theory, verdict: '有效', evidence: '点赞会撒谎', detail: '说出不敢公开的判断' })
  assert.deepEqual(report.verdict_counts, { 有效: 1, 弱: 0, 无效: 0 })
  // 推导来源必须落在留下来的五维里，不认识就留空，不硬填。
  assert.equal(report.synthesis.emotion_core.from, '沉默解除')
  assert.equal(report.synthesis.effective_stance.from, null)
  assert.equal(report.synthesis.effective_stance.text, '站在做事的人这边')
  assert.equal(report.core.measured.verdict, 'clear')
  assert.deepEqual(report.fixes.cut, ['删绕的那句'])
  assert.deepEqual(report.fixes.strengthen, ['「询盘不会」单独成行'])

  assert.equal(parseResonanceResponse('这不是 JSON'), null)
  assert.equal(parseResonanceResponse(JSON.stringify({ dimensions: [] })).dimensions.length, 0)
})

test('发布前报告只出报告，不拦停发布', async t => {
  const port = testPort(41400, 150)
  const workspace = makeWorkspace()
  const server = await startServer(port, workspace.dataFile)
  t.after(() => { server.kill(); rmSync(workspace.dir, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${port}`
  const headers = { 'x-user-id': 'resonance-owner', 'content-type': 'application/json' }

  const generated = await (await fetch(`${base}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title: '内容要按成交写', strategy_layer: 'trust', goal_refs: [] } }) })).json()
  const before = generated[0]

  const response = await fetch(`${base}/api/drafts/${before.id}/resonance`, { method: 'POST', headers, body: '{}' })
  const updated = await response.json()
  assert.equal(response.status, 200, `诊断失败：${JSON.stringify(updated).slice(0, 200)}`)
  const report = updated.resonance
  assert.ok(report, '报告要挂在草稿上')
  assert.equal(report.draft_version, before.version)
  assert.ok(report.provider)
  // 模型给了 5 条，一条判定不在三档内、一条维度不认识，落到用户面前只剩 4 条。
  assert.equal(report.dimensions.length, 4)
  assert.deepEqual(report.dimensions.map(item => item.id), ['silence', 'gratification', 'framing', 'gateway'])
  assert.deepEqual(report.verdict_counts, { 有效: 2, 弱: 1, 无效: 1 })
  // 推导来源必须落在留下来的维度上，模型给的 unknown 不认。
  assert.equal(report.synthesis.effective_stance.from, '立场框架')
  assert.equal(report.synthesis.audience_wants.from, null)
  assert.ok(report.dimensions.every(item => item.evidence && item.detail))
  assert.equal(report.core.verdict, '明确')
  assert.equal(report.core.measured.claim_count > 0, true)

  // 拦停相关字段一律没动：报告不参与发布门禁。
  assert.equal(updated.workflow_status, before.workflow_status)
  assert.equal(updated.status, before.status)
  assert.equal(updated.version, before.version)
  assert.deepEqual(updated.checks, before.checks)
  assert.deepEqual(updated.approval, before.approval)
})
