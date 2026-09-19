import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { longSentences, parseScriptFlowResponse, repeatedSentences, scriptFlowPrompt, scriptFlowSegments, scriptFlowSignals, writtenStyleHits } from './script-flow.mjs'
import { testPort } from './test-port.mjs'

const llmMock = await startSharedLlmMock()

const makeWorkspace = () => {
  const dir = mkdtempSync(join(tmpdir(), 'script-flow-'))
  return { dir, dataFile: join(dir, 'state.json') }
}

function startServer(listenPort, dataFile) {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...llmMock.env, PORT: String(listenPort), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
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

const body = [
  '别再喂完整观点了，观众三秒就划走。',
  '',
  '我做内容一年，踩过一个最大的坑：总想把一个完整的逻辑原封不动塞进视频里，结果数据惨淡，因为对于一个陌生的大脑来说，完整的观点太沉重，没有人有空在几秒内消化。',
  '',
  '基于以上分析，我们要做的是拆解。',
  '素材要拆解。',
  '素材要拆解。',
].join('\n')

test('分段按空行切，段落号从 1 起，带字数', () => {
  const segments = scriptFlowSegments(body)
  assert.equal(segments.length, 3)
  assert.deepEqual(segments.map(item => item.index), [1, 2, 3])
  assert.ok(segments[1].chars > segments[0].chars)
  assert.match(segments[0].opening, /别再喂完整观点/)
})

test('分段跳过标题行和镜头提示行', () => {
  const segments = scriptFlowSegments('标题：这是一条标题\n\n（镜头推近）\n\n正文第一句。')
  assert.equal(segments.length, 1)
  assert.match(segments[0].opening, /正文第一句/)
})

test('规则数得出长句、书面语、重复表述', () => {
  assert.equal(longSentences(body).length, 1)
  assert.equal(writtenStyleHits(body).length, 1)
  assert.ok(repeatedSentences(body).count >= 1)
  const signals = scriptFlowSignals(body)
  assert.equal(signals.segment_count, 3)
  assert.equal(signals.long_sentence_count, 1)
  assert.equal(signals.written_style_count, 1)
  assert.ok(signals.segment_char_range.max > signals.segment_char_range.min)
})

test('提示词带上三维判定档位、分段清单和规则信号', () => {
  const signals = scriptFlowSignals(body)
  const prompt = scriptFlowPrompt({ platform: '抖音', topic: '原子化素材', body, signals })
  assert.match(prompt.system, /段落衔接/)
  assert.match(prompt.system, /断裂 \/ 勉强 \/ 成立/)
  assert.match(prompt.system, /口播流畅/)
  assert.match(prompt.user, /第 1 段/)
  assert.match(prompt.user, /超过 30 字的单句：1 处/)
})

test('提示词写明不预测平台指标', () => {
  const prompt = scriptFlowPrompt({ platform: '抖音', topic: '', body, signals: scriptFlowSignals(body) })
  assert.match(prompt.system, /不预测完播率、点击率、推荐量/)
  assert.match(prompt.system, /不说「观众会划走」/)
})

test('解析丢掉指不到原句、判定不在档位、段落号越界、维度不存在的条目', () => {
  const signals = scriptFlowSignals(body)
  const content = JSON.stringify({
    findings: [
      { axis: 'continuity', segment: 2, verdict: '断裂', evidence: '基于以上分析，我们要做的是拆解。', detail: '缺过渡', fix: '补一句过渡' },
      { axis: 'continuity', segment: 2, verdict: '断裂', detail: '没有原句' },
      { axis: 'continuity', segment: 2, verdict: '很好', evidence: '素材要拆解。' },
      { axis: 'density', segment: 9, verdict: '塌陷', evidence: '素材要拆解。' },
      { axis: 'rhythm', segment: 1, verdict: '顺', evidence: '别再喂完整观点了，观众三秒就划走。' },
    ],
    fixes: { cut: ['删掉重复那句'], transition: ['第 1 段到第 2 段补一句'], unknown: ['不该收'] },
  })
  const report = parseScriptFlowResponse(content, { signals })
  assert.equal(report.findings.length, 1)
  assert.equal(report.findings[0].axis, 'continuity')
  assert.equal(report.findings[0].axis_label, '段落衔接')
  assert.equal(report.axis_counts.continuity, 1)
  assert.equal(report.axis_counts.density, 0)
  assert.deepEqual(report.fixes.cut, ['删掉重复那句'])
  assert.deepEqual(report.fixes.merge, [])
  assert.equal(report.measured.segment_count, 3)
})

test('模型返回不是 JSON 时返回 null，不编报告', () => {
  assert.equal(parseScriptFlowResponse('这段稿子读起来还行。', { signals: scriptFlowSignals(body) }), null)
})

test('空正文不炸：分段为空，规则计数为零', () => {
  const signals = scriptFlowSignals('')
  assert.equal(signals.segment_count, 0)
  assert.equal(signals.long_sentence_count, 0)
  assert.equal(signals.segment_char_range, null)
})

test('接口：逐字稿检查只出报告，不拦停发布', async t => {
  const port = testPort(41500, 150)
  const workspace = makeWorkspace()
  const server = await startServer(port, workspace.dataFile)
  t.after(() => { server.kill(); rmSync(workspace.dir, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${port}`
  const headers = { 'x-user-id': 'script-flow-owner', 'content-type': 'application/json' }

  const generated = await (await fetch(`${base}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title: '内容要按成交写', strategy_layer: 'trust', goal_refs: [] } }) })).json()
  const before = generated[0]

  const response = await fetch(`${base}/api/drafts/${before.id}/script-flow`, { method: 'POST', headers, body: '{}' })
  const updated = await response.json()
  assert.equal(response.status, 200, `检查失败：${JSON.stringify(updated).slice(0, 200)}`)
  const report = updated.script_flow
  assert.ok(report, '报告要挂在草稿上')
  assert.equal(report.draft_version, before.version)
  assert.ok(report.provider)
  // 模型给了 5 条，判定不在三档内、维度不认识、段落号越界各一条，落到用户面前只剩 2 条。
  assert.equal(report.findings.length, 2)
  assert.deepEqual(report.findings.map(item => item.axis), ['continuity', 'density'])
  assert.deepEqual(report.axis_counts, { continuity: 1, density: 1, spoken: 0 })
  assert.ok(report.findings.every(item => item.evidence && item.fix))
  assert.equal(report.measured.segment_count > 0, true)
  assert.deepEqual(report.fixes.transition, ['第 1 段到第 2 段补一句过渡'])

  // 拦停相关字段一律没动：这份检查不参与发布门禁。
  assert.equal(updated.workflow_status, before.workflow_status)
  assert.equal(updated.status, before.status)
  assert.equal(updated.version, before.version)
  assert.deepEqual(updated.checks, before.checks)
  assert.deepEqual(updated.approval, before.approval)
})
