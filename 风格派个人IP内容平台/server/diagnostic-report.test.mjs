import assert from 'node:assert/strict'
import test from 'node:test'
import { diagnosticReport, diagnosticReportFooter, diagnosticSeverityLabels } from './draft-checks.mjs'

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
  assert.ok([...levels].every(level => ['serious', 'notable', 'slight'].includes(level)))
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
