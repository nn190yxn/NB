import { prohibitedHits } from './redfox.mjs'
import { validateSourceRefs } from './validation.mjs'
import { openingReadiness } from './draft-workflow.mjs'
import { consultingToneWords, draftFormatOf, draftLengthRangeFrom, draftLengthTargetFor, draftLengthTargetOf, draftPlatforms } from './draft-writing.mjs'

const riskWordHits = value => prohibitedHits(value).map(item => item.word)
const qualityKeys = ['opening_clarity', 'audience_fit', 'core_point', 'evidence', 'structure_and_risk']

function text(value) { return String(value || '').replace(/\s+/g, ' ').trim() }
function list(value) { return Array.isArray(value) ? value.map(text).filter(Boolean) : [] }
function hitsFor(value, words) { const body = text(value); return words.filter(word => body.includes(word)) }
function evidenceItem(code, message, severity = 'warning') { return { code, message, severity } }
function result(status, { score = null, dimensions = {}, evidence = [], suggestions = [], reminders = [], draftVersion = 1 } = {}) {
  return { status, score, dimensions, evidence, suggestions, reminders, draft_version: draftVersion, checked_at: new Date().toISOString() }
}
function sourceCount(draft) { return Array.isArray(draft?.source_refs) ? draft.source_refs.length : 0 }
function currentVersion(draft) { return Number(draft?.version || 1) }
// 取「开头第一句」：跳过镜头提示行与「标题：」「正文：」这类结构行，再去掉行首的（…）提示，按句末标点截断。
function openingSentence(body) {
  for (const rawLine of String(body || '').split('\n')) {
    const line = rawLine.trim().replace(/^[（(][^）)]*[）)]\s*/, '')
    if (!line || /^(#{1,6}\s*|标题[:：]|正文[:：])/.test(line) || /^[^，。！？；]{1,6}[:：]$/.test(line)) continue
    const matched = line.match(/[^。！？；]*[。！？；]/)
    if (matched && matched[0].trim()) return matched[0].trim()
  }
  return ''
}

// 自我介绍与引导关注：实测模型会把自己服务商的名字当成创作者（「大家好，我是Agnes」），这条同样是提示词拦不住的。
// 只抓确定能判的模式：大家好、我是 + 英文名、我叫 + 中文名、关注我。不猜中文混合句，避免误伤「我是做个人IP的」。
function selfIntroHits(body) {
  const value = String(body || '')
  const patterns = [/大家好/, /我是([A-Za-z][A-Za-z0-9]{1,11})/, /我叫[\u4e00-\u9fa5A-Za-z]{2,6}/, /关注我/]
  return [...new Set(patterns.map(pattern => value.match(pattern)).filter(Boolean).map(matched => matched[0]))]
}

// 结构骨架与标记泄漏：实测模型会把结构槽位的步骤、占位说明、甚至其他平台的标题建议写进正文。
// 这些都不是给读者看的内容，只抓能确定判的行：Markdown 标题与加粗、「N 个…」占位、「（名字+数据）」类说明、其他平台的列表项。
const otherPlatformWords = ['抖音', '小红书', '视频号', '公众号', 'B站', '快手', '微博', '知乎']

// 串台：正文里出现其他平台名。实测模型会写「同一内核，抖音发 15 秒快节奏，小红书发带细节图文，
// 视频号发深度对话」——读者拿到的是分发说明，不是内容。自己平台的名字不算。
function platformMixupHits(body, platform) {
  const value = text(body)
  const own = text(platform)
  return otherPlatformWords.filter(word => word !== own && value.includes(word))
}

// 讲方法：正文在交代「怎么拆、怎么分发、怎么裂变」，而不是给读者一件事。
// 只收能确定判的骨架词，正常叙事里的「分三步」不会被判（要求紧跟数量词才命中）。
const methodTalkPatterns = [/裂变/, /一鱼多吃/, /同一内核/, /多平台(分发|复制|发布|复用)/, /一套内容.{0,8}(多平台|复制|分发)/, /(拆成|分成)[0-9一二三四五六七八九十两]+[块部分条]/]

function methodTalkHits(body) {
  const value = text(body)
  return [...new Set(methodTalkPatterns.map(pattern => value.match(pattern)).filter(Boolean).map(matched => matched[0]))]
}

function formatLeakHits(body) {
  const hits = []
  for (const rawLine of String(body || '').split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^#{1,6}\s/.test(line)) hits.push(`Markdown 标题「${line.slice(0, 18)}」`)
    else if (/\*\*[^*]+\*\*/.test(line)) hits.push(`Markdown 加粗「${line.slice(0, 18)}」`)
    else if (/^[-*]\s*\d+\s*个/.test(line) || /^\d+[.、]\s*(一个|1个)/.test(line)) hits.push(`结构占位「${line.slice(0, 18)}」`)
    else if (/[（(](名字\+数据|数据或现象|具体的人或事|可执行的一步)[）)]/.test(line)) hits.push(`占位说明「${line.slice(0, 22)}」`)
    else if (/^[-*]\s*(抖音|小红书|视频号|公众号)[:：]/.test(line)) hits.push(`其他平台建议「${line.slice(0, 18)}」`)
  }
  return [...new Set(hits)].slice(0, 4)
}

// 具体案例与数字：提示词自相矛盾过——一条要求「用具体经历、数字支撑」，一条禁止编造成绩与客户，
// 结果 12 条真实草稿 12 条都编出了客户案例（含「3个月涨粉2万」这类数字）。这里只把这类句子挑出来让人确认。
// 只要求人物词紧跟数量词（「一位做家政的老板」「我有个客户」「某本地老板」），不匹配「一个反问：…客户」。
function caseClaimHits(body) {
  const hits = []
  for (const rawLine of String(body || '').split(/[\n。！？]/)) {
    const line = rawLine.trim()
    if (!line) continue
    const person = /(我有个|有一个|有一位|有位|某|某位|一位|一个)(做[^，。]{0,8}的)?(老板|客户|学员|同行|朋友|宝妈|店长|创始人|阿姨)/.test(line)
    const number = /(涨粉|粉丝\d|翻了?\d|翻倍|多赚|省下|归零|成交额|复购率|\d+个月涨粉)/.test(line)
    if (person || number) hits.push(`${person ? '案例人物' : ''}${person && number ? '+' : ''}${number ? '结果数字' : ''}｜${line.slice(0, 40)}`)
  }
  return [...new Set(hits)].slice(0, 3)
}

export function checkPersona(draft, profile = {}) {
  const body = text(draft?.body)
  const audiences = list(profile.audiences)
  const pillars = list(profile.pillars)
  const prohibited = list(profile.prohibited_patterns)
  const evidence = []
  const suggestions = []
  const matchedAudience = audiences.find(value => body.includes(value))
  const matchedPillar = pillars.find(value => body.includes(value))
  const prohibitedHits = hitsFor(body, prohibited)
  if (!text(profile.role)) { evidence.push(evidenceItem('missing_role', 'IP 档案缺少角色定位')); suggestions.push('补充角色定位后重新检查') }
  if (!audiences.length) { evidence.push(evidenceItem('missing_audience', 'IP 档案尚未配置受众')); suggestions.push('补充目标受众') }
  if (audiences.length && !matchedAudience) {
    // 档案字段写成了整句时，正文永远不会原样出现这句，这条会一直命中；那是档案的问题，不该算正文不合格。
    if (profileMatchable(audiences)) { evidence.push(evidenceItem('audience_mismatch', '正文未明显对应当前受众')); suggestions.push('在正文中写出受众正在面对的具体问题') }
    else { const only = profileFirstOverlong(audiences); if (only) suggestions.push(profileOverlongHint(only)) }
  }
  if (pillars.length && !matchedPillar) {
    if (profileMatchable(pillars)) { evidence.push(evidenceItem('pillar_mismatch', '正文未明显对应内容支柱')); suggestions.push('补充一个与内容支柱直接相关的观点或案例') }
    else { const only = profileFirstOverlong(pillars); if (only) suggestions.push(profileOverlongHint(only)) }
  }
  if (prohibitedHits.length) { evidence.push(evidenceItem('prohibited_pattern', `命中档案表达边界：${prohibitedHits.join('、')}`)); suggestions.push('替换为符合个人表达边界的说法') }
  const firstPerson = /我|我的|我们|亲自|经历|复盘/.test(body)
  if (!firstPerson) { evidence.push(evidenceItem('low_personal_signal', '正文缺少明显的个人经历或第一人称信号')); suggestions.push('加入一个本人经历、过程或明确判断') }
  const score = Math.max(0, 100 - evidence.reduce((sum, item) => sum + (item.severity === 'warning' ? 15 : 10), 0))
  return result(evidence.length ? 'warning' : 'passed', { score, evidence, suggestions, draftVersion: currentVersion(draft) })
}

export function checkQuality(draft, profile = {}) {
  const body = text(draft?.body)
  // 段落判据必须用未折叠换行的原文：body 走过 text()，换行已被替成空格，
  // 再 split(/\n\s*\n/) 永远是 1 段 —— 实测 32 条真实草稿 100% 命中 structure_weak，这一维从来没得过 100 分。
  const rawBody = String(draft?.body || '').trim()
  const paragraphCount = rawBody.split(/\n\s*\n/).filter(part => part.trim()).length
  const openingReady = openingReadiness(draft)
  const sourceValid = validateSourceRefs(draft?.source_refs)
  const riskHits = riskWordHits(body)
  const audienceValues = list(profile.audiences)
  const pillarValues = [...list(profile.pillars), ...list(profile.viewpoints), ...list(profile.problems)]
  const audienceScore = audienceValues.length && audienceValues.some(value => body.includes(value)) ? 100 : audienceValues.length ? 50 : 40
  const pointScore = pillarValues.length && pillarValues.some(value => body.includes(value)) ? 100 : pillarValues.length ? 55 : 45
  // 口播稿本来就常常是一整段，不拿段落数要求它们；门槛跟当前平台的上限走，不再写死 250。
  const structureCap = Number(draftLengthTargetOf(draft)?.max || 250)
  const structureReady = rawBody.length >= 120 && (rawBody.length <= structureCap || paragraphCount >= 2)
  const structureScore = structureReady ? 100 : rawBody.length >= 60 ? 65 : 20
  const dimensions = {
    opening_clarity: openingReady ? 100 : 0,
    audience_fit: audienceScore,
    core_point: pointScore,
    evidence: sourceValid && sourceCount(draft) > 0 ? 100 : 0,
    structure_and_risk: riskHits.length ? 0 : structureScore,
  }
  const score = Math.round(qualityKeys.reduce((sum, key) => sum + dimensions[key], 0) / qualityKeys.length)
  const evidence = []
  const suggestions = []
  // 语言层提醒单独放：一次一条展示，不混进 evidence。
  let reminders = []
  if (!body) { evidence.push(evidenceItem('body_missing', '正文不能为空', 'blocked')); suggestions.push('补充正文内容') }
  if (!openingReady) { evidence.push(evidenceItem('opening_missing', '尚未用「开头句」槽位确定开头范式', 'blocked')); suggestions.push('点草稿的「开头句」槽位，从方法库选一个开头范式') }
  if (!sourceValid || sourceCount(draft) === 0) { evidence.push(evidenceItem('source_missing', '草稿缺少有效来源引用', 'blocked')); suggestions.push('补回选题、素材或方法来源') }
  if (riskHits.length) { evidence.push(evidenceItem('risk_words', `正文命中风险表达：${riskHits.join('、')}`, 'blocked')); suggestions.push('修改风险表达后重新检查') }
  if (body && structureScore < 100) { evidence.push(evidenceItem('structure_weak', '正文长度或段落结构仍需加强')); suggestions.push('补充真实过程、证据和可执行步骤') }
  // 受众/支柱的命中靠「正文里出现档案里的原话」。档案里写成了整句时（实测他现在的受众是 17 字整句），
  // 正文不可能原样出现，这条就永远命中（真实草稿 1/32）；把原因写进建议，别让人以为正文真有问题。
  const audienceOverlong = profileFirstOverlong(audienceValues)
  const pillarOverlong = profileFirstOverlong(pillarValues)
  if (audienceScore < 100) { if (profileMatchable(audienceValues)) { evidence.push(evidenceItem('audience_weak', '正文与当前受众问题的连接不够明确')); suggestions.push('在正文中写出受众正在面对的具体问题') } else if (audienceOverlong) suggestions.push(profileOverlongHint(audienceOverlong)) }
  if (pointScore < 100) { if (profileMatchable(pillarValues)) { evidence.push(evidenceItem('point_weak', '核心观点或内容支柱不够明确')); suggestions.push('用一句话写出你的判断，再用过程或案例支撑') } else if (pillarOverlong) suggestions.push(profileOverlongHint(pillarOverlong)) }
  // 模型并不遵守提示词里的字数要求（实测：提示词写抖音不超 250 字，模型给了 384 字），所以这里做确定性校验。
  const lengthTarget = draftLengthTargetOf(draft)
  const lengthRange = draftLengthRangeFrom(lengthTarget)
  const bodyLength = String(draft?.body || '').trim().length
  if (lengthTarget && bodyLength && (bodyLength < lengthTarget.min || bodyLength > lengthTarget.max)) {
    const format = draftFormatOf(draft)
    evidence.push(evidenceItem('platform_length', `正文 ${bodyLength} 字，${draft.platform}${format ? format : ''}目标${lengthRange} 字`))
    suggestions.push(`把正文调整到 ${lengthRange} 字`)
  }
  // 闸门项（自介 / 格式泄漏 / 串台 / 字数严重不足）留在 evidence 里，它们是客观项；
  // 语言层命中走 reminders，不混进 evidence——否则同一个问题会在面板上出现两次。
  const writing = writingIssues(draft)
  evidence.push(...writing.gate)
  suggestions.push(...writing.suggestions)
  reminders = writing.reminders
  const scoreBlocked = score < 60
  if (scoreBlocked) evidence.push(evidenceItem('score_low', '质量综合分低于 60 分', 'blocked'))
  const blocked = evidence.some(item => item.severity === 'blocked') || scoreBlocked
  return result(blocked ? 'blocked' : 'passed', { score, dimensions, evidence, suggestions, reminders, draftVersion: currentVersion(draft) })
}

export function checkPublishChecklist(draft) {
  const body = text(draft?.body)
  const riskHits = riskWordHits(body)
  const checks = {
    title: Boolean(text(draft?.title)),
    body: Boolean(body),
    platform: Boolean(text(draft?.platform)),
    source_refs: validateSourceRefs(draft?.source_refs) && sourceCount(draft) > 0,
    fact_check: draft?.fact_check_status === 'verified',
    opening: openingReadiness(draft),
    risk_free: riskHits.length === 0,
    variant_group: Boolean(draft?.variant_group_id || draft?.variant_type === 'legacy'),
  }
  const evidence = Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => evidenceItem(key, {
    title: '缺少标题', body: '正文不能为空', platform: '未指定目标平台', source_refs: '缺少有效来源引用', fact_check: '发布前必须完成事实核验', opening: '发布前必须用「开头句」槽位确定开头范式', risk_free: `存在风险表达：${riskHits.join('、')}`, variant_group: '缺少有效的平台版本组',
  }[key], 'blocked'))
  const suggestions = evidence.map(item => ({ source_refs: '补回来源引用', fact_check: '完成事实核验', opening: '用「开头句」槽位选一个开头范式', risk_free: '修改风险表达' }[item.code] || '补齐发布清单项'))
  const passed = Object.values(checks).filter(Boolean).length
  return result(evidence.length ? 'blocked' : 'passed', { score: Math.round(passed / Object.keys(checks).length * 100), dimensions: checks, evidence, suggestions, draftVersion: currentVersion(draft) })
}

export function hasBlockedCheck(draft) {
  return ['persona', 'quality', 'publish_checklist'].some(key => draft?.checks?.[key]?.status === 'blocked')
}

const profileMatchable = values => (values || []).some(value => text(value).length <= 12)
const profileFirstOverlong = values => (values || []).map(value => text(value)).find(value => value.length > 12)
const profileOverlongHint = value => `档案里的「${value}」有 ${text(value).length} 字，判据匹配不上，正文不算不合格；把它改成 2-8 字短词（例如「个人IP创业者」）`

const checkRewriteHints = {
  audience_mismatch: '写出受众正在面对的具体问题，用短词，不要抄档案整句',
  pillar_mismatch: '补一个跟内容支柱直接相关的判断，不要抄档案整句',
  prohibited_pattern: '去掉档案禁止的说法',
  low_personal_signal: '用第一人称讲一个本人经历或明确判断',
  risk_words: '去掉风险表达',
  structure_weak: '补真实过程和可执行的一步',
  audience_weak: '用短词写出受众正在面对的具体问题，不要抄档案整句',
  point_weak: '第一句给出判断，再用场面支撑',
  self_intro: '删掉自我介绍和引导关注',
  format_leak: '删掉结构说明和其他平台建议',
  platform_mixup: '把其他平台名和分发说明换成这一条自己的具体内容，不要删掉就完事',
  length_severe: '把正文补到目标字数，保留已有判断和可执行的一步，不要另写一篇',
  // 语言层（14 个 code）的改写指令统一在 reminderHints 里按 7 类各写一份，这里不再按 code 重复。
}

export function draftCheckRewriteNote(draft) {
  const version = currentVersion(draft)
  const hints = []
  const seen = new Set()
  for (const key of ['persona', 'quality']) {
    const item = draft?.checks?.[key]
    if (!item || Number(item.draft_version || 0) !== version) continue
    if (item.status === 'passed') continue
    for (const evidence of item.evidence || []) {
      if (seen.has(evidence.code)) continue
      seen.add(evidence.code)
      if (evidence.code === 'platform_length') {
        const range = draftLengthRangeFrom(draftLengthTargetOf(draft))
        if (range) hints.push(`把字数改到${range}，保留原判断和可执行的一步，不要另写一篇更简单的`)
        continue
      }
      const hint = checkRewriteHints[evidence.code]
      if (!hint) continue
      const detail = String(evidence.message || '').split('：').slice(1).join('：').trim()
      if (evidence.code === 'consulting_tone' && detail) hints.push(`${hint}。点名删掉：${detail}`)
      else if (evidence.code === 'opening_question' && detail) hints.push(`${hint}。现在第一句是：${detail}`)
      else if (evidence.code === 'case_claim' && detail) hints.push(`${hint}。原文里的：${detail}`)
      else hints.push(hint)
    }
    // 语言层提醒也要进改写指令，否则「按检查意见改写」修不了升调、咨询腔这类问题。
    for (const reminder of item.reminders || []) {
      const key = `reminder:${reminder.category}`
      if (seen.has(key) || !reminder.hint) continue
      seen.add(key)
      const detail = String(reminder.message || '').split('：').slice(1).join('：').trim()
      if ((reminder.category === 'consulting_tone' || reminder.category === 'unsourced_case') && detail) hints.push(`${reminder.hint}。点名原文：${detail}`)
      else hints.push(reminder.hint)
    }
  }
  return [...new Set(hints)].join('；')
}

// 「按意见改写」的结果护栏。
//
// 实测过的失败形态不是改错，而是把「按意见改」做成「删一遍」：字数砍一半、被点名的问题一个没少，
// 但提示词、写作验收、检查栏都看不见这件事（验收只看自介/编客户/咨询腔/格式，没有长度、也不和原稿比）。
// 所以这里只问两件能算清的事：有没有越改越短、被点名的问题有没有减少。文笔好坏不在这里判断。
const shorterRequestPattern = /再短|更短|短一点|短一些|压短|压到|压至|压缩|精简|缩减/

export function rewriteAsksForShorter(note) {
  return shorterRequestPattern.test(String(note || ''))
}

// 改正文能管的问题：与 draftCheckRewriteNote 可改的范围同口径，加上超平台上限。
// 开头句槽位、来源引用、档案短词不在此列——那几项改写改不了，要用户自己点。
function actionableIssueCodes({ body, platform }) {
  // 闸门 code 与提醒类别都要算进来：语言问题不拦生成，但用户点「按检查意见改写」时它们仍是可改项，
  // 少算会让 checkReviseOutcome 的「被点名的问题没减少」护栏失效。
  const issues = writingIssues({ body, platform })
  const codes = [...issues.gate.map(item => item.code), ...issues.reminders.map(item => item.category)]
  const max = Number(draftLengthTargetOf({ platform })?.max || 0)
  if (max && String(body || '').trim().length > max) codes.push('platform_length')
  return codes
}

export function checkReviseOutcome({ before, after, platform, format = '', note = '', requireImprove = false } = {}) {
  const failures = []
  const beforeText = String(before || '')
  const afterText = String(after || '')
  const target = draftLengthTargetFor(platform, format) || draftLengthTargetOf({ platform })
  const max = Number(target?.max || 0)
  const min = Number(target?.min || 0)
  // 用户自己要求变短（「再短一点」「压到 200 字」）时不设下限，否则就是不让他把稿子改短。
  if (!rewriteAsksForShorter(note)) {
    let floor = Math.round(beforeText.length * 0.85)
    if (max) floor = Math.min(floor, max)
    if (min) floor = Math.max(floor, Math.min(min, beforeText.length))
    if (afterText.length < floor) failures.push(`越改越短：原稿 ${beforeText.length} 字，新稿 ${afterText.length} 字，不得少于 ${floor} 字`)
  }
  if (requireImprove) {
    const beforeCodes = actionableIssueCodes({ body: beforeText, platform })
    if (beforeCodes.length) {
      const afterCodes = actionableIssueCodes({ body: afterText, platform })
      if (afterCodes.length >= beforeCodes.length) failures.push(`被点名的问题没减少：改写前 ${beforeCodes.length} 处（${beforeCodes.join('、')}），改写后 ${afterCodes.length} 处（${afterCodes.join('、')}）`)
    }
  }
  return { ok: failures.length === 0, failures }
}

// 生成入库前的硬门：提示词拦不住的那几条。不复用 checkQuality——那边会因还没选开头句、还没补来源直接 blocked。

// 去 AI 味：只认能一眼确认的形态，宁可漏也不误伤正常口语。
const aiTonePatterns = [
  /不是[^。！？\n]{1,20}而是/,
  /不仅仅是[^。！？\n]{1,20}(更是|而是)/,
  /与其说[^。！？\n]{1,20}不如说/,
  /真正的[^。！？\n]{0,12}是/,
]
const vagueCasePatterns = [/某某/, /某人/, /有个人/, /有个朋友/, /有位(朋友|学员|客户|同事)/]
const concreteSignalPatterns = [/[0-9０-９]/, /我/, /(昨天|今天|上周|上个月|去年|当时|那天|前几天)/, /(客户|学员|同事|评论区|私信|直播|现场|后台|群里)/]

function aiToneHits(body) {
  const text = String(body || '')
  return aiTonePatterns.map(pattern => text.match(pattern)?.[0]).filter(Boolean).map(hit => hit.slice(0, 14))
}

function vagueCaseHits(body) {
  const text = String(body || '')
  return vagueCasePatterns.map(pattern => text.match(pattern)?.[0]).filter(Boolean)
}

// 句子级 AI 模板句：每条只认一眼能确认的形态，宁可漏也不误伤正常口语。
// 三连只认「两项以上是抽象词」的凑数式列举，「选题、拍摄、剪辑」这种具体清单不在此列。
const abstractTailChars = '力感性度化局系法观量'
const abstractWords = ['灵感', '洞察', '认知', '格局', '势能', '价值', '效率', '体验', '思维', '逻辑', '视野', '本质', '底层', '生态', '闭环']
const isAbstractItem = item => abstractTailChars.includes(item.at(-1)) || abstractWords.includes(item)

function tripleListHit(text) {
  const match = text.match(/([^。！？\n、，]{2,3})、([^。！？\n、，]{2,3})、([^。！？\n、，]{2,3})/)
  if (!match) return ''
  if (/[0-9０-９]/.test(match[0])) return ''
  const items = match.slice(1)
  return items.filter(isAbstractItem).length >= 2 ? match[0] : ''
}

const templateSentencePatterns = [
  ['golden_tail', /(?:其实|本质上|说到底|归根到底|归根结底)[^。！？\n]{0,12}(?:才是|就是)/],
  ['generic_ending', /未来可期|拭目以待|任重道远|前景广阔|前景光明|迈出了重要一步|值得期待/],
  ['ing_tail', /象征着|反映了|彰显了|体现了|折射出|印证了/],
  ['avoid_copula', /作为[^。！？\n]{0,10}(?:角色|身份)|拥有[^。！？\n]{0,8}(?:功能|能力|特质)|发挥了[^。！？\n]{0,8}作用|标志着/],
  ['fake_rebuttal', /有人可能会说|也许有人会说|可能会有人问|难道不是吗|一个诱人的做法/],
]
const connectorAbuseWords = ['首先', '其次', '此外', '综上所述', '值得注意的是', '换句话说', '更重要的是', '总而言之']

function templateSentenceHits(body) {
  const text = String(body || '')
  const hits = []
  const triple = tripleListHit(text)
  if (triple) hits.push(['triple_list', triple])
  for (const [code, pattern] of templateSentencePatterns) {
    const found = text.match(pattern)
    if (found) hits.push([code, found[0].slice(0, 14)])
  }
  // 单次「首先」不算滥用，口播里偶尔用一次是正常的。
  const connectors = connectorAbuseWords.filter(word => text.includes(word))
  const connectorCount = connectorAbuseWords.reduce((total, word) => total + text.split(word).length - 1, 0)
  if (connectors.length >= 2 || connectorCount >= 3) hits.push(['connector_abuse', connectors.join('、')])
  return hits
}

function lacksConcreteSupport(body) {
  const text = String(body || '')
  return text.length >= 120 && !concreteSignalPatterns.some(pattern => pattern.test(text))
}

// ── 判据分层 ────────────────────────────────────────────────────────────────
// 闸门：客观可判定，命中即拦停生成结果。封顶 5 条，加一条必须先删一条。
// 第 5 条 same_essay 在 scanGeneratedBodies 里判——它要看四篇正文，单篇判不了。
// 内容层（案例、数字是否真实）不在闸门里：系统没有事实来源，没资格判。
export const gateCodes = ['format_leak', 'platform_mixup', 'self_intro', 'length_severe']

// 语言层提醒：审美类，不拦停、不触发自动重写、不影响 workflow_status。
// 原 14 个 code 归并为 7 类，封顶 7 条，加一条必须先合并或删一条；
// 上限由 server/draft-checks.test.mjs 的一条断言盯着。
export const reminderCategories = [
  { category: 'tone_elevation', label: '升华句与金句收束', codes: ['ai_tone_phrase', 'golden_tail', 'ing_tail', 'avoid_copula', 'generic_ending'] },
  { category: 'template_filler', label: '凑数三连、假反驳、书面连接词', codes: ['triple_list', 'fake_rebuttal', 'connector_abuse'] },
  { category: 'unsourced_case', label: '没主体的案例、来路不明的数字', codes: ['vague_case', 'case_claim'] },
  { category: 'no_concrete_support', label: '整篇通用判断、没有落地', codes: ['no_concrete_support'] },
  { category: 'method_talk', label: '方法骨架 / 分发说明', codes: ['method_talk'] },
  { category: 'consulting_tone', label: '咨询腔与工程词', codes: ['consulting_tone'] },
  { category: 'opening_question', label: '开头第一句是问句', codes: ['opening_question'] },
]

const reminderCategoryOf = Object.fromEntries(reminderCategories.flatMap(group => group.codes.map(code => [code, group.category])))

// 每类只留一份措辞，给「按检查意见改写」当指令；不再按原 code 各写一句，避免同一个问题两种说法。
const reminderHints = {
  tone_elevation: '把升华句、段尾金句和万能收尾换成具体的人和事：谁、在什么场合、发生了什么',
  template_filler: '删掉凑数三连、没人提出的反驳和「首先 / 其次 / 此外」这类书面连接词，用口语顺序讲',
  unsourced_case: '把没有主体的例子和来路不明的数字换成你自己经历过的具体事，或直接删掉',
  no_concrete_support: '补一个具体场景、数字或时间，让整篇有一个能落地的地方',
  method_talk: '把「拆成几块 / 裂变 / 多平台分发」换成一件具体的经历或判断，字数不要因此变少',
  consulting_tone: '改成跟熟人说话，删掉咨询腔和工程词',
  opening_question: '第一句直给冲突或结论，不要问句',
}

function writingIssues(draft) {
  const hits = []
  const add = (code, message, suggestion = '') => hits.push({ code, category: reminderCategoryOf[code] || null, message, suggestion, severity: 'warning' })

  const introHits = selfIntroHits(draft?.body)
  if (introHits.length) add('self_intro', `正文出现自我介绍或引导关注：${introHits.join('、')}`, '删掉自我介绍与引导关注，改成直给结论的开头')
  const leakHits = formatLeakHits(draft?.body)
  if (leakHits.length) add('format_leak', `正文混入结构骨架或标记：${leakHits.join('、')}`, '删掉结构说明、占位符与其他平台建议，只留给读者看的正文')
  const aiToneList = aiToneHits(draft?.body)
  if (aiToneList.length) add('ai_tone_phrase', `正文出现升华式句式：${aiToneList.join('、')}`)
  const vagueList = vagueCaseHits(draft?.body)
  if (vagueList.length) add('vague_case', `正文出现没有主体的案例：${vagueList.join('、')}`)
  if (lacksConcreteSupport(draft?.body)) add('no_concrete_support', '正文没有具体场面、人、数字或时间，整篇是通用判断')
  for (const [code, hit] of templateSentenceHits(draft?.body)) add(code, `正文出现模板句：${hit}`)
  const mixupHits = platformMixupHits(draft?.body, draft?.platform)
  if (mixupHits.length) add('platform_mixup', `正文提到别的平台：${mixupHits.join('、')}`, '把其他平台名和分发说明换成这一条自己的具体内容，不要只删掉那句话')
  const methodHits = methodTalkHits(draft?.body)
  if (methodHits.length) add('method_talk', `正文在讲方法或分发骨架：${methodHits.join('、')}`)
  const caseHits = caseClaimHits(draft?.body)
  if (caseHits.length) add('case_claim', `正文出现具体案例或数字：${caseHits.join('、')}`)
  const toneHits = consultingToneWords.filter(word => String(draft?.body || '').includes(word)).slice(0, 6)
  if (toneHits.length) add('consulting_tone', `正文出现咨询腔或工程词：${toneHits.join('、')}`)
  const opening = openingSentence(draft?.body)
  if (opening && (opening.endsWith('？') || opening.endsWith('?'))) add('opening_question', `开头第一句是问句：${opening.length > 26 ? `${opening.slice(0, 26)}…` : opening}`)
  // 字数严重不足：低于目标下限的六成。没有下限的目标不判。
  const target = draftLengthTargetOf(draft)
  const min = Number(target?.min || 0)
  const bodyLength = String(draft?.body || '').trim().length
  if (min && bodyLength && bodyLength < Math.round(min * 0.6)) add('length_severe', `正文只有 ${bodyLength} 字，${draft?.platform || ''}目标下限 ${min} 字，不到六成`, `把正文补到 ${draftLengthRangeFrom(target)} 字，保留已有判断`)

  const gate = hits.filter(item => gateCodes.includes(item.code))
  const reminders = reminderCategories
    .map(group => {
      const items = hits.filter(item => item.category === group.category)
      if (!items.length) return null
      return { category: group.category, label: group.label, codes: items.map(item => item.code), message: items.map(item => item.message).join('；'), hint: reminderHints[group.category] }
    })
    .filter(Boolean)
  return { hits, gate, reminders, suggestions: gate.map(item => item.suggestion).filter(Boolean) }
}

function shingles(text, n = 3) {
  const value = String(text || '').replace(/\s+/g, '')
  if (value.length < n) return new Set(value ? [value] : [])
  const set = new Set()
  for (let index = 0; index <= value.length - n; index += 1) set.add(value.slice(index, index + n))
  return set
}

function jaccard(left, right) {
  const a = shingles(left)
  const b = shingles(right)
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const item of a) if (b.has(item)) inter += 1
  return inter / (a.size + b.size - inter)
}

function containment(left, right) {
  const a = shingles(left)
  const b = shingles(right)
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  if (!small.size) return 0
  let inter = 0
  for (const item of small) if (large.has(item)) inter += 1
  return inter / small.size
}

function sameEssayHits(bodies) {
  const hits = []
  for (let i = 0; i < draftPlatforms.length; i += 1) {
    for (let j = i + 1; j < draftPlatforms.length; j += 1) {
      const a = draftPlatforms[i]
      const b = draftPlatforms[j]
      const left = String(bodies?.[a] || '').replace(/\s+/g, '')
      const right = String(bodies?.[b] || '').replace(/\s+/g, '')
      if (!left || !right) continue
      if (left === right) {
        hits.push({ a, b, reason: 'identical' })
        continue
      }
      if (Math.min(left.length, right.length) < 80) continue
      const jac = jaccard(left, right)
      const con = containment(left, right)
      if (jac >= 0.42 || con >= 0.7) hits.push({ a, b, reason: jac >= 0.42 ? 'overlap' : 'containment' })
    }
  }
  return hits
}

// 只抓像数据声明的数字：两位数以上，或带 % 万 倍 元 块 单位的。
// 个位数的「一步」「三个动作」是最常见的修辞用法，抓了只会误伤。
const dataNumberPattern = /(\d+(?:\.\d+)?)\s*(%|％|万|倍|元|块)?/g

// 正文里出现的、像数据声明的数字。返回去重后的原样写法（带单位）。
export function draftNumbers(body) {
  const found = new Map()
  for (const match of String(body || '').matchAll(dataNumberPattern)) {
    if (!match[2] && match[1].replace(/\D/g, '').length < 2) continue
    found.set(match[1], match[2] ? `${match[1]}${match[2]}` : match[1])
  }
  return [...found.values()]
}

// 正文里素材和简报都没有的数字：只标记出来给人看，不拦停。
// 内容层唯一允许拦停的位置是选题把关（见 topic-evaluation.mjs），这里不能破例。
export function unbackedNumberHits(body, allowedText = '') {
  const allowed = new Set([...String(allowedText || '').matchAll(/\d+(?:\.\d+)?/g)].map(match => match[0]))
  return draftNumbers(body).filter(number => !allowed.has(number.replace(/[%％万倍元块]/g, '')))
}

// 生成阶段的拦停只看闸门：闸门 5 类（这里 4 类，same_essay 要看四篇）+ 四平台同一篇。
// 语言层命中（审美）不拦停，进 reminders 等用户点「检查」或「重写」时再说。
export function scanGeneratedBody(body, platform) {
  const issues = writingIssues({ body, platform })
  return {
    failed: issues.gate.length > 0,
    gate: issues.gate,
    reminders: issues.reminders,
    // evidence 是全部命中（含语言层），定点替换要按它找可改的句子。
    evidence: issues.hits,
    summary: issues.gate.map(item => item.message).join('；'),
  }
}

export function scanGeneratedBodies(bodies) {
  const issues = {}
  const reminders = {}
  for (const platform of draftPlatforms) {
    const result = writingIssues({ body: bodies?.[platform], platform })
    issues[platform] = result.hits
    reminders[platform] = result.reminders
  }
  const same_essay = sameEssayHits(bodies)
  const gateHits = draftPlatforms.flatMap(platform => (issues[platform] || [])
    .filter(item => gateCodes.includes(item.code))
    .map(item => `${platform}：${item.message}`))
  const failed = same_essay.length > 0 || gateHits.length > 0
  const summary = [
    ...same_essay.map(item => `四平台同一篇（${item.a}≈${item.b}）`),
    ...gateHits,
  ].slice(0, 8).join('；')
  return { failed, issues, reminders, same_essay, summary }
}

export { qualityKeys }
