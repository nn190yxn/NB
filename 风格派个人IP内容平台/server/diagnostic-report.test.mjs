import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as draftChecks from './draft-checks.mjs'
import { aiFeatureSeverityLabels, aiFeatureCautions, aiFeatures } from './ai-features.mjs'
import { diagnosticReport, diagnosticReportFooter, diagnosticSeverityLabels } from './draft-checks.mjs'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

// 故意把两处问题写反顺序：自我介绍在后半段，平台名在最前面。
// 按文本顺序排，报告第一处应该是平台名，不是自我介绍。
const body = [
  '这版也发到小红书效果应该不错。',
  '很多人做内容做不起来，是因为没有想清楚定位。',
  '大家好，我是 Agnes，关注我带你做内容。',
  '拆成几块、裂变、多平台分发，一套流程跑通。',
].join('\n')

const draft = { body, platform: '抖音' }

test('报告按文本顺序逐处呈现，不按特征归类', () => {
  const report = diagnosticReport(draft)
  assert.ok(report.entries.length >= 3)
  const positions = report.entries.map(entry => entry.position)
  const known = positions.filter(position => position >= 0)
  assert.deepEqual(known, [...known].sort((left, right) => left - right), '有位置的条目必须按正文顺序排')
  assert.equal(report.entries[0].code, 'platform_mixup', '第一处应当是正文里最靠前的问题')
  assert.equal(report.entries.at(-1).position, -1, '整篇级的问题没有单一位置，排在最后，不假装它在开头')
  assert.ok(report.entries.some(entry => entry.code === 'self_intro'), '自我介绍在后半段，但不能漏')
  assert.equal(Object.hasOwn(report, 'reminders'), false, '报告里不该带七类归并，那正是要撤掉的呈现方式')
})

test('每一处都有原文引用、一句人话和严重度标签', () => {
  const report = diagnosticReport(draft)
  report.entries.forEach(entry => {
    assert.ok(entry.quote, `${entry.code} 缺少直接引用的原文`)
    assert.ok(body.includes(entry.quote), `${entry.code} 的引用必须真的来自正文`)
    assert.ok(entry.note, `${entry.code} 缺少一句人话说明`)
    assert.ok(Object.hasOwn(diagnosticSeverityLabels, entry.severity), `${entry.code} 的严重度不在三档里：${entry.severity}`)
  })
})

test('严重度分三档但不带否决权，结尾要说明这是检测结果并问要不要改', () => {
  const report = diagnosticReport(draft)
  const levels = new Set(report.entries.map(entry => entry.severity))
  assert.ok([...levels].every(level => ['strong', 'medium', 'weak'].includes(level)))
  assert.equal(Object.keys(diagnosticSeverityLabels).length, 3, '严重度就是三档，不加第四档')
  assert.equal(report.entries.some(entry => entry.blocked || entry.veto), false, '严重度不带否决权：没有任何一档能拦下正文')
  assert.equal(report.footer, diagnosticReportFooter)
  assert.match(report.footer, /以上是检测结果，不涉及修改/)
  assert.match(report.footer, /要按这些改一版吗/)
})

test('干净的正文出空报告，不硬凑条目', () => {
  const clean = diagnosticReport({ body: '有个做家政的老板，去年十月开始发内容，半年只来两条询盘。他把报价改成先给一次免费诊断，第二个月来了十一个。', platform: '抖音' })
  assert.equal(clean.entries.some(entry => entry.code === 'self_intro'), false)
  assert.equal(clean.entries.some(entry => entry.code === 'platform_mixup'), false)
  assert.ok(clean.footer, '没有条目也要给结尾声明')
})

test('22 个特征骨架照搬 dbs-ai-check：每条都有名字、背后意图和追问', () => {
  assert.equal(aiFeatures.length, 22, '规格要求的是移植源技能的 22 个特征')
  assert.deepEqual(aiFeatures.map(feature => feature.id), Array.from({ length: 22 }, (unused, index) => index + 1), '编号要不重不漏')
  assert.equal(new Set(aiFeatures.map(feature => feature.code)).size, 22, '特征码不能重复')
  aiFeatures.forEach(feature => {
    assert.ok(feature.name, `#${feature.id} 缺特征名`)
    assert.ok(feature.intent, `#${feature.id} 缺背后意图`)
    assert.ok(feature.question, `#${feature.id} 缺追问`)
    assert.ok(Object.hasOwn(aiFeatureSeverityLabels, feature.severity), `#${feature.id} 的严重度不在三档里：${feature.severity}`)
  })
  // 误伤警告是源技能的核心防误判机制，不能只抄特征名把这块丢了。
  assert.ok(aiFeatureCautions.length >= 5, '源技能标了五条误伤警告')
})

test('一句话不硬配一条追问：对得上特征才带追问', () => {
  // 这两处是结构问题（平台名、自我介绍），不是 22 特征里的任何一条。
  const structural = diagnosticReport({ body: '这版也发到小红书效果不错。\n大家好，我是 Agnes，关注我带你做内容。', platform: '抖音' })
  assert.ok(structural.entries.length >= 2)
  assert.ok(structural.entries.every(entry => !entry.feature), '结构问题不该被算成 AI 特征')
  assert.ok(structural.entries.every(entry => !entry.followup), '对不上特征的条目不硬配追问')

  const tone = diagnosticReport({ body: '这不是方法，而是态度。', platform: '抖音' })
  const hit = tone.entries.find(entry => entry.code === 'ai_tone_phrase')
  assert.ok(hit, '「不是 X 是 Y」应当命中')
  assert.equal(hit.feature.id, 8, '应当对应特征 8')
  assert.ok(hit.followup, '命中特征就带追问')
})

test('语言层不归并、不设条数上限：命中多少条就出多少条', () => {
  // 归并版会把下面这些压成三四个类别，一个 code 一条就不该压。
  const body = [
    '大家好，我是 Agnes，关注我带你做内容。',
    '这不是方法，而是态度。',
    '拆成几块、裂变、多平台分发，一套流程跑通。',
    '首先要想清楚，其次要执行，此外要坚持。',
    '有个人做得很成功，赚了很多钱。',
    '所以你要相信自己，你值得更好的。',
  ].join('\n')
  const report = diagnosticReport({ body, platform: '抖音' })
  const codes = new Set(report.entries.map(entry => entry.code))
  assert.ok(codes.size >= 5, `同时命中多种特征不该被归并掉，实际只出了：${[...codes].join('、')}`)
  assert.ok(report.entries.every(entry => !Object.hasOwn(entry, 'category')), '条目里不该再有「类别」这个字段')
  assert.ok(report.entries.every(entry => entry.label), '每条都要有名字，不能只剩 code')
  assert.equal(Object.hasOwn(draftChecks, 'reminderCategories'), false, '7 类归并的代码要撤掉')
})

const llmMock = await startSharedLlmMock()
const port = testPort(41800, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'diagnostic-report-test-')), 'data.json')
writeFileSync(dataFile, '{}')

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...llmMock.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 20000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

test('质量诊断把报告挂进检查结果，界面不用自己拼顺序', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'diagnostic-owner'
  const headers = { 'x-user-id': owner, 'content-type': 'application/json' }

  const drafts = await (await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title: '内容要按成交写', strategy_layer: 'trust', goal_refs: [] } }) })).json()
  const draft = drafts[0]
  assert.ok(draft.id)
  await fetch(`${baseUrl}/api/drafts/${draft.id}/checks/persona`, { method: 'POST', headers, body: '{}' })
  const response = await fetch(`${baseUrl}/api/drafts/${draft.id}/checks/quality`, { method: 'POST', headers, body: '{}' })
  assert.equal(response.status, 200)
  const updated = await response.json()
  const report = updated.checks.quality.report
  assert.ok(report, '质量诊断要带报告')
  assert.ok(Array.isArray(report.entries))
  assert.ok(report.severity_labels && report.footer, '报告要带严重度词汇和结尾声明')
  // 说明：固定 mock 正文不产生语言层命中，这里只验证接线和形状；
  // 带命中时的渲染由上面的单元测试盯。别把 entries 为空当成绿。
  assert.match(report.footer, /以上是检测结果，不涉及修改/)
  const known = report.entries.map(entry => entry.position).filter(position => position >= 0)
  assert.deepEqual(known, [...known].sort((left, right) => left - right), '报告条目要按正文顺序返回')
})
