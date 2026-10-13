import assert from 'node:assert/strict'
import test from 'node:test'
import { checkPersona, checkPublishChecklist, checkQuality, draftCheckRewriteNote, hasBlockedCheck, markableIssues, scanGeneratedBodies } from './draft-checks.mjs'
import { draftBriefPrompt, draftLengthTargets } from './draft-writing.mjs'
import { prohibitedHits } from './redfox.mjs'

// 语言层命中不再归并成类别：reminders 里已经是一个 code 一条，和 evidence 摊平成同一种条目。
const issueItems = checked => [...(checked?.evidence || []), ...(checked?.reminders || [])]
// 生成闸门有「字数严重不足（低于目标下限六成）」一条，健康正文要写够平台下限的字数，
// 否则 failed 会被字数而不是内容决定。
const fillTo = (seed, min) => { let out = ''; while (out.length < min) out += seed; return out }

const opening = { option_id: 'structure-2', name: '开头范式一：预测攻击式', source: '对标dbs', applied_at: '2026-09-14T00:00:00.000Z' }
const baseDraft = { id: 4, version: 2, title: '真实创业复盘', body: '很多人以为这件事靠技巧，其实关键是先把真实过程讲清楚。\n\n我记录一次真实过程，说明问题、证据和可执行步骤。\n\n最后给出方法和复盘建议，帮助读者完成下一步行动。', platform: '抖音', opening_ref: opening, source_refs: [{ type: 'topic', id: 4 }], fact_check_status: 'needs_review', variant_group_id: 'group-1', checks: {} }

// 阶段 4.3：定点替换原来只收语言层命中，人设/质量里能定位的标记捞不到，
// 界面上标了「能单独改」却改不动。这里验证它们真的进了替换清单。
test('定点替换的清单收人设/质量里能定位的标记，不收全篇级和档案级的', () => {
  const draft = {
    version: 3,
    body: '我亲自复盘了整个过程。第一，稳赚不赔。',
    checks: {
      persona: {
        draft_version: 3,
        evidence: [
          { code: 'prohibited_pattern', message: '命中档案表达边界：稳赚不赔', scope: 'locatable', quote: '稳赚不赔' },
          { code: 'low_personal_signal', message: '正文缺少明显的个人经历或第一人称信号', scope: 'whole_body', quote: '' },
          { code: 'missing_role', message: 'IP 档案缺少角色定位', scope: 'elsewhere', quote: '' },
        ],
      },
      quality: {
        draft_version: 3,
        evidence: [
          { code: 'risk_words', message: '正文命中风险表达：100% 保证', scope: 'locatable', quote: '100% 保证' },
          { code: 'structure_weak', message: '正文长度或段落结构仍需加强', scope: 'whole_body', quote: '' },
        ],
      },
    },
  }
  const scan = { evidence: [{ code: 'ai_tone_phrase', message: '咨询腔', quote: '其实高频迭代才是长期主义。' }] }
  const markable = markableIssues(draft, scan)
  const codes = markable.map(item => item.code)
  assert.ok(codes.includes('ai_tone_phrase'), '语言层命中照旧要收')
  assert.ok(codes.includes('prohibited_pattern'), '人设里能定位的要收进来')
  assert.ok(codes.includes('risk_words'), '质量里能定位的要收进来')
  // 全篇级和档案级收进来只会让模型瞎改一句：它没有哪一处可改。
  assert.equal(codes.includes('low_personal_signal'), false, '全篇级的不许收')
  assert.equal(codes.includes('missing_role'), false, '档案级的不许收')
  assert.equal(codes.includes('structure_weak'), false, '全篇级的不许收')
  // 每条都得带得出原句，否则模型不知道该改哪一句。
  assert.ok(markable.every(item => item.quote), '收进来的每条都要有原句')

  // 检查是做在旧版本上的：版本对不上就不该拿来改现在的正文。
  assert.deepEqual(markableIssues({ ...draft, version: 4 }, { evidence: [] }), [], '版本对不上的标记不许进清单')
  // 检查还没做过时，只有语言层命中能进来。
  assert.deepEqual(markableIssues({ version: 3, body: draft.body }, scan).map(item => item.code), ['ai_tone_phrase'])
  // 同一个位置上的两条规则归成一条：稳赚不赔 既是档案禁忌又是风险词（两份检查都列了它），
  // 但只能改一次——改两遍第二遍就找不到原句了。去重后该条只留先登记的那份（人设先查）。
  const sameSpot = markableIssues({
    ...draft,
    checks: {
      persona: { draft_version: 3, evidence: [{ code: 'prohibited_pattern', message: '档案禁忌', scope: 'locatable', quote: '稳赚不赔' }] },
      quality: { draft_version: 3, evidence: [{ code: 'risk_words', message: '风险词', scope: 'locatable', quote: '稳赚不赔' }] },
    },
  }, { evidence: [] })
  assert.equal(sameSpot.length, 1, `同一处只该留一条，实际留了 ${sameSpot.length} 条`)
  assert.equal(sameSpot[0].code, 'prohibited_pattern')
})

test('persona check warns without blocking and quality returns bounded dimensions', () => {
  const persona = checkPersona(baseDraft, { role: '', audiences: [], pillars: [], prohibited_patterns: [] })
  assert.equal(persona.status, 'warning')
  assert.ok(persona.score >= 0 && persona.score <= 100)
  const quality = checkQuality(baseDraft, { audiences: [], pillars: [], viewpoints: [], problems: [] })
  assert.equal(quality.status, 'passed')
  assert.deepEqual(Object.keys(quality.dimensions), ['opening_clarity', 'audience_fit', 'core_point', 'evidence', 'structure_and_risk'])
  assert.ok(Object.values(quality.dimensions).every(score => score >= 0 && score <= 100))
})

// 阶段 4「标记式改稿」的地基：每个标记得能回答「该去哪改」。
// 不分类就直接挂「改这一处」，会出现「正文缺少个人经历信号」后面跟一个按钮的情况——
// 但那是「缺了什么」，根本没有哪一处可改。
test('每个诊断标记都带 scope，只有可定位的才带 quote', () => {
  const fullProfile = { role: '创业教练', audiences: ['想副业的人'], pillars: ['真实复盘'], prohibited_patterns: ['稳赚不赔'] }
  const riskyBody = fillTo('我亲自复盘了整个过程。第一，稳赚不赔。', 300)
  const riskBody = fillTo('我亲自复盘了整个过程。第一，100% 保证有效。', 300)
  const cases = [
    ['persona-空档案', checkPersona(baseDraft, { role: '', audiences: [], pillars: [], prohibited_patterns: [] })],
    ['quality-基础', checkQuality(baseDraft, { audiences: [], pillars: [], viewpoints: [], problems: [] })],
    ['persona-命中禁忌', checkPersona({ ...baseDraft, body: riskyBody }, fullProfile)],
    ['quality-命中风险词', checkQuality({ ...baseDraft, body: riskBody }, fullProfile)],
  ]
  const scopes = { locatable: 0, whole_body: 0, elsewhere: 0 }
  const seen = []
  for (const [where, checked] of cases) {
    for (const item of issueItems(checked)) {
      seen.push(`${where}/${item.code}=${item.scope}`)
      assert.ok(['locatable', 'whole_body', 'elsewhere'].includes(item.scope), `${where} 的 ${item.code} 没给 scope`)
      scopes[item.scope] += 1
      // 说能「改这一处」的，就必须真指得出是哪一处，否则界面高亮不了。
      if (item.scope === 'locatable') assert.ok(item.quote, `${item.code} 说可以逐处改，却没给出原句`)
      // 反过来，不当成可定位的就不能声称有单一位置。
      // （quote 本身可以留着——诊断报告用它展示原文引用，那是另一回事。）
      if (item.scope !== 'locatable' && item.position !== undefined) assert.equal(item.position, -1, `${item.code} 是 ${item.scope}，却给了正文位置`)
    }
  }
  // 三类都必须真实存在：哪类空了就说明分类错了或登记表过期了。
  assert.ok(scopes.locatable > 0, `没有任何可定位的标记：${seen.join(' | ')}`)
  assert.ok(scopes.whole_body > 0, `没有任何全篇级标记：${seen.join(' | ')}`)
  assert.ok(scopes.elsewhere > 0, `没有任何「去别处改」的标记：${seen.join(' | ')}`)

  // 命中的词要能定位到正文，才能真的把那一句换掉。
  const prohibited = issueItems(checkPersona({ ...baseDraft, body: riskyBody }, fullProfile)).find(item => item.code === 'prohibited_pattern')
  assert.equal(prohibited.quote, '稳赚不赔', '命中档案边界的词要作为原句带出来')
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
  const evidence = issueItems(question).find(item => item.code === 'opening_question')
  assert.ok(evidence, '首句是问句必须留下证据')
  assert.equal(evidence.severity, 'warning')
  assert.match(evidence.message, /你是不是经常面对空白的文档/)
  assert.match(evidence.label, /第一句/)
  assert.equal(question.status, 'passed', '设问开头不应直接拦停发布')

  const statement = checkQuality({ ...baseDraft, body: '很多人以为这件事靠技巧，其实是先把过程讲清楚。' }, {})
  assert.equal(issueItems(statement).some(item => item.code === 'opening_question'), false)
  // 问句出现在第二句不算开头问题
  const later = checkQuality({ ...baseDraft, body: '先给结论：这件事靠过程。那为什么大家都做不到？' }, {})
  assert.equal(issueItems(later).some(item => item.code === 'opening_question'), false)
  // 口播稿开头是镜头提示行时，要看下一行而不是把镜头提示当成句子
  const afterDirection = checkQuality({ ...baseDraft, body: '（镜头怼脸，语速快）\n你以为灵感枯竭是因为没东西写？\n\n其实是因为没素材库。' }, {})
  const directionEvidence = issueItems(afterDirection).find(item => item.code === 'opening_question')
  assert.ok(directionEvidence, '镜头提示行之后的问句仍要能被发现')
  assert.match(directionEvidence.message, /你以为灵感枯竭是因为没东西写？$/)
  assert.doesNotMatch(directionEvidence.message, /镜头怼脸/)
  // 首行只有镜头提示、下一行是结论时不应误报
  const clean = checkQuality({ ...baseDraft, body: '（镜头平稳，语速中等）\n别再做灵感奴隶了。\n\n具体怎么做。' }, {})
  assert.equal(issueItems(clean).some(item => item.code === 'opening_question'), false)
  // 标题行与「正文：」结构标签不算开头第一句
  const titled = checkQuality({ ...baseDraft, body: '标题：灵感枯竭？那是你没建素材库\n正文：\n别急着怪自己没灵感，先看你的素材库。' }, {})
  assert.equal(issueItems(titled).some(item => item.code === 'opening_question'), false)
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
  const evidence = issueItems(intro).find(item => item.code === 'self_intro')
  assert.ok(evidence, '自我介绍必须留下证据')
  assert.equal(evidence.severity, 'warning')
  assert.match(evidence.message, /我是Agnes/)
  assert.match(evidence.message, /关注我/)
  // Requirement 13 第 3 条：自介降为提醒，不再进 evidence、不再是闸门。
  assert.equal(intro.evidence.some(item => item.code === 'self_intro'), false, '自介不再进 evidence')
  assert.ok(intro.reminders.some(item => item.code === 'self_intro'), '降级后进 reminders')
  // 降级不能把改写指令一起丢掉，否则「按检查意见改写」修不了自介。
  const note = draftCheckRewriteNote({ ...baseDraft, checks: { quality: { draft_version: 2, status: 'failed', evidence: [], reminders: intro.reminders } } })
  assert.match(note, /删掉自我介绍/, '降级后改写指令仍要给得出改法')

  const named = checkQuality({ ...baseDraft, body: '我叫小李，做了三年内容。\n先说结论：素材得拆开用。' }, {})
  assert.match(issueItems(named).find(item => item.code === 'self_intro').message, /我叫小李/)

  // 不能误伤正常句式
  // 不能误伤正常句式：用摊平后的命中列表判，只查 evidence 会因为自介已移出而假绿。
  const normal = checkQuality({ ...baseDraft, body: '我是做个人IP咨询的，先给结论：内容是系统的产物。\n今天记录一次真实复盘。' }, {})
  assert.equal(issueItems(normal).some(item => item.code === 'self_intro'), false)
  const clean = checkQuality({ ...baseDraft, body: '很多人以为这件事靠技巧，其实是先把过程讲清楚。' }, {})
  assert.equal(issueItems(clean).some(item => item.code === 'self_intro'), false)
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
  const evidence = issueItems(invented).find(item => item.code === 'case_claim')
  assert.ok(evidence, '编造的客户案例必须留下证据')
  assert.equal(evidence.severity, 'warning')
  assert.match(evidence.message, /提到了具体的人，还带着结果数字/, '理由要说成人话（2026-10-13 实测：界面把内部标签「案例人物+结果数字｜」直接给用户看了）')
  assert.match(evidence.message, /我有个客户/)
  assert.match(evidence.quote, /^我有个客户/, '引用就是那一句原文，不拼标签')
  assert.doesNotMatch(evidence.message, /｜/, '用户可见文案里不许出现内部分隔符')
  // case_claim 对不上 dbs-ai-check 的任何一条特征，所以只有名字、没有追问：不硬配。
  assert.match(evidence.label, /来路不明/)
  assert.equal(evidence.followup, '', '对不上特征就不给追问')

  const vendor = checkQuality({ ...baseDraft, body: '上个月，一位做本地家政的老板，提炼出一个核心观点：干净不是扫出来的，是收纳出来的。' }, {})
  assert.match(issueItems(vendor).find(item => item.code === 'case_claim').message, /提到了具体的人/)
  const numberOnly = checkQuality({ ...baseDraft, body: '- 案例：某本地老板转型三个月，因定位模糊，流量归零。' }, {})
  assert.match(issueItems(numberOnly).find(item => item.code === 'case_claim').message, /带着结果数字/)

  // 不能误伤：通用判断、单纯反问客户、真实时间描述
  const judgement = checkQuality({ ...baseDraft, body: '定位不清的内容都是无效自晒。先想清楚你卖给谁，再决定写什么。' }, {})
  assert.equal(issueItems(judgement).some(item => item.code === 'case_claim'), false)
  const question = checkQuality({ ...baseDraft, body: '一个反问：你确定你的客户，真的知道你卖什么吗？' }, {})
  assert.equal(issueItems(question).some(item => item.code === 'case_claim'), false)
  const timeline = checkQuality({ ...baseDraft, body: '上周把这个选题拆成了三条内容，具体怎么拆的下面说。' }, {})
  assert.equal(issueItems(timeline).some(item => item.code === 'case_claim'), false)
})

test('真模型实测绕过词表的两种写法，现在要能挑出来', () => {
  // 2026-09-20 真模型在「无素材」条件下生成的原文：
  // 「我身边有个创业者，情绪极敏感，做内容三天打鱼两天晒网。」
  // 旧词表里人物前缀只有「我有个」，人物词只到「创始人」，这句从两道口子中间穿过去了。
  const founderBySide = checkQuality({ ...baseDraft, body: '我身边有个创业者，情绪极敏感，做内容三天打鱼两天晒网。' }, {})
  const bySide = issueItems(founderBySide).find(item => item.code === 'case_claim')
  assert.ok(bySide, '「我身边有个创业者」是人物前缀 + 人物词：必须留下证据')
  assert.match(bySide.quote, /我身边有个创业者/, '引用指向原句')
  assert.match(bySide.message, /创业者/)

  // 人物前缀「有个」单独也认（「有个同行」这类写法）。
  const peer = checkQuality({ ...baseDraft, body: '有个同行上个月把账号停更了两周。' }, {})
  assert.match(issueItems(peer).find(item => item.code === 'case_claim').message, /提到了具体的人/)

  // 不能因为新加的前缀就误伤作者自己的经历：第一人称不算「来路不明的案例」。
  const own = checkQuality({ ...baseDraft, body: '我以前的内耗，就是总想着感觉对了再动，后来我把这种内耗硬改成了生产力。' }, {})
  assert.equal(issueItems(own).some(item => item.code === 'case_claim'), false)
})

test('编经历：自己的经历数量要拿出来让人确认', () => {
  // 审计 25.6 的尾巴：「复盘过多少账号、改了几遍」这类经历数量两条旧规则都抳不住——
  // 不可溯源数字闸门只认两位数以上或带单位的数字（个位数是故意放过的），
  // case_claim 认的是案例人物与结果数字。于是「我复盘过 5 个账号」无人拦、无人提。
  const reviewed = checkQuality({ ...baseDraft, body: '我复盘过 5 个账号，发现一个共同点：开头都在解释背景。' }, {})
  const reviewedHit = issueItems(reviewed).find(item => item.code === 'experience_claim')
  assert.ok(reviewedHit, '「复盘过 5 个账号」必须被挑出来')
  assert.equal(reviewedHit.severity, 'warning', '只提醒，不拦停')
  assert.match(reviewedHit.message, /你自己做过多少/, '理由要说成人话，不是「经历数量」这种内部说法')
  assert.match(reviewedHit.message, /复盘过/)

  // 经历动作 + 量词，没有名词也认（「改了 8 遍」）。
  const rewrites = checkQuality({ ...baseDraft, body: '这条稿子我改了 8 遍，最后才把开场那句删了。' }, {})
  assert.ok(issueItems(rewrites).some(item => item.code === 'experience_claim'), '「改了 8 遍」必须被挑出来')

  // 中文数字与估值写法照旧得认：不补这两条，把数字写成汉字、写成「几十」就能绕过。
  const chinese = checkQuality({ ...baseDraft, body: '我带过三届学员，最难的从来不是选题。' }, {})
  assert.ok(issueItems(chinese).some(item => item.code === 'experience_claim'), '中文数字也要认')
  const vague = checkQuality({ ...baseDraft, body: '我复盘了几十个账号，问题都出在同一处。' }, {})
  assert.ok(issueItems(vague).some(item => item.code === 'experience_claim'), '「几十」这类估值也要认')

  // 审计里记下的两条真实原文（当时因为「词表拓下去会变噪声」而挂着）：
  const auditedOne = checkQuality({ ...baseDraft, body: '我们复盘过大量IP账号，发现能持续更新的都有同一个习惯。' }, {})
  assert.ok(issueItems(auditedOne).some(item => item.code === 'experience_claim'), '「复盘过大量IP账号」（审计原文）要能挑出来')
  const auditedTwo = checkQuality({ ...baseDraft, body: '这一条文案改四遍，最后只留了开头那句。' }, {})
  assert.ok(issueItems(auditedTwo).some(item => item.code === 'experience_claim'), '「文案改四遍」（审计原文）要能挑出来')

  // 不能误伤：通用建议、结构说明、没有数量的经历。
  const advice = checkQuality({ ...baseDraft, body: '先发 3 个账号试试，看哪个方向的数据更好。' }, {})
  assert.equal(issueItems(advice).some(item => item.code === 'experience_claim'), false, '没有第一人称的通用建议不算你的经历')
  const structure = checkQuality({ ...baseDraft, body: '把这条内容拆成 3 个部分，每部分只讲一件事。' }, {})
  assert.equal(issueItems(structure).some(item => item.code === 'experience_claim'), false, '结构说明不算经历')
  const adviceTwice = checkQuality({ ...baseDraft, body: '如果你也卡在这里，就把开场删了重写两次试试。' }, {})
  assert.equal(issueItems(adviceTwice).some(item => item.code === 'experience_claim'), false, '叫读者去做的动作不算你的经历')
  const noCount = checkQuality({ ...baseDraft, body: '我复盘过这个账号，问题就出在开头。' }, {})
  assert.equal(issueItems(noCount).some(item => item.code === 'experience_claim'), false, '没有数量就不是数量声明')

  // 同一句话只报一次：「我有个客户，改了 8 遍」归 case_claim，不归两条。
  const both = checkQuality({ ...baseDraft, body: '我有个客户，一条稿子改了 8 遍才过。' }, {})
  assert.ok(issueItems(both).some(item => item.code === 'case_claim'), '案例那条照旧要报')
  assert.equal(issueItems(both).some(item => item.code === 'experience_claim'), false, '同一句话不重复报')
})

test('「第一反应」不是极限词；「全网第一」仍然是', () => {
  // 2026-09-20 真模型实测：正文里的「看到爆款，第一反应不是拆逻辑」
  // 被当成广告法极限词「第一」，质量门整条判 blocked、工作流进 needs_revision——一篇正常稿子被挡在发布链路外。
  const reaction = checkQuality({ ...baseDraft, body: '看到爆款，第一反应不是拆逻辑，是这句话好戳我。' }, {})
  assert.equal(issueItems(reaction).some(item => item.code === 'risk_words'), false, '「第一反应」不是主张')
  assert.notEqual(reaction.status, 'blocked')

  // 列表用法照旧放过（这个从第一版就排除了）。
  const listed = checkQuality({ ...baseDraft, body: '第一，这个点能发哪个平台？第二，能改几个版本？第三，有没有反常识？' }, {})
  assert.equal(issueItems(listed).some(item => item.code === 'risk_words'), false)

  // 真主张不能被一起放过：带前缀的和裸用的都要留着。
  assert.deepEqual(prohibitedHits('我们是全网第一的内容团队').map(item => item.word), ['第一'])
  assert.deepEqual(prohibitedHits('这个定位方法在同行里是第一').map(item => item.word), ['第一'])
  assert.deepEqual(prohibitedHits('他第一时间就到了').map(item => item.word), [], '「第一时间」也是固定词')
  assert.deepEqual(prohibitedHits('第一印象很关键').map(item => item.word), [], '「第一印象」也是固定词')
})

test('质量门把咨询腔和工程词标出来', () => {
  const jargon = checkQuality({ ...baseDraft, body: '把复杂概念拆解成小白能听懂的颗粒度。先用钩子抓住注意力，这就是可复制机制。' }, {})
  const evidence = issueItems(jargon).find(item => item.code === 'consulting_tone')
  assert.ok(evidence, '工程词必须留下证据')
  assert.equal(evidence.severity, 'warning')
  assert.match(evidence.message, /颗粒度/)
  assert.match(evidence.message, /钩子/)
  assert.match(evidence.followup, /你嘴上会怎么说/)

  const lecture = checkQuality({ ...baseDraft, body: '首先，灵感不重要。其次，系统才重要。总而言之，你要沉淀资产。' }, {})
  assert.match(issueItems(lecture).find(item => item.code === 'consulting_tone').message, /首先/)

  const normal = checkQuality({ ...baseDraft, body: '很多人以为这件事靠技巧，其实是先把过程讲清楚。定位不清就先别拍。' }, {})
  assert.equal(issueItems(normal).some(item => item.code === 'consulting_tone'), false)
})

test('提示词里的字数与确定性检查用的是同一套数字', () => {
  const prompt = draftBriefPrompt({})
  // 平台收敛后提示词只写抖音和视频号；两平台共用同一套长度目标，提示词里的数字仍取自 draftLengthTargets。
  assert.match(prompt, new RegExp(`${draftLengthTargets.抖音.min}-${draftLengthTargets.抖音.max} 字`))
  assert.equal(draftLengthTargets.视频号.min, draftLengthTargets.抖音.min)
  assert.equal(draftLengthTargets.视频号.max, draftLengthTargets.抖音.max)
})

test('生成验收扫咨询腔、编客户、设问开头和两平台同一篇', () => {
  const sermon = '很多人做IP内容评估，靠的是拍完后的感觉。钱是唯一诚实的反馈。我有个客户花了三天写文案，结果数据惨淡。把内容拆到颗粒度再评估。'.repeat(2)
  const bad = scanGeneratedBodies({ 小红书: sermon, 抖音: `你是不是觉得做IP最难？${sermon}`, 视频号: sermon, 公众号: sermon })
  assert.equal(bad.failed, true)
  assert.ok(bad.same_essay.length)
  assert.ok(bad.issues['视频号'].some(item => item.code === 'consulting_tone'))
  assert.ok(bad.issues['视频号'].some(item => item.code === 'case_claim'))
  assert.ok(bad.issues['抖音'].some(item => item.code === 'opening_question'))

  const clean = scanGeneratedBodies({
    小红书: fillTo('昨天改选题，发现发完就等数据的人最多。先看这条解决哪个场面。你现在看的是点赞还是询盘。', draftLengthTargets.小红书.min),
    抖音: fillTo('点赞会撒谎，询盘不会。别再为流量写，为成交写。问怎么买才算有效。', draftLengthTargets.抖音.min),
    视频号: fillTo('泛泛而谈找路人。讲具体场面才找得着人。私域不是朋友圈展示柜。', draftLengthTargets.视频号.min),
    公众号: fillTo('上周我把内容当了一次实验，看有没有人来问下一步。没有就换角度，有就放大。', draftLengthTargets.公众号.min),
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
  assert.ok(issueItems(mixup).some(item => item.code === 'method_talk'))
  assert.equal(mixup.status, 'passed', '写作问题只给警告，不拦停质量门')

  // 自己平台的名字不算串台；「分三步走」这类正常叙事不算方法骨架。
  const clean = checkQuality({ ...baseDraft, platform: '抖音', body: '这条只在抖音发。改选题分三步走：先看数据，再找场面，最后给判断。' }, {})
  assert.equal(clean.evidence.some(item => item.code === 'platform_mixup'), false)
  assert.equal(issueItems(clean).some(item => item.code === 'method_talk'), false)
})

test('去 AI 化判据拦住升华句、无主体案例和全篇通用判断', () => {
  const vague = '第一，踩过的坑。第二，反常识的判断。第三，具体案例。素材原子化，不是让你变成流水线工人，而是让你从重复劳动中解放出来。某某人每天只做一件小事，五年后复利极高。真正的长期主义其实是高频迭代。把内容当作品会自嗨，当成能力展示会没人看。讲得越清楚转发的人越多，观众不欠你注意力。'
  const quality = checkQuality({ ...baseDraft, platform: '抖音', body: vague }, {})
  for (const code of ['ai_tone_phrase', 'vague_case', 'no_concrete_support']) {
    assert.ok(issueItems(quality).some(item => item.code === code), `质量门缺 ${code}`)
  }
  const gate = scanGeneratedBodies({ 抖音: vague })
  assert.ok(gate.issues.抖音.some(item => item.code === 'ai_tone_phrase'))
  assert.ok(gate.issues.抖音.some(item => item.code === 'vague_case'))
  assert.ok(gate.issues.抖音.some(item => item.code === 'no_concrete_support'))

  const concrete = '上周三改选题，我把最近一条数据好的稿子摊开看，评论区问价的人里同行不少。所以这一拍我直接讲报价怎么算，不讲怎么涨粉。'
  const clean = checkQuality({ ...baseDraft, platform: '抖音', body: concrete }, {})
  const codes = ['ai_tone_phrase', 'vague_case', 'no_concrete_support']
  assert.equal(issueItems(clean).some(item => codes.includes(item.code)), false)
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
    assert.ok(issueItems(quality).some(item => item.code === code), `${code} 没命中：${body}`)
    const gate = scanGeneratedBodies({ 抖音: body.repeat(6) })
    assert.ok(gate.issues.抖音.some(item => item.code === code), `${code} 没进生成验收：${body}`)
  }
  const concreteList = '选题、拍摄、剪辑这三件事我各花了一周。上周三改到第四版才发出去。'.repeat(5)
  const clean = checkQuality({ ...baseDraft, platform: '抖音', body: concreteList }, {})
  assert.equal(issueItems(clean).some(item => ['triple_list', 'connector_abuse'].includes(item.code)), false)
})

test('同一问题只给一条建议：人设检查和质量门都报升华句也只写一遍', () => {
  // 语言层命中一个 code 一条放在 reminders 里，改写指令也一句一个 code。
  const toneHint = '把升华句、段尾金句和万能收尾换成具体的人和事：谁、在什么场合、发生了什么'
  const draft = {
    ...baseDraft,
    platform: '抖音',
    body: '正文内容足够长。'.repeat(20),
    version: 3,
    checks: {
      persona: { draft_version: 3, status: 'failed', reminders: [{ code: 'ai_tone_phrase', label: '「不是 X 是 Y」高密度', message: '正文出现升华式句式：不是A而是B' }] },
      quality: { draft_version: 3, status: 'failed', reminders: [{ code: 'ai_tone_phrase', label: '「不是 X 是 Y」高密度', message: '正文出现升华式句式：不是A而是B' }, { code: 'vague_case', label: '虚假的「讲个故事」', message: '正文出现没有主体的案例：某某人' }] },
    },
  }
  const note = draftCheckRewriteNote(draft)
  assert.equal(note.split(toneHint).length - 1, 1, '升华句只该出现一次')
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

