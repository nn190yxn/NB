import assert from 'node:assert/strict'
import test from 'node:test'
import { checkPersona, checkPublishChecklist, checkQuality, draftCheckRewriteNote, hasBlockedCheck, scanGeneratedBodies } from './draft-checks.mjs'
import { draftBriefPrompt, draftLengthTargets } from './draft-writing.mjs'

const opening = { option_id: 'structure-2', name: '开头范式一：预测攻击式', source: '对标dbs', applied_at: '2026-09-14T00:00:00.000Z' }
const baseDraft = { id: 4, version: 2, title: '真实创业复盘', body: '很多人以为这件事靠技巧，其实关键是先把真实过程讲清楚。\n\n我记录一次真实过程，说明问题、证据和可执行步骤。\n\n最后给出方法和复盘建议，帮助读者完成下一步行动。', platform: '抖音', opening_ref: opening, source_refs: [{ type: 'topic', id: 4 }], fact_check_status: 'needs_review', variant_group_id: 'group-1', checks: {} }

test('persona check warns without blocking and quality returns bounded dimensions', () => {
  const persona = checkPersona(baseDraft, { role: '', audiences: [], pillars: [], prohibited_patterns: [] })
  assert.equal(persona.status, 'warning')
  assert.ok(persona.score >= 0 && persona.score <= 100)
  const quality = checkQuality(baseDraft, { audiences: [], pillars: [], viewpoints: [], problems: [] })
  assert.equal(quality.status, 'passed')
  assert.deepEqual(Object.keys(quality.dimensions), ['opening_clarity', 'audience_fit', 'core_point', 'evidence', 'structure_and_risk'])
  assert.ok(Object.values(quality.dimensions).every(score => score >= 0 && score <= 100))
})

test('段落结构判据用未折叠的原文，口播稿不按分段要求', () => {
  // 修复前：body 先被 text() 折叠掉换行，再 split(/\n\s*\n/) 永远是 1 段，
  // 实测 32 条真实草稿 100% 命中 structure_weak，这一维从来没得过 100 分。
  const paragraphs = checkQuality({ ...baseDraft, body: `${'第一段：先说结论，再给过程。'.repeat(6)}\n\n${'第二段：给可执行的一步。'.repeat(6)}` }, {})
  assert.equal(paragraphs.dimensions.structure_and_risk, 100)
  assert.equal(paragraphs.evidence.some(item => item.code === 'structure_weak'), false)

  // 长文一整段不分段仍要提示
  const flat = checkQuality({ ...baseDraft, body: '一整段长文，中间没有空行。'.repeat(80) }, {})
  assert.equal(flat.dimensions.structure_and_risk, 65)
  assert.ok(flat.evidence.some(item => item.code === 'structure_weak'))

  // 口播稿本来就常常一整段（门槛跟平台上限走），不因为段落数被扣分
  const spoken = checkQuality({ ...baseDraft, platform: '抖音', body: '口播稿一整段，不超过两百五十个字。'.repeat(8) }, {})
  assert.equal(spoken.dimensions.structure_and_risk, 100)
  assert.equal(spoken.evidence.some(item => item.code === 'structure_weak'), false)
})

test('质量门不把序数「第一」当风险词阻断，真主张仍然阻断', () => {
  const ordinal = checkQuality({ ...baseDraft, body: `${'第一步，先把真实过程讲清楚。'.repeat(5)}\n\n${'第二步，用第一性原理解释为什么。'.repeat(5)}` }, {})
  assert.equal(ordinal.evidence.some(item => item.code === 'risk_words'), false)
  assert.equal(ordinal.dimensions.structure_and_risk, 100)

  const claim = checkQuality({ ...baseDraft, body: '我们全网第一，包赚不赔。' }, {})
  const risk = claim.evidence.find(item => item.code === 'risk_words')
  assert.ok(risk, '极限用语必须仍然阻断')
  assert.equal(risk.severity, 'blocked')
  assert.equal(claim.status, 'blocked')
})

test('受众写成整句时只提醒改档案，不再算正文不合格', () => {
  // 他的受众是 17 字整句（「想做个人IP却每天从零开始的创业者」），正文永远不会原样出现这句，这条会一直命中，等于永远卡死。
  // 实测：32 条真实草稿里只有 1 条命中，说明它量的是档案的写法，不是正文的质量。
  const longAudience = { audiences: ['想做个人IP却每天从零开始的创业者'], pillars: [], viewpoints: [], problems: [] }
  const quality = checkQuality(baseDraft, longAudience)
  assert.equal(quality.evidence.some(item => item.code === 'audience_weak'), false, '档案写整句不算正文不合格')
  assert.ok(quality.suggestions.some(item => item.includes('2-8 字短词')), '但仍要提醒改档案')
})
test('quality and publish checks block missing evidence, risk and fact verification', () => {
  const quality = checkQuality({ ...baseDraft, opening_ref: null, source_refs: [], body: '包赚' }, {})
  assert.equal(quality.status, 'blocked')
  assert.ok(quality.evidence.some(item => item.code === 'opening_missing'))
  assert.ok(quality.evidence.some(item => item.code === 'risk_words'))
  const publish = checkPublishChecklist(baseDraft)
  assert.equal(publish.status, 'blocked')
  assert.equal(publish.dimensions.fact_check, false)
  assert.equal(hasBlockedCheck({ checks: { quality } }), true)
  assert.equal(hasBlockedCheck({ checks: { quality: { status: 'passed' } } }), false)
})

test('质量门把模型不遵守的平台字数不足当成警告而不是拦停', () => {
  // 实测：提示词要求抖音不超 400 字，模型给过 420 字；公众号要求 1000-2500，模型给过 514 字。
  const long = checkQuality({ ...baseDraft, platform: '抖音', body: '口'.repeat(950) }, {})
  assert.equal(long.status, 'passed', '字数不合规不应直接拦停发布')
  const lengthEvidence = long.evidence.find(item => item.code === 'platform_length')
  assert.ok(lengthEvidence, '字数超出目标必须留下证据')
  assert.equal(lengthEvidence.severity, 'warning')
  assert.match(lengthEvidence.message, /950 字/)
  assert.match(lengthEvidence.message, /300-900/)
  assert.ok(long.suggestions.some(item => item.includes('300-900')))

  const short = checkQuality({ ...baseDraft, platform: '公众号', body: '短'.repeat(514) }, {})
  const shortEvidence = short.evidence.find(item => item.code === 'platform_length')
  assert.match(shortEvidence.message, /514 字/)
  assert.match(shortEvidence.message, /1000-2500 字/)

  const fine = checkQuality({ ...baseDraft, platform: '小红书', body: '好'.repeat(507) }, {})
  assert.equal(fine.evidence.some(item => item.code === 'platform_length'), false)

  const midOk = checkQuality({ ...baseDraft, platform: '抖音', content_format: '中视频', body: '口'.repeat(800) }, {})
  assert.equal(midOk.evidence.some(item => item.code === 'platform_length'), false)
  const midShort = checkQuality({ ...baseDraft, platform: '抖音', content_format: '中视频', body: '口'.repeat(200) }, {})
  assert.match(midShort.evidence.find(item => item.code === 'platform_length').message, /400-1000 字/)
})

test('检查意见只抽出能改正文的指令，槽位和档案短词不管', () => {
  const body = `拆完爆款不会用？因为你只学了皮毛。${'口'.repeat(950)}有个客户。这就叫底层逻辑。`
  const draft = { ...baseDraft, platform: '抖音', opening_ref: null, body }
  const persona = checkPersona(draft, { role: '顾问', audiences: ['想做个人IP却每天从零开始的创业者'], pillars: ['素材原子化'] })
  const quality = checkQuality(draft, { audiences: ['想做个人IP却每天从零开始的创业者'], pillars: ['素材原子化'] })
  const note = draftCheckRewriteNote({ ...draft, checks: { persona, quality } })
  assert.match(note, /把字数改到300-900/)
  assert.match(note, /不要另写一篇更简单的/)
  assert.match(note, /不要问句/)
  assert.match(note, /咨询腔/)
  assert.match(note, /底层逻辑/)
  assert.doesNotMatch(note, /开头句/)
  assert.doesNotMatch(note, /档案里的/)
  assert.equal(draftCheckRewriteNote({
    ...baseDraft,
    checks: {
      quality: {
        status: 'blocked',
        draft_version: 2,
        evidence: [{ code: 'opening_missing', message: '尚未用「开头句」槽位确定开头范式', severity: 'blocked' }],
        suggestions: ['点草稿的「开头句」槽位，从方法库选一个开头范式'],
      },
    },
  }), '')
})

test('质量门把设问开头当成警告：提示词要求第一句直给冲突或结论', () => {
  const question = checkQuality({ ...baseDraft, body: '你是不是经常面对空白的文档，觉得没东西可写？\n\n我记录一次真实过程。' }, {})
  const evidence = question.evidence.find(item => item.code === 'opening_question')
  assert.ok(evidence, '首句是问句必须留下证据')
  assert.equal(evidence.severity, 'warning')
  assert.match(evidence.message, /你是不是经常面对空白的文档/)
  assert.ok(question.suggestions.some(item => item.includes('开头句')))
  assert.equal(question.status, 'passed', '设问开头不应直接拦停发布')

  const statement = checkQuality({ ...baseDraft, body: '很多人以为这件事靠技巧，其实是先把过程讲清楚。' }, {})
  assert.equal(statement.evidence.some(item => item.code === 'opening_question'), false)
  // 问句出现在第二句不算开头问题
  const later = checkQuality({ ...baseDraft, body: '先给结论：这件事靠过程。那为什么大家都做不到？' }, {})
  assert.equal(later.evidence.some(item => item.code === 'opening_question'), false)
  // 口播稿开头是镜头提示行时，要看下一行而不是把镜头提示当成句子
  const afterDirection = checkQuality({ ...baseDraft, body: '（镜头怼脸，语速快）\n你以为灵感枯竭是因为没东西写？\n\n其实是因为没素材库。' }, {})
  const directionEvidence = afterDirection.evidence.find(item => item.code === 'opening_question')
  assert.ok(directionEvidence, '镜头提示行之后的问句仍要能被发现')
  assert.match(directionEvidence.message, /你以为灵感枯竭是因为没东西写？$/)
  assert.doesNotMatch(directionEvidence.message, /镜头怼脸/)
  // 首行只有镜头提示、下一行是结论时不应误报
  const clean = checkQuality({ ...baseDraft, body: '（镜头平稳，语速中等）\n别再做灵感奴隶了。\n\n具体怎么做。' }, {})
  assert.equal(clean.evidence.some(item => item.code === 'opening_question'), false)
  // 标题行与「正文：」结构标签不算开头第一句
  const titled = checkQuality({ ...baseDraft, body: '标题：灵感枯竭？那是你没建素材库\n正文：\n别急着怪自己没灵感，先看你的素材库。' }, {})
  assert.equal(titled.evidence.some(item => item.code === 'opening_question'), false)
})

test('提示词禁止自我介绍与引导关注', () => {
  const prompt = draftBriefPrompt({})
  assert.match(prompt, /不要写自我介绍/)
  assert.match(prompt, /不要写引导关注、点赞一类话术/)
  assert.match(prompt, /不要写 Markdown 标记/)
  assert.match(prompt, /宁可少一个案例也不编造/)
  assert.match(prompt, /语义块/)
  assert.match(prompt, /不要写成名词解释/)
  assert.match(prompt, /不要把机制、钩子、公式、骨架这些词写进给读者看的正文/)
})

test('质量门把模型编造的自我介绍当成警告', () => {
  // 实测：模型把自己服务商的名字当成创作者——「大家好，我是Agnes」。
  const intro = checkQuality({ ...baseDraft, platform: '视频号', body: '大家好，我是Agnes。\n今天讲一个反常识：灵感枯竭其实是素材没拆开。\n关注我，让你的个人IP可执行。' }, {})
  const evidence = intro.evidence.find(item => item.code === 'self_intro')
  assert.ok(evidence, '自我介绍必须留下证据')
  assert.equal(evidence.severity, 'warning')
  assert.match(evidence.message, /我是Agnes/)
  assert.match(evidence.message, /关注我/)
  assert.ok(intro.suggestions.some(item => item.includes('删掉自我介绍')))

  const named = checkQuality({ ...baseDraft, body: '我叫小李，做了三年内容。\n先说结论：素材得拆开用。' }, {})
  assert.match(named.evidence.find(item => item.code === 'self_intro').message, /我叫小李/)

  // 不能误伤正常句式
  const normal = checkQuality({ ...baseDraft, body: '我是做个人IP咨询的，先给结论：内容是系统的产物。\n今天记录一次真实复盘。' }, {})
  assert.equal(normal.evidence.some(item => item.code === 'self_intro'), false)
  const clean = checkQuality({ ...baseDraft, body: '很多人以为这件事靠技巧，其实是先把过程讲清楚。' }, {})
  assert.equal(clean.evidence.some(item => item.code === 'self_intro'), false)
})

test('质量门拦下结构骨架与标记泄漏', () => {
  // 实测四种真实泄漏：Markdown 标题、Markdown 加粗、「N 个」结构占位、其他平台建议。
  const heading = checkQuality({ ...baseDraft, body: '# 赚到钱之后我才明白\n\n## 什么是原子化素材？\n\n正文从这里开始。' }, {})
  assert.match(heading.evidence.find(item => item.code === 'format_leak').message, /Markdown 标题/)
  const bold = checkQuality({ ...baseDraft, body: '先说结论：素材要拆开用。\n\n**1. 痛点场景**\n\n具体做法。' }, {})
  assert.match(bold.evidence.find(item => item.code === 'format_leak').message, /Markdown 加粗/)
  const placeholder = checkQuality({ ...baseDraft, body: '一条内容要含：\n\n- 1个痛点场景\n- 1个客户案例（名字+数据）\n' }, {})
  assert.match(placeholder.evidence.find(item => item.code === 'format_leak').message, /结构占位/)
  const crossPlatform = checkQuality({ ...baseDraft, body: '先给结论：定位不清就白干。\n\n- 抖音：开头直接冲突\n- 小红书：细节种草\n' }, {})
  assert.match(crossPlatform.evidence.find(item => item.code === 'format_leak').message, /其他平台建议/)
  assert.equal(crossPlatform.evidence.find(item => item.code === 'format_leak').severity, 'warning')

  // 正常正文与普通列表不能误伤
  const clean = checkQuality({ ...baseDraft, body: '很多人以为这件事靠技巧，其实是先把过程讲清楚。\n\n- 事实：80% 的账号失败在定位不清。\n- 案例：某本地老板转型三个月，流量归零。' }, {})
  assert.equal(clean.evidence.some(item => item.code === 'format_leak'), false)
  const numbers = checkQuality({ ...baseDraft, body: '1个反常识判断比十个技巧有用，这是我做了三年内容后的结论。' }, {})
  assert.equal(numbers.evidence.some(item => item.code === 'format_leak'), false)
})

test('具体案例与数字必须有人确认', () => {
  // 实测：素材库里只有对标样本，模型为了满足「用具体经历支撑」把客户案例编了 12 条。
  const invented = checkQuality({ ...baseDraft, body: '我有个客户，换了5个定位，最后用「本地老板IP顾问」这个定位，3个月涨粉2万。' }, {})
  const evidence = invented.evidence.find(item => item.code === 'case_claim')
  assert.ok(evidence, '编造的客户案例必须留下证据')
  assert.equal(evidence.severity, 'warning')
  assert.match(evidence.message, /案例人物/)
  assert.match(evidence.message, /结果数字/)
  assert.match(evidence.message, /我有个客户/)
  assert.ok(invented.suggestions.some(item => item.includes('确认案例与数字是否真实')))

  const vendor = checkQuality({ ...baseDraft, body: '上个月，一位做本地家政的老板，提炼出一个核心观点：干净不是扫出来的，是收纳出来的。' }, {})
  assert.match(vendor.evidence.find(item => item.code === 'case_claim').message, /案例人物/)
  const numberOnly = checkQuality({ ...baseDraft, body: '- 案例：某本地老板转型三个月，因定位模糊，流量归零。' }, {})
  assert.match(numberOnly.evidence.find(item => item.code === 'case_claim').message, /结果数字/)

  // 不能误伤：通用判断、单纯反问客户、真实时间描述
  const judgement = checkQuality({ ...baseDraft, body: '定位不清的内容都是无效自晒。先想清楚你卖给谁，再决定写什么。' }, {})
  assert.equal(judgement.evidence.some(item => item.code === 'case_claim'), false)
  const question = checkQuality({ ...baseDraft, body: '一个反问：你确定你的客户，真的知道你卖什么吗？' }, {})
  assert.equal(question.evidence.some(item => item.code === 'case_claim'), false)
  const timeline = checkQuality({ ...baseDraft, body: '上周把这个选题拆成了三条内容，具体怎么拆的下面说。' }, {})
  assert.equal(timeline.evidence.some(item => item.code === 'case_claim'), false)
})

test('质量门把咨询腔和工程词标出来', () => {
  const jargon = checkQuality({ ...baseDraft, body: '把复杂概念拆解成小白能听懂的颗粒度。先用钩子抓住注意力，这就是可复制机制。' }, {})
  const evidence = jargon.evidence.find(item => item.code === 'consulting_tone')
  assert.ok(evidence, '工程词必须留下证据')
  assert.equal(evidence.severity, 'warning')
  assert.match(evidence.message, /颗粒度/)
  assert.match(evidence.message, /钩子/)
  assert.ok(jargon.suggestions.some(item => item.includes('去 AI 感改写')))

  const lecture = checkQuality({ ...baseDraft, body: '首先，灵感不重要。其次，系统才重要。总而言之，你要沉淀资产。' }, {})
  assert.match(lecture.evidence.find(item => item.code === 'consulting_tone').message, /首先/)

  const normal = checkQuality({ ...baseDraft, body: '很多人以为这件事靠技巧，其实是先把过程讲清楚。定位不清就先别拍。' }, {})
  assert.equal(normal.evidence.some(item => item.code === 'consulting_tone'), false)
})

test('提示词里的字数与确定性检查用的是同一套数字', () => {
  const prompt = draftBriefPrompt({})
  assert.match(prompt, new RegExp(`小红书图文笔记 ${draftLengthTargets.小红书.min}-${draftLengthTargets.小红书.max} 字`))
  assert.match(prompt, new RegExp(`${draftLengthTargets.抖音.min}-${draftLengthTargets.抖音.max} 字`))
  assert.match(prompt, new RegExp(`公众号才是长文 ${draftLengthTargets.公众号.min}-${draftLengthTargets.公众号.max} 字`))
})

test('生成验收扫咨询腔、编客户、设问开头和四平台同一篇', () => {
  const sermon = '很多人做IP内容评估，靠的是拍完后的感觉。钱是唯一诚实的反馈。我有个客户花了三天写文案，结果数据惨淡。把内容拆到颗粒度再评估。'.repeat(2)
  const bad = scanGeneratedBodies({ 小红书: sermon, 抖音: `你是不是觉得做IP最难？${sermon}`, 视频号: sermon, 公众号: sermon })
  assert.equal(bad.failed, true)
  assert.ok(bad.same_essay.length)
  assert.ok(bad.issues['视频号'].some(item => item.code === 'consulting_tone'))
  assert.ok(bad.issues['小红书'].some(item => item.code === 'case_claim'))
  assert.ok(bad.issues['抖音'].some(item => item.code === 'opening_question'))

  const clean = scanGeneratedBodies({
    小红书: '昨天改选题，发现发完就等数据的人最多。先看这条解决哪个场面。你现在看的是点赞还是询盘。'.repeat(3),
    抖音: '点赞会撒谎，询盘不会。别再为流量写，为成交写。问怎么买才算有效。'.repeat(3),
    视频号: '泛泛而谈找路人。讲具体场面才找得着人。私域不是朋友圈展示柜。'.repeat(3),
    公众号: '上周我把内容当了一次实验，看有没有人来问下一步。没有就换角度，有就放大。'.repeat(3),
  })
  assert.equal(clean.failed, false)

  const copies = scanGeneratedBodies({ 小红书: '短文相同', 抖音: '短文相同', 视频号: '短文相同', 公众号: '短文相同' })
  assert.equal(copies.failed, true)
  assert.ok(copies.same_essay.some(item => item.reason === 'identical'))
})

test('legacy drafts remain publish-check compatible when otherwise complete', () => {
  const publish = checkPublishChecklist({ ...baseDraft, variant_group_id: null, variant_type: 'legacy', fact_check_status: 'verified' })
  assert.equal(publish.status, 'passed')
})

test('正文出现方法骨架或其他平台名都算问题', () => {
  // 实测模型原话：「同一内核，抖音发 15 秒快节奏，小红书发带细节图文，视频号发深度对话。一条内容，裂变成三条爆款。」
  const mixup = checkQuality({ ...baseDraft, platform: '视频号', body: '我把观点拆成三块：踩过的坑、反常识判断、具体数据。同一内核，抖音发15秒快节奏，小红书发带细节图文。一条内容，裂变成三条爆款。' }, {})
  assert.ok(mixup.evidence.some(item => item.code === 'platform_mixup'))
  assert.ok(mixup.evidence.some(item => item.code === 'method_talk'))
  assert.equal(mixup.status, 'passed', '写作问题只给警告，不拦停质量门')

  // 自己平台的名字不算串台；「分三步走」这类正常叙事不算方法骨架。
  const clean = checkQuality({ ...baseDraft, platform: '抖音', body: '这条只在抖音发。改选题分三步走：先看数据，再找场面，最后给判断。' }, {})
  assert.equal(clean.evidence.some(item => item.code === 'platform_mixup'), false)
  assert.equal(clean.evidence.some(item => item.code === 'method_talk'), false)
})

test('去 AI 化判据拦住升华句、无主体案例和全篇通用判断', () => {
  const vague = '第一，踩过的坑。第二，反常识的判断。第三，具体案例。素材原子化，不是让你变成流水线工人，而是让你从重复劳动中解放出来。某某人每天只做一件小事，五年后复利极高。真正的长期主义其实是高频迭代。把内容当作品会自嗨，当成能力展示会没人看。讲得越清楚转发的人越多，观众不欠你注意力。'
  const quality = checkQuality({ ...baseDraft, platform: '抖音', body: vague }, {})
  for (const code of ['ai_tone_phrase', 'vague_case', 'no_concrete_support']) {
    assert.ok(quality.evidence.some(item => item.code === code), `质量门缺 ${code}`)
  }
  const gate = scanGeneratedBodies({ 抖音: vague })
  assert.ok(gate.issues.抖音.some(item => item.code === 'ai_tone_phrase'))
  assert.ok(gate.issues.抖音.some(item => item.code === 'vague_case'))
  assert.ok(gate.issues.抖音.some(item => item.code === 'no_concrete_support'))

  const concrete = '上周三改选题，我把最近一条数据好的稿子摊开看，评论区问价的人里同行不少。所以这一拍我直接讲报价怎么算，不讲怎么涨粉。'
  const clean = checkQuality({ ...baseDraft, platform: '抖音', body: concrete }, {})
  const codes = ['ai_tone_phrase', 'vague_case', 'no_concrete_support']
  assert.equal(clean.evidence.some(item => codes.includes(item.code)), false)
})

test('句子级模板句判据拦得住，具体清单不误伤', () => {
  const cases = [
    ['triple_list', '把内容拆成创新、灵感、洞察，然后往下讲。'],
    ['golden_tail', '我改了三次选题。其实高频迭代才是长期主义。'],
    ['generic_ending', '这条路还很长，未来可期。'],
    ['ing_tail', '他每天更新，象征着一种坚持。'],
    ['avoid_copula', '这次改版标志着内容体系的升级。'],
    ['fake_rebuttal', '有人可能会说这不现实。'],
    ['connector_abuse', '首先讲选题。其次讲拍摄。此外还要剪辑。'],
  ]
  for (const [code, body] of cases) {
    const quality = checkQuality({ ...baseDraft, platform: '抖音', body: body.repeat(6) }, {})
    assert.ok(quality.evidence.some(item => item.code === code), `${code} 没命中：${body}`)
    const gate = scanGeneratedBodies({ 抖音: body.repeat(6) })
    assert.ok(gate.issues.抖音.some(item => item.code === code), `${code} 没进生成验收：${body}`)
  }
  const concreteList = '选题、拍摄、剪辑这三件事我各花了一周。上周三改到第四版才发出去。'.repeat(5)
  const clean = checkQuality({ ...baseDraft, platform: '抖音', body: concreteList }, {})
  assert.equal(clean.evidence.some(item => ['triple_list', 'connector_abuse'].includes(item.code)), false)
})

test('同一问题只给一条建议：人设检查和质量门都报升华句也只写一遍', () => {
  const draft = {
    ...baseDraft,
    platform: '抖音',
    body: '正文内容足够长。'.repeat(20),
    version: 3,
    checks: {
      persona: { draft_version: 3, status: 'failed', evidence: [{ code: 'ai_tone_phrase', message: '正文出现升华式句式：不是A而是B' }] },
      quality: { draft_version: 3, status: 'failed', evidence: [{ code: 'ai_tone_phrase', message: '正文出现升华式句式：不是A而是B' }, { code: 'vague_case', message: '正文出现没有主体的案例：某某人' }] },
    },
  }
  const note = draftCheckRewriteNote(draft)
  assert.equal(note.split('不要只换个说法').length - 1, 1, '升华句只该出现一次')
  assert.equal(note.split('你自己经历过的具体事').length - 1, 1, '某某人只该出现一次')
  assert.ok(note.includes('某某人'))
})

test('档案字段写成整句时只提醒改档案，不算正文不合格', () => {
  const profile = { role: '顾问', audiences: ['想做个人IP却每天从零开始的创业者'], problems: ['选题靠灵感'], pillars: ['定位先于内容'], viewpoints: [], tone_preferences: [], prohibited_patterns: [] }
  const draft = { ...baseDraft, platform: '抖音', body: '定位先于内容这件事我上周改了三版才想明白。'.repeat(6) }
  const quality = checkQuality(draft, profile)
  const persona = checkPersona(draft, profile)
  const codes = [...quality.evidence, ...persona.evidence].map(item => item.code)
  assert.equal(codes.includes('audience_weak'), false, '档案写整句不该算正文不合格')
  assert.equal(codes.includes('audience_mismatch'), false)
  const hints = [...quality.suggestions, ...persona.suggestions].join(' ')
  assert.ok(hints.includes('2-8 字短词'), hints)
})

