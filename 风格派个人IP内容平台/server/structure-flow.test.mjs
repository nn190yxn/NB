import assert from 'node:assert/strict'
import test from 'node:test'
import { structureReport, structureRoleOf } from './structure-flow.mjs'
import { diagnosticReport, diagnosticSeverityLabels, gateCodes, generationGate, scanGeneratedBody } from './draft-checks.mjs'

test('分段按空行，段号与功能照 dbs-script-flow', () => {
  const report = structureReport({ body: '第一段讲背景。\n\n第二段是中间的论证。\n\n第三段收尾。' })
  assert.deepEqual(report.segments.map(item => item.index), [1, 2, 3])
  assert.equal(report.segments[0].role, '开场')
  // 中间段在讲什么要读懂内容，规则判不出来就留空，不编一个像主题的字符串。
  assert.equal(report.segments[1].role, null)
  assert.equal(report.segments[2].role, '结尾')
  assert.equal(structureRoleOf(0, 1), '单项')
})

test('三个维度都只认确定性形态：跳跃、重复、长句、书面套语、自问自答', () => {
  const jump = structureReport({ body: '这一版我改了三遍。\n\n抖音的完播率看前三秒。' })
  assert.ok(jump.findings.some(item => item.code === 'structure_jump'), '两段之间没有承接信号要标出来')
  assert.equal(jump.segments[1].status, 'medium', '段落结构表按最严重的一条标状态')

  const repeat = structureReport({ body: '做好内容要先想清楚你的定位。做好内容先想清楚你自己的定位。' })
  assert.ok(repeat.findings.some(item => item.code === 'structure_repeat'), '同段里说了两遍同一件事要标出来')

  const long = structureReport({ body: '这一句刻意写得非常长用来触发口播流畅度那一档因为它超过三十个字了。' })
  assert.ok(long.findings.some(item => item.code === 'structure_long_sentence'))

  const written = structureReport({ body: '针对这个问题，我们先看一个例子。' })
  assert.ok(written.findings.some(item => item.code === 'structure_written_word'))

  // 偶尔一次自问自答源技能说可以，连续用才烦。
  const once = structureReport({ body: '你以为这靠天赋吗？其实是练出来的。' })
  assert.equal(once.findings.some(item => item.code === 'structure_self_answer'), false)
  const twice = structureReport({ body: '你以为这靠天赋吗？其实是练出来的。你以为这靠运气吗？其实是准备。' })
  assert.ok(twice.findings.some(item => item.code === 'structure_self_answer'))
})

test('结构层风险也走同一套三档词汇，不另造一套说法', () => {
  const report = structureReport({ body: '这一版我改了三遍。\n\n抖音的完播率看前三秒。针对这个问题我们再看一个例子。' })
  assert.ok(report.findings.length > 0)
  report.findings.forEach(item => assert.ok(Object.hasOwn(diagnosticSeverityLabels, item.risk), `风险等级不在三档里：${item.risk}`))
  report.findings.forEach(item => assert.ok(item.fix, '每条问题都要给一个具体改法'))
})

test('闸门只剩「初稿根本没做出来」，自介和字数严重不足降为提醒', () => {
  assert.deepEqual(gateCodes, ['format_leak', 'platform_mixup'])

  // 自介：以前是闸门，现在只提醒，不拦停、不触发自动重写。
  const intro = scanGeneratedBody('大家好，我是 Agnes，关注我带你做内容。' + '正文'.repeat(80), '抖音')
  const introHit = intro.reminders.find(item => item.code === 'self_intro')
  assert.ok(introHit, '自介要进提醒')
  assert.equal(intro.gate.some(item => item.code === 'self_intro'), false, '自介不再是闸门')
  assert.equal(intro.failed, false, '降级后不能再拦停生成')

  // 字数严重不足：同样降级。
  const short = scanGeneratedBody('短'.repeat(100), '公众号')
  assert.ok(short.reminders.some(item => item.code === 'length_severe'), '字数严重不足要进提醒')
  assert.equal(short.failed, false, '字数不足不该触发自动重写')

  // 格式泄漏仍然是闸门：串台是「根本没做出来」这一类。
  const leak = scanGeneratedBody('先说结论。\n## 小标题\n再说理由。', '抖音')
  assert.equal(leak.failed, true, '格式泄漏仍然拦停')
  assert.deepEqual(leak.gate.map(item => item.code), ['format_leak'])
})

test('结构层并进同一份报告，按文本顺序，不硬配追问', () => {
  const report = diagnosticReport({ body: '这一版我改了三遍。\n\n抖音的完播率看前三秒。', platform: '抖音' })
  const structureEntries = report.entries.filter(entry => entry.layer === 'structure')
  assert.ok(structureEntries.length > 0, '结构层的问题要进报告')
  structureEntries.forEach(entry => {
    assert.equal(entry.followup, '', '结构层不硬配语言层的追问')
    assert.ok(entry.fix, '结构层每条要给改法')
    assert.ok(Object.hasOwn(diagnosticSeverityLabels, entry.severity))
  })
  assert.ok(Array.isArray(report.segments) && report.segments.length === 2, '报告要带段落结构表')
  // 整篇级的问题 position 记 -1，排序时排到最后；比较时用同一把尺子。
  const sortKey = entry => (entry.position < 0 ? Number.MAX_SAFE_INTEGER : entry.position)
  assert.ok(report.entries.every((entry, index) => index === 0 || sortKey(report.entries[index - 1]) <= sortKey(entry)), '报告按文本顺序')
  // 干净且连贯的正文两层都没命中时，直接说没发现。
  const clean = diagnosticReport({ body: '我上个月带过一个学员。所以我把过程写下来。', platform: '抖音' })
  if (clean.entries.length === 0) assert.match(clean.summary, /没有发现明显的 AI 特征/)
})

test('不可溯源数字单独也能拦停生成，不用等验收失败', () => {
  // 验收全过的稿子，只要案例位/数字位用了素材里没有的数字，这道闸门一样拦。
  const clean = { failed: false, summary: '' }
  const blocked = generationGate({ scan: clean, unbacked: { 公众号: ['2万'], 抖音: [] } })
  assert.equal(blocked.triggered, true, '数字不可溯源要单独构成闸门')
  assert.match(blocked.summary, /公众号/)
  assert.match(blocked.summary, /2万/, '提示词要点名是哪个数字，模型才知道改哪里')
  assert.match(blocked.summary, /素材里没有的数字/)

  // 素材里有的数字不算，验收也过的话就不拦。
  assert.equal(generationGate({ scan: clean, unbacked: { 公众号: [], 抖音: [] } }).triggered, false)
  assert.equal(generationGate({ scan: clean, unbacked: {} }).summary, null)
  // 验收失败本来就拦，两条理由要合在一份 summary 里给重写提示词。
  const both = generationGate({ scan: { failed: true, summary: '串台' }, unbacked: { 抖音: ['30%'] } })
  assert.equal(both.triggered, true)
  assert.match(both.summary, /串台/)
  assert.match(both.summary, /30%/, '两条理由都要串进 summary')
})
