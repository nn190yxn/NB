import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { parsePublishRiskResponse, publishRiskPrompt, publishRiskSignals, scanRiskSurface } from './publish-risk.mjs'
import { testPort } from './test-port.mjs'

const llmMock = await startSharedLlmMock()

const makeWorkspace = () => {
  const dir = mkdtempSync(join(tmpdir(), 'publish-risk-'))
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

const risky = [
  '别再为流量写了。想学这套打法的，加我微信 zhuanqian2026，或扫码进群。',
  '官网 https://example.com/course 上有全部资料，手机号 13800138000 也能找到我。',
  '这套方法 100% 有效，包治内容没人看，全网最低价。',
].join('\n')

test('规则扫得出外链、联系方式、二维码、导流动作、绝对化与医疗词', () => {
  const signals = publishRiskSignals({ title: '限时报名', body: risky })
  assert.ok(signals.url_count >= 1)
  assert.ok(signals.contact_count >= 2)
  assert.ok(signals.qrcode_count >= 1)
  assert.ok(signals.drive_action_count >= 1)
  assert.ok(signals.claim_count >= 1)
  assert.ok(signals.samples.length > 0)
})

test('手机号不会被连续长数字再报一次', () => {
  const hits = scanRiskSurface({ title: '', body: '联系我 13800138000。' })
  assert.equal(hits.filter(item => item.kind === 'digits').length, 0)
  assert.equal(hits.filter(item => item.kind === 'phone').length, 1)
})

test('医疗词单独召回', () => {
  const hits = scanRiskSurface({ title: '', body: '这个方法能根治失眠，降血压。' })
  assert.ok(hits.some(item => item.kind === 'medical' && item.evidence === '根治'))
})

test('提示词写明两层、禁止编违规、禁止预测概率、原句必须逐字出现', () => {
  const prompt = publishRiskPrompt({ platform: '小红书', title: '限时报名', body: risky, signals: publishRiskSignals({ title: '限时报名', body: risky }) })
  assert.match(prompt.system, /两层结论分别成立/)
  assert.match(prompt.system, /不许补造一个违规原因/)
  assert.match(prompt.system, /不预测违规概率/)
  assert.match(prompt.system, /不写「能发」「不能发」「保证通过」/)
  assert.match(prompt.system, /逐字出现/)
  assert.match(prompt.system, /4 到 9 个汉字/)
  assert.match(prompt.user, /完整外链/)
})

test('解析丢掉层级不认识、原句不在稿子里、缺问题或缺动作的条目', () => {
  const title = '限时报名'
  const body = '想学这套打法的，加我微信 zhuanqian2026。这套方法 100% 有效。'
  const report = parsePublishRiskResponse(JSON.stringify({
    findings: [
      { kind: 'machine', evidence: '加我微信 zhuanqian2026', location: '正文', problem: '站外联系方式', action: '改成平台允许的入口', false_positive: '正常引用可能被误判' },
      { kind: 'substance', evidence: '这套方法 100% 有效', location: '正文', problem: '确定性效果没有依据', action: '删掉效果结论或补可验证依据' },
      { kind: 'very_high', evidence: '这套方法 100% 有效', location: '正文', problem: '层级不认识', action: '随便改' },
      { kind: 'substance', evidence: '这句话稿子里没有', location: '正文', problem: '原句找不到', action: '随便改' },
      { kind: 'machine', evidence: '加我微信 zhuanqian2026', location: '正文', problem: '', action: '缺问题' },
      { kind: 'machine', evidence: '加我微信 zhuanqian2026', location: '正文', problem: '缺动作', action: '' },
    ],
    overlay: ['个人经验分享', '不构成效果保证', '请结合自身情况'],
    summary: { machine: '站外联系方式', substance: '一处确定性效果' },
  }), { title, body })

  assert.equal(report.findings.length, 2)
  assert.deepEqual(report.findings.map(item => item.kind), ['machine', 'substance'])
  assert.deepEqual(report.kind_counts, { substance: 1, machine: 1, needs_confirm: 0 })
  assert.equal(report.findings[0].kind_label, '可能触发机器审核')
  assert.equal(report.findings[0].false_positive, '正常引用可能被误判')
  assert.deepEqual(report.overlay, ['个人经验分享', '不构成效果保证', '请结合自身情况'])
  assert.equal(report.overlay_rejected, false)
})

test('贴片不是三行、或每行超出 4-9 个汉字时不给，并标出被拒', () => {
  const long = parsePublishRiskResponse(JSON.stringify({ findings: [], overlay: ['第一行', '第二行'] }), { title: '', body: '正文' })
  assert.deepEqual(long.overlay, [])
  assert.equal(long.overlay_rejected, true)
  const tooLong = parsePublishRiskResponse(JSON.stringify({ findings: [], overlay: ['这一行写得实在太长了不符合规定', '第二行内容', '第三行内容'] }), { title: '', body: '正文' })
  assert.deepEqual(tooLong.overlay, [])
  assert.equal(tooLong.overlay_rejected, true)
})

test('模型返回不是 JSON 时返回 null，不编报告', () => {
  assert.equal(parsePublishRiskResponse('这份稿子没什么问题。', { title: '', body: '正文' }), null)
})

test('空输入不炸：没信号、没条目', () => {
  const signals = publishRiskSignals({ title: '', body: '' })
  assert.equal(signals.hit_count, 0)
  const report = parsePublishRiskResponse(JSON.stringify({ findings: [], overlay: [] }), { title: '', body: '' })
  assert.equal(report.findings.length, 0)
  assert.deepEqual(report.overlay, [])
})

test('接口：发布前风险检查只出报告，不拦停发布', async t => {
  const port = testPort(41600, 150)
  const workspace = makeWorkspace()
  const server = await startServer(port, workspace.dataFile)
  t.after(() => { server.kill(); rmSync(workspace.dir, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${port}`
  const headers = { 'x-user-id': 'publish-risk-owner', 'content-type': 'application/json' }

  const generated = await (await fetch(`${base}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title: '内容要按成交写', strategy_layer: 'trust', goal_refs: [] } }) })).json()
  const before = generated[0]

  const response = await fetch(`${base}/api/drafts/${before.id}/publish-risk`, { method: 'POST', headers, body: '{}' })
  const updated = await response.json()
  assert.equal(response.status, 200, `检查失败：${JSON.stringify(updated).slice(0, 200)}`)
  const report = updated.publish_risk
  assert.ok(report, '报告要挂在草稿上')
  assert.equal(report.draft_version, before.version)
  assert.ok(report.provider)
  // 模型给了 4 条：一条原句在稿子里找不到、一条层级不认识，落到用户面前只剩 2 条。
  assert.equal(report.findings.length, 2)
  assert.deepEqual(report.findings.map(item => item.kind), ['substance', 'machine'])
  assert.deepEqual(report.kind_counts, { substance: 1, machine: 1, needs_confirm: 0 })
  assert.ok(report.findings.every(item => item.evidence && item.problem && item.action))
  assert.deepEqual(report.overlay, ['个人经验分享', '不构成效果保证', '请结合自身情况'])
  assert.equal(report.measured.hit_count >= 0, true)

  // 拦停相关字段一律没动：这份报告不参与发布门禁。
  assert.equal(updated.workflow_status, before.workflow_status)
  assert.equal(updated.status, before.status)
  assert.equal(updated.version, before.version)
  assert.deepEqual(updated.checks, before.checks)
  assert.deepEqual(updated.approval, before.approval)
})
