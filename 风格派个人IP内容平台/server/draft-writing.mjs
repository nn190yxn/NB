// 草稿正文由大模型撰写：这里只负责组装写作简报、构造指令、解析模型返回，方便单独测试。
// 简报里必须分开三件事：style 是创作者本人的表达习惯；mechanisms 是对标账号可照用的机制；quotes 是对标原话（只能当引用且要标来源）。

export const draftPlatforms = ['小红书', '抖音', '视频号', '公众号']

// 四个平台各自的体裁规划。默认仍一次出四条：小红书图文笔记、抖音短视频口播、视频号短视频口播、公众号长文。
// 抖音还有中视频（约 1–5 分钟）和长视频（5 分钟以上），这条默认草稿不是逐字长稿。
export const draftPlatformPlans = {
  小红书: {
    format: '图文笔记',
    title_max: 20,
    length: { min: 400, max: 1000 },
    form: '图文笔记：先写一个具体场面，中间用短条把判断摊开（每条是一句完整的话，不要「一、二、三」），结尾留一句能让人评论的话。正文不超过 1000 字，标题不超过 20 字。不要写成公众号长文。',
  },
  抖音: {
    format: '短视频口播',
    title_max: 30,
    length: { min: 300, max: 900 },
form: '短视频口播（约 1–3 分钟）：短句，能对着镜头一口气念完。冲突开场，中间一个场面或判断，收一句能做的动作。把一件事讲清楚比卡时长重要，但不要写成公众号长文。',
  },
  视频号: {
    format: '短视频口播',
    title_max: 30,
    length: { min: 300, max: 900 },
    form: '短视频口播：观点起头，一个能立住的判断，收明确结论。给微信熟人看，不要写成文章节选，也不要写成抖音同款冲突密度。',
  },
  公众号: {
    format: '长文',
    title_max: 64,
    length: { min: 1000, max: 2500 },
    form: '分段长文：现象、拆开、方法、收束。每段仍是说话，不是论文。长论证只写在公众号。',
  },
}

// 四个平台不能同一篇改字数。写手指令，不用「钩子 / 清单体」这类会抄进正文的词。
export const draftPlatformForms = Object.fromEntries(
  Object.entries(draftPlatformPlans).map(([platform, plan]) => [platform, plan.form]),
)

// 平台长度目标：提示词与发布前检查共用这一份，避免两处数字各说各话。
// 修改这里的数字后，draft-writing.test.mjs 会让提示词文案不同步这件事直接挂掉。
// 咨询腔 / 工程词：提示词、去 AI 感、质量门共用这一份。
// 不要把产品内部用语（钩子、语义块、颗粒度）写给读者看。
export const consultingToneWords = [
  '赋能', '闭环', '抓手', '颗粒度', '底层逻辑', '升维',
  '语义块', '语义单位', '确定性资产',
  '战术上的勤奋', '战略上的懒惰',
  '钩子公式', '节奏配比', '可复制机制', '钩子',
  '首先', '其次', '再次', '总而言之', '综上所述',
  '值得注意的是', '在当今社会',
]

export const draftLengthTargets = Object.fromEntries(
  Object.entries(draftPlatformPlans).map(([platform, plan]) => [platform, plan.length]),
)
export const draftVideoPlatforms = ['抖音', '视频号']
export const draftVideoFormats = {
  短视频: {
    duration: '约1-3分钟',
    length: { min: 300, max: 900 },
form: '短视频口播（约 1–3 分钟）：短句，能对着镜头一口气念完。冲突开场，中间一个场面或判断，收一句能做的动作。把一件事讲清楚比卡时长重要。',
  },
  中视频: {
    duration: '1-5分钟',
    length: { min: 400, max: 1000 },
    form: '中视频口播提纲（1–5 分钟）：按场次写，能分段对着镜头念。开场冲突，中间两三个场面或判断，收可执行动作。不要写成 15 秒短视频，也不要写成公众号。',
  },
  长视频: {
    duration: '5分钟以上',
    length: { min: 600, max: 1500 },
    form: '长视频大纲（5 分钟以上）：按段落写拍摄提纲，不要逐字口播。每段写清要讲的判断和镜头动作。不要写成公众号长文。',
  },
}
export function draftFormatOf(draft) {
  const platform = draft?.platform
  const raw = String(draft?.content_format || draft?.generation_context?.content_format || '').trim()
  if (draftVideoPlatforms.includes(platform)) {
    if (raw === '中视频' || raw === '长视频' || raw === '短视频') return raw
    return '短视频'
  }
  if (platform === '小红书') return '图文笔记'
  if (platform === '公众号') return '长文'
  return raw
}
export function draftLengthRangeFrom(target) {
  if (!target) return ''
  return target.min ? `${target.min}-${target.max}` : `不超过 ${target.max}`
}
export function draftLengthTargetFor(platform, format) {
  if (format && draftVideoFormats[format] && draftVideoPlatforms.includes(platform)) return draftVideoFormats[format].length
  return draftLengthTargets[platform]
}

export function draftLengthRange(platform, format) {
  return draftLengthRangeFrom(draftLengthTargetFor(platform, format))
}
export function draftLengthTargetOf(draft) {
  const format = draftFormatOf(draft)
  if (draftVideoPlatforms.includes(draft?.platform) && draftVideoFormats[format]) return draftVideoFormats[format].length
  return draftLengthTargets[draft?.platform] || null
}
export function draftPlatformFormOf(platform, format) {
  if (draftVideoPlatforms.includes(platform) && draftVideoFormats[format]) return draftVideoFormats[format].form
  return draftPlatformForms[platform] || draftPlatformForms.小红书
}
export function defaultContentFormat(platform) {
  if (draftVideoPlatforms.includes(platform)) return '短视频'
  if (platform === '小红书') return '图文笔记'
  if (platform === '公众号') return '长文'
  return ''
}

// 确认做默认不带 structure_id。空结构时用这四拍，避免模型自己发明说明书体。
// 用写手能执行的句子，不用「钩子 / 公式 / 骨架」这类会泄漏进正文的词。
export const defaultDraftStructure = [
  '开场：一句能单独听懂的判断或冲突，把话题带进来，不自我介绍',
  '主体：先说大家常怎么做、为什么不行，再用简报里已有的经历或现象把判断立住；没有案例就不编',
  '方法：只给一个现在就能做的动作或判断标准',
  '收束：把开头那句判断再说清楚，或留一个值得争论的问题；不求关注',
]

export function buildDraftBrief({ topic, structure, quotes, experiences, memories, mechanisms, hookText }) {
  const librarySteps = Array.isArray(structure?.steps) ? structure.steps.map(step => String(step)).filter(Boolean) : []
  const usingLibrary = librarySteps.length > 0
  return {
    title: String(topic?.title || '').trim(),
    strategy_layer: String(topic?.strategy_layer || 'trust'),
    hook: String(hookText || '').trim(),
    structure: usingLibrary ? librarySteps : [...defaultDraftStructure],
    structure_source: usingLibrary ? 'library' : 'default',
    quotes: (quotes || []).map(item => ({ text: String(item.content || ''), source: String(item.name || '') })).filter(item => item.text),
    experiences: (experiences || []).map(item => String(item.content || '')).filter(Boolean),
    style: (memories || []).map(item => String(item.content || '')).filter(Boolean),
    mechanisms: (mechanisms || []).map(item => ({ content: String(item.content || ''), source: String(item.source_label || '对标账号') })).filter(item => item.content),
    platforms: draftPlatforms,
    platform_forms: draftPlatformForms,
  }
}

export function draftBriefPrompt(profile = {}) {
  const profileFacts = [
    profile.role ? `身份：${profile.role}` : '',
    profile.audiences?.length ? `受众：${profile.audiences.join('、')}` : '',
    profile.pillars?.length ? `内容支柱：${profile.pillars.join('、')}` : '',
    profile.problems?.length ? `受众问题：${profile.problems.join('、')}` : '',
  ].filter(Boolean).join('；')
  return [
    '你是个人 IP 的文案写手。根据写作简报，为每个平台写一条可以直接拍摄或发布的完整正文（不是提纲，不要写"请补充"之类的占位）。',
    '读者是普通人，不是同事。像跟一个熟人说话：短句、有停顿、有态度。',
    `禁止咨询腔和工程词：${consultingToneWords.join('、')}。也不要把简报里的英文字段名、公式名写进正文。`,
    '不要写成名词解释（「什么是X」），不要「一、二、三」说明书，不要排比收成「你不是A，你是B」。',
    '不要「不是A而是B」「不仅仅是A，更是B」「与其说A，不如说B」「真正的X，是Y」这类升华句；不要用「某某人」「有个人」这种没有主体的例子。',
    '正文至少要有一个具体的场面、人、数字或时间；整篇都是通用判断、没有一个具体细节的稿子不合格。',
    '按 structure 的顺序写。步骤只决定段落顺序，不要把步骤原文、编号、方法名抄进正文。',
    '开头第一句直给冲突或结论，必须是完整口播句：含话题，能脱离标题单独听懂；不要自问自答。',
    '主体先驳后立：先点破常见做法，再立判断；连续抽象别超过一小段。简报里有经历、数字就用，没有就讲通用现象。',
    '结尾给可执行的一步或一个明确判断。',
    '四个平台必须是四种读感，不能同一篇改字数。按 platform_forms 写：小红书是图文笔记，抖音和视频号是短视频口播，公众号才是分段长文。',
    `长度：小红书图文笔记 ${draftLengthRange('小红书')} 字（平台正文上限 1000 字，标题不超过 20 字，长文去公众号）；抖音和视频号默认短视频口播（${draftVideoFormats.短视频.duration}，${draftLengthRange('抖音')} 字），把一件事讲清楚比卡时长重要；公众号才是长文 ${draftLengthRange('公众号')} 字且分段短。`,
    '只使用简报里的事实和素材，不编造成绩、客户、数字或案例；「具体支撑」只能用简报里的素材或你确知的真实经历，简报里没有案例时改用通用现象或判断说明，宁可少一个案例也不编造。不要写「我有个客户」「服务了无数」。',
    '不要写自我介绍、不要报名字或称呼（例如「大家好，我是某某」），也不要写引导关注、点赞一类话术；直接进入内容。',
    '正文是纯文本：不要写 Markdown 标记（如 # 标题、** 加粗）或结构占位说明（如「1个痛点场景」「1个客户案例（名字+数据）」），也不要在一条草稿里写其他平台的建议；正文只写给读者看的内容。',
    '简报字段的边界不能混：style 是创作者本人的表达习惯，必须遵守。',
    'mechanisms 是对标账号的可复制机制：只用来安排段落顺序和开头方式，不要把机制、钩子、公式、骨架这些词写进给读者看的正文，也不能写成“这是创作者本人的习惯”。',
    'quotes 是对标账号的原话：只能当引用用，而且必须在正文里写出 source 字段给的来源（例如「对标dbs」）；不得把对方原话改写成创作者本人说过的话。',
    'mechanisms 与 quotes 为空时，不要提对标、也不要虚构对标来源。',
    profileFacts ? `IP 档案：${profileFacts}。` : '',
    '只输出 JSON，不要解释：{"master":"母版正文","小红书":"...","抖音":"...","视频号":"...","公众号":"..."}。四个平台键都必须有正文。',
  ].filter(Boolean).join('\n')
}

export function draftDeaiPrompt() {
  return [
    '你是去 AI 味的文案改写助手。',
    '改成真人会发出去的口吻：像跟一个熟人说话，短句、有停顿、有态度。',
    `删掉咨询腔和工程词：${consultingToneWords.join('、')}。`,
    '拆掉排比、名词解释、「一、二、三」说明书，以及「你不是A，你是B」这种收束。',
    '不要编新客户、新数字。保留原有事实和判断。只输出改写后的正文，不要任何解释。',
  ].join('')
}

export function draftGateRewritePrompt(summary) {
  return [
    '上一稿没过验收，必须按原因重写四个平台。不要解释。',
    `验收未过：${String(summary || '').trim() || '咨询腔、编客户、设问开头或四平台同一篇'}。`,
    '四个平台必须是四种读感，不能同一篇改字数。小红书是图文笔记且不超过 1000 字，抖音和视频号是短视频口播，公众号才是分段长文。',
    '开头第一句直给冲突或结论，不要自问自答。',
    `删掉咨询腔和工程词：${consultingToneWords.join('、')}。不要编客户和数字。不要自我介绍。`,
    '只输出 JSON：{"master":"母版正文","小红书":"...","抖音":"...","视频号":"...","公众号":"..."}。',
  ].join('\n')
}

export function draftPlatformRevisePrompt(platform, format, extra = {}) {
  const resolved = draftFormatOf({ platform, content_format: format })
  const form = draftPlatformFormOf(platform, resolved)
  const range = draftLengthRange(platform, resolved)
  return [
    `只重写这一条${platform}草稿。不要动其他平台。不要解释。`,
    `体裁：${resolved}。${form}`,
    range ? `长度：${range} 字。` : '',
    '开头第一句直给冲突或结论，不要自问自答。',
    `删掉咨询腔和工程词：${consultingToneWords.join('、')}。不要编客户和数字。`,
    extra.fromChecks
      ? '必须按修改意见逐条改。不要只压短，不要另写一篇更简单的。保留原判断和事实。只输出正文，不要 JSON，不要标题。'
      : '必须按修改意见改。只输出正文，不要 JSON，不要标题。',
  ].filter(Boolean).join('\n')
}

export function draftReviseUserMessage({ title, body, note, fromChecks = false, previous = '', issues = '' } = {}) {
  const lines = []
  if (fromChecks) {
    lines.push('必须逐条改掉下面的意见。不要只压短，不要另写一篇更简单的。保留原有判断和事实。')
    for (const item of String(note || '').split(/[；\n]/).map(value => value.trim()).filter(Boolean)) lines.push(`- ${item}`)
  } else {
    lines.push(`必须按修改意见改：${String(note || '').trim()}`)
  }
  if (title) lines.push(`当前标题：${title}`)
  lines.push('当前正文：')
  lines.push(String(body || '').slice(0, 3000))
  if (previous) {
    lines.push('上一稿：')
    lines.push(String(previous).slice(0, 3000))
  }
  if (issues) lines.push(`上一稿没过验收：${issues}`)
  return lines.join('\n')
}

export function parseReviseBody(content) {
  const text = String(content || '').trim()
  const fenced = text.match(/```(?:\w+)?\s*([\s\S]*?)```/)
  const raw = String(fenced ? fenced[1] : text).trim()
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw)
      if (parsed && typeof parsed.body === 'string' && parsed.body.trim()) return parsed.body.trim()
    } catch { /* 按纯文本处理 */ }
  }
  if (!raw) throw new Error('改写结果为空')
  return raw
}

export function parseDraftBodies(content) {
  const matched = String(content || '').match(/\{[\s\S]*\}/)
  if (!matched) throw new Error('模型未返回 JSON')
  let parsed
  try { parsed = JSON.parse(matched[0]) } catch { throw new Error('模型返回的 JSON 无法解析') }
  const master = String(parsed.master || '').trim()
  if (!master) throw new Error('模型未返回母版正文')
  const bodies = {}
  for (const platform of draftPlatforms) bodies[platform] = String(parsed[platform] || '').trim() || master
  return bodies
}

// 定点替换：不让模型重写整篇，只让它给出「原文这句 → 改成这句」的对照表，系统校验后原位替换。
export function draftReplacePrompt({ platform, format, body, issues }) {
  const label = format ? `${platform}（${format}）` : platform
  return [
    `你在改一条${label}口播稿，只做定点替换，不重写整篇。`,
    '只输出 JSON，格式：{"pairs":[{"old":"原文里的一句","new":"改后的一句"}]}，不要任何解释。',
    'old 必须从原文里逐字复制，是一句完整的句子，不许改写、缩写、加省略号；原文里找不到的句子不要出现在结果里。',
    'new 要保持原意和原来的信息量，字数不能比 old 少，用口语，像跟熟人说话。',
    'new 里不要再出现升华句、总结句和书面连接词。',
    `最多给 ${Math.min((issues || []).length, 8)} 对替换，一条意见对应一对；改不了的那条就跳过，不要硬改。`,
    '原文：',
    body,
  ].join('\n')
}

export function parseReplacePairs(content) {
  const text = String(content || '').replace(/```[a-z]*/gi, '').replace(/```/g, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    const list = Array.isArray(parsed?.pairs) ? parsed.pairs : []
    return list
      .filter(item => item && typeof item === 'object')
      .map(item => ({ old: String(item.old || '').trim(), new: String(item.new || '').trim() }))
      .filter(item => item.old && item.new)
  } catch { return [] }
}

// 只认能确定落地的替换：原文里唯一存在、不是原样、不越改越短。
export function validateReplacePairs({ body, pairs }) {
  const text = String(body || '')
  const accepted = []
  const dropped = []
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    const old = String(pair?.old || '').trim()
    const next = String(pair?.new || '').trim()
    if (!old || !next) continue
    if (text.split(old).length - 1 !== 1) { dropped.push({ ...pair, reason: '原文里找不到这一句，或不止一处' }); continue }
    if (next === old) { dropped.push({ ...pair, reason: '改完和原文一样' }); continue }
    if (next.length < Math.round(old.length * 0.8)) { dropped.push({ ...pair, reason: '改完比原文短太多' }); continue }
    if (accepted.some(item => item.old === old)) { dropped.push({ ...pair, reason: '同一句给了两条替换' }); continue }
    accepted.push({ old, new: next })
  }
  return { accepted, dropped }
}

export function applyReplacePairs(body, pairs) {
  return (Array.isArray(pairs) ? pairs : []).reduce((text, pair) => {
    const old = String(pair?.old || '')
    if (!old || !text.includes(old)) return text
    return text.split(old).join(String(pair.new || ''))
  }, String(body || ''))
}
