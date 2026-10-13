import assert from 'node:assert/strict'
import test from 'node:test'
import { applySlotRewrite, bodySegments, buildSlotOptions, findSlotOption, platformGenres, replaceBodySegment, slotRewriteMessages, titleMethods } from './draft-slots.mjs'

const structures = [
  { id: 1, title: '对标dbs·爆款四段式骨架', content_type: '母模板', steps: ['① 开头钩子', '② 痛点', '③ 方法', '④ 结尾'] },
  { id: 2, title: '对标dbs·开头范式一：预测攻击式', content_type: '开头钩子', steps: ['公式：反常识断言 + 能力反转'] },
  { id: 3, title: '对标dbs·开头范式四：数据反差式', content_type: '开头钩子', steps: ['公式：惊人数据 + 反常识结论'] },
  { id: 6, title: '对标dbs·结尾范式：金句复现', content_type: '结尾引导', steps: ['做法：把开头断言再说一遍'] },
  { id: 9, title: '自有·我的收尾习惯', content_type: '结尾引导', steps: ['做法：直接给下一步'] },
  { id: 20, title: '对标dbs·拆解：某爆款', content_type: '拆解', steps: ['钩子'] },
  { id: 21, title: '没有步骤的清单', content_type: '清单', steps: [] },
]

test('槽位选项按用途分类并标注来源', () => {
  const options = buildSlotOptions({ structures, platform: '抖音' })
  assert.equal(options.title.length, titleMethods.length)
  assert.equal(options.title.length, 8)
  assert.ok(options.title.some(item => item.source === '对标dbs') && options.title.some(item => item.source === '自有'))

  assert.deepEqual(options.opening.map(item => item.id), ['structure-2', 'structure-3'])
  assert.ok(options.opening.every(item => item.source === '对标dbs'))
  assert.ok(options.opening.every(item => !item.name.startsWith('对标dbs')))

  assert.deepEqual(options.ending.map(item => item.id), ['structure-6', 'structure-9'])
  assert.deepEqual(options.ending.map(item => item.source), ['对标dbs', '自有'])

  // 正文结构分两组：当前平台体裁 + 母模板；拆解与清单不进选择器，无步骤的也不进。
  const structureIds = options.structure.map(item => item.id)
  assert.deepEqual(structureIds, ['genre-douyin', 'structure-1'])
  assert.equal(options.structure[0].name, '抖音口播三段')
  assert.ok(!structureIds.includes('structure-20') && !structureIds.includes('structure-21'))
})

test('平台体裁只给当前平台，未指定平台时给全部', () => {
  assert.equal(buildSlotOptions({ structures, platform: '公众号' }).structure[0].id, 'genre-gzh')
  assert.equal(buildSlotOptions({ structures, platform: '' }).structure.filter(item => item.id.startsWith('genre-')).length, platformGenres.length)
})

test('找不到的槽位选项返回 null', () => {
  const options = buildSlotOptions({ structures, platform: '抖音' })
  assert.equal(findSlotOption(options, 'opening', 'structure-999'), null)
  assert.equal(findSlotOption(options, 'ending', 'structure-2'), null)
  assert.equal(findSlotOption(options, 'structure', 'genre-douyin').name, '抖音口播三段')
})

test('正文按行定位：标题行不参与替换，开头段与结尾段各自成区间', () => {
  const body = '标题：灵感枯竭？那是你没建素材银行\n\n正文：\n你是不是也这样：\n盯着屏幕两小时\n\n我有个客户，半年粉丝不到500。\n\n赚到钱之后我才明白：灵感是彩票，系统是提款机。'
  const segments = bodySegments(body)
  assert.equal(segments.head, '标题：灵感枯竭？那是你没建素材银行\n\n正文：')
  assert.equal(segments.opening, '你是不是也这样：\n盯着屏幕两小时')
  assert.equal(segments.ending, '赚到钱之后我才明白：灵感是彩票，系统是提款机。')

  const opened = replaceBodySegment(body, 'opening', '别再靠灵感了。')
  assert.match(opened, /^标题：灵感枯竭？那是你没建素材银行\n\n正文：\n别再靠灵感了。\n\n我有个客户/)
  assert.match(opened, /赚到钱之后我才明白：灵感是彩票，系统是提款机。$/, '替换开头不应动结尾')
  assert.match(opened, /我有个客户，半年粉丝不到500。/, '替换开头不应动中间段落')

  const ended = replaceBodySegment(body, 'ending', '先建库，再谈灵感。')
  assert.match(ended, /^标题：灵感枯竭？那是你没建素材银行/, '替换结尾不应动标题行')
  assert.match(ended, /先建库，再谈灵感。$/)
  assert.match(ended, /盯着屏幕两小时/, '替换结尾不应动开头段落')
})

test('没有头部行的正文也能定位首尾段', () => {
  const body = '第一段\n还是第一段\n\n第二段\n\n最后一段'
  assert.equal(bodySegments(body).opening, '第一段\n还是第一段')
  assert.equal(bodySegments(body).ending, '最后一段')
  assert.equal(replaceBodySegment(body, 'opening', '换了开头'), '换了开头\n\n第二段\n\n最后一段')
  assert.equal(replaceBodySegment(body, 'ending', '换了结尾'), '第一段\n还是第一段\n\n第二段\n\n换了结尾')
})

test('空改写结果被拒绝，不会把正文清空', () => {
  assert.throws(() => replaceBodySegment('正文：\n一段话', 'opening', '   '), /改写结果为空/)
  assert.throws(() => applySlotRewrite({ slot: 'structure', draft: { body: '原文' }, rewritten: '' }), /改写结果为空/)
})

// 沙箱界面走查抓到的丢内容缺陷：口播稿转换出来就是一整段（没有空行），
// 这时首尾段区间＝整篇，套区间等于把正文其余部分全删掉——549 字的稿子点一次「开头句」剩 86 字。
test('一整段没有空行的稿子：换开头只换第一句，换结尾只换最后一句', () => {
  const spoken = '西贝温州万象城店十年闭店，无数人骂员工人效低。但你以为这是人的问题，就错得离谱了。真正的原因是账算在了人身上，而不是流程上。'
  assert.equal(bodySegments(spoken).singleBlock, true)
  const opened = replaceBodySegment(spoken, 'opening', '店关了就关了吧，别急着骂员工。')
  assert.ok(opened.startsWith('店关了就关了吧，别急着骂员工。但你以为这是人的问题'), `开头没按句界替换：${opened}`)
  assert.match(opened, /真正的原因是账算在了人身上，而不是流程上。$/, '换开头把后面的正文弄丢了')
  const ended = replaceBodySegment(spoken, 'ending', '先去看单店账，再谈扩张。')
  assert.ok(ended.startsWith('西贝温州万象城店十年闭店，无数人骂员工人效低。但你以为这是人的问题'), '换结尾动到了前面的正文')
  assert.match(ended, /先去看单店账，再谈扩张。$/)
  assert.ok(ended.length > '先去看单店账，再谈扩张。'.length, '换结尾把整篇清空了')
})

test('整段只有一句话时，换开头换结尾就是换它，不追加空话', () => {
  assert.equal(replaceBodySegment('就一句话。', 'opening', '换成了另一句。'), '换成了另一句。')
  assert.equal(replaceBodySegment('就一句话。', 'ending', '换成了另一句。'), '换成了另一句。')
})

test('多段稿子的原有行为不动（回归）', () => {
  const body = '第一段\n\n第三段\n\n最后一段'
  assert.equal(bodySegments(body).singleBlock, false)
  assert.equal(replaceBodySegment(body, 'opening', '换了开头'), '换了开头\n\n第三段\n\n最后一段')
  assert.equal(replaceBodySegment(body, 'ending', '换了结尾'), '第一段\n\n第三段\n\n换了结尾')
})

test('applySlotRewrite 按槽位产出对应补丁', () => {
  const draft = { title: '旧标题', body: '标题：旧标题\n\n正文：\n第一段\n\n最后一段' }
  assert.deepEqual(applySlotRewrite({ slot: 'title', draft, rewritten: '「新标题」' }), { title: '新标题' })
  assert.equal(applySlotRewrite({ slot: 'title', draft, rewritten: '这是一个超过四十个字的标题'.repeat(4) }).title.length, 40)
  assert.match(applySlotRewrite({ slot: 'opening', draft, rewritten: '新开头' }).body, /正文：\n新开头\n\n最后一段/)
  assert.match(applySlotRewrite({ slot: 'ending', draft, rewritten: '新结尾' }).body, /第一段\n\n新结尾$/)
  assert.deepEqual(applySlotRewrite({ slot: 'structure', draft, rewritten: '整篇重排后的正文' }), { body: '整篇重排后的正文' })
  assert.throws(() => applySlotRewrite({ slot: 'unknown', draft, rewritten: 'x' }), /不支持的槽位/)
})

test('改写指令携带目标写法、平台与当前正文', () => {
  const option = findSlotOption(buildSlotOptions({ structures, platform: '抖音' }), 'opening', 'structure-2')
  const messages = slotRewriteMessages({ slot: 'opening', option, draft: { platform: '抖音', title: 'T', body: 'B' }, styleMemories: [{ content: '语速中等偏快' }] })
  assert.equal(messages.length, 2)
  assert.match(messages[0].content, /只重写正文的第一段/)
  const payload = JSON.parse(messages[1].content)
  assert.equal(payload.平台, '抖音')
  assert.equal(payload.目标写法, '开头范式一：预测攻击式')
  assert.deepEqual(payload.公式或步骤, ['公式：反常识断言 + 能力反转'])
  assert.deepEqual(payload.对标打法, ['语速中等偏快'])
  assert.throws(() => slotRewriteMessages({ slot: 'nope', option, draft: {} }), /不支持的槽位/)
})
