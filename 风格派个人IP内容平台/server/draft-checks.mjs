import { prohibitedHits } from './redfox.mjs'
import { validateSourceRefs } from './validation.mjs'
import { openingReadiness } from './draft-workflow.mjs'
import { aiFeatureByCode } from './ai-features.mjs'
import { structureDimensions, structureReport } from './structure-flow.mjs'
import { consultingToneWords, draftFormatOf, draftLengthRangeFrom, draftLengthTargetFor, draftLengthTargetOf, draftPlatforms } from './draft-writing.mjs'

const riskWordHits = value => prohibitedHits(value).map(item => item.word)
const qualityKeys = ['opening_clarity', 'audience_fit', 'core_point', 'evidence', 'structure_and_risk']

function text(value) { return String(value || '').replace(/\s+/g, ' ').trim() }
function list(value) { return Array.isArray(value) ? value.map(text).filter(Boolean) : [] }
function hitsFor(value, words) { const body = text(value); return words.filter(word => body.includes(word)) }
// 阶段 4「标记式改稿」的地基：每个标记先得说清「该去哪改」。
// 不分清楚就动手，界面会给错按钮——比如「正文缺少个人经历信号」后面挂一个「改这一处」，
// 但它是「缺了什么」，根本没有哪一处可改。
//   locatable  —— 指向正文里的具体词句，可以「改这一处」（要带 quote）
//   whole_body —— 正文的问题，但错在缺了什么（缺信号、缺连接、太长），没有单一位置，只能补/删
//   elsewhere  —— 正文里改不动：要去 IP 档案、开头句槽位、来源引用那里补
const evidenceScopes = {
  // 人设检查
  missing_role: 'elsewhere',
  missing_audience: 'elsewhere',
  audience_mismatch: 'whole_body',
  pillar_mismatch: 'whole_body',
  prohibited_pattern: 'locatable',
  low_personal_signal: 'whole_body',
  // 质量检查
  body_missing: 'elsewhere',
  opening_missing: 'elsewhere',
  source_missing: 'elsewhere',
  risk_words: 'locatable',
  structure_weak: 'whole_body',
  audience_weak: 'whole_body',
  point_weak: 'whole_body',
  platform_length: 'whole_body',
}
// 新加标记时忘了登记就走这个：归到全篇级而不是可定位，宁可少给一个按钮，不给一个改不动的。
const defaultEvidenceScope = 'whole_body'
function evidenceItem(code, message, severity = 'warning', quote = '') {
  const scope = evidenceScopes[code] || defaultEvidenceScope
  return { code, message, severity, scope, quote: scope === 'locatable' ? quote : '' }
}
function result(status, { score = null, dimensions = {}, evidence = [], suggestions = [], reminders = [], draftVersion = 1 } = {}) {
  return { status, score, dimensions, evidence, suggestions, reminders, draft_version: draftVersion, checked_at: new Date().toISOString() }
}
function sourceCount(draft) { return Array.isArray(draft?.source_refs) ? draft.source_refs.length : 0 }
function currentVersion(draft) { return Number(draft?.version || 1) }
// 取「开头第一句」：跳过镜头提示行与「标题：」「正文：」这类结构行，再去掉行首的（…）提示，按句末标点截断。
// 导出给「选用开头顶案」用：替换开头时要以同一把尺子认第一句。
export function openingSentence(body) {
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
// 「有个」单独也算人物前缀（2026-09-20 真模型实测：「我身边有个创业者」绕过了「我有个」）。
// **每遇到一次真实编造绕过了这里，就把那个说法补进词表，并补一条断言**。
// 人物词与结果词抽成常量：下面「编经历」那条要用同一套词做去重，不能各写一份。
const casePersonPattern = /(我有个|有个|有一个|有一位|有位|某|某位|一位|一个)(做[^，。]{0,8}的)?(老板|客户|学员|同行|朋友|宝妈|店长|创始人|创业者|阿姨)/
const caseResultPattern = /(涨粉|粉丝\d|翻了?\d|翻倍|多赚|省下|归零|成交额|复购率|\d+个月涨粉)/

// 内部命中串是「标签｜句子」的形状（去重要按整串算），但不能就这样给用户看：
// 实测界面里出现过「正文出现自己的经历数量：第一人称经历｜我们常说……」这种把内部标签
// 和同一句原文重复两遍的文案。用户看到的东西必须是人话，所以这里拆成 reason 和 sentence。
const claimReasonLabels = {
  案例人物: '提到了具体的人',
  结果数字: '带着结果数字',
  '案例人物+结果数字': '提到了具体的人，还带着结果数字',
  经历动作: '说自己做过多少',
  重复次数: '说改过多少回',
  第一人称经历: '说自己经手过多少',
}

function splitClaimHit(hit) {
  const raw = String(hit || '')
  const index = raw.indexOf('｜')
  if (index < 0) return { reason: '', sentence: raw }
  return { reason: claimReasonLabels[raw.slice(0, index)] || '', sentence: raw.slice(index + 1) }
}

function claimSentences(hits) {
  return hits.map(hit => splitClaimHit(hit).sentence).filter(Boolean)
}

function caseClaimHits(body) {
  const hits = []
  for (const rawLine of String(body || '').split(/[\n。！？]/)) {
    const line = rawLine.trim()
    if (!line) continue
    const person = casePersonPattern.test(line)
    const number = caseResultPattern.test(line)
    if (person || number) hits.push(`${person ? '案例人物' : ''}${person && number ? '+' : ''}${number ? '结果数字' : ''}｜${line.slice(0, 40)}`)
  }
  return [...new Set(hits)].slice(0, 3)
}

// 编经历：数量 + 经历的说法。「我复盘过 5 个账号」「文案改四遍」「我们复盘过大量IP账号」（后两条是审计里的真实原文）。
// 为什么另起一条：上面两条都抳不住它——不可溯源数字闸门只认「两位数以上或带单位」的数字（个位数是故意放过的，
// 因为「三个动作」这类修辞太多），caseClaimHits 认的是案例人物与结果数字（涨粉、翻倍），经历数量不在它里面。
// 与那两条一样只提醒、不拦停：这是用户自己的历史，系统没有事实来源，只有本人能核。
//
// 词表要窄（审计的告警：拓宽了几乎每篇都命中），所以分三档，而不是「看到数字就报」：
//   一档：过去式经历动词 + 任何数量（复盘过/带了/改过/操盘过…）——「复盘过大量IP账号」就在这档。
//   二档：普通动作 + 「几次几遍」型量词（改四遍、拆三次）——「文案改四遍」在这档。
//   三档：第一人称 + 数量 + 经历名词（我 5 个账号）——「我每天写 3 条片子」在这档。
// 反面不能误伤：「先发 3 个账号试试」（没有第一人称、也没有过去式动词，是通用建议）不许报。
const experienceVerbs = ['复盘过', '复盘了', '带过', '带了', '做过', '写过', '改过', '改了', '服务过', '陪跑过', '操盘过', '跑过', '教过', '培训过', '经手过']
const actionVerbs = ['改', '写', '做', '拆', '拍', '剪', '发', '跑', '带', '教', '复盘', '看']
const experienceNouns = ['账号', '学员', '客户', '门店', '店铺', '项目', '稿子', '脚本', '片子', '作品', '直播间', '会员', '公司', '品牌', '团队', '选题', '样本', '同行']
// 「几次几遍」型量词：说的是「我做过多少回」，基本不是修辞。
const timesUnits = '遍次轮场届'
// 「多少个东西」型量词：光有它不够，得配第一人称或经历名词。
const thingUnits = '个位条篇份家款套周月年'
const chineseNumber = '[一二两三四五六七八九十]{1,3}'
const vagueQuantity = '(?:大量|无数|很多|不少|若干|一批|一堆|十几|几十|几百|上千|数[十百千万])'
const experienceCount = new RegExp(`(\\d{1,2}|${chineseNumber}|几)[\\s]*([${timesUnits}${thingUnits}])`, 'g')
const vagueCount = new RegExp(vagueQuantity)

function experienceClaimHits(body) {
  const hits = []
  for (const rawLine of String(body || '').split(/[\n。！？]/)) {
    const line = rawLine.trim()
    if (!line) continue
    // 同一句话已经在「案例」那条里报过，这里不重复报（「我有个客户，改了 8 遍」只报一次）。
    if (casePersonPattern.test(line) || caseResultPattern.test(line)) continue
    // 一句话里可能有好几个数量（「这一条文案改四遍」），只要有一个是「几次几遍」型就算数，
    // 所以得全扫，不能只取第一个匹配——取第一个会把「一条」当成结论。
    const counts = [...line.matchAll(experienceCount)]
    const vague = vagueCount.test(line)
    const verb = experienceVerbs.find(word => line.includes(word))
    const action = actionVerbs.find(word => line.includes(word))
    const noun = experienceNouns.find(word => line.includes(word))
    const firstPerson = /我|自己/.test(line)
    const times = counts.some(match => timesUnits.includes(match[2]))
    // 全句只在跟读者说话（有「你」、没有「我」）：那是叫读者去做，不是作者的经历。
    // 不拦这一刀的话，「把开场删了重写两次试试」会被当成编经历。
    const readerOnly = /你|您/.test(line) && !firstPerson
    if (readerOnly) continue
    if (verb && (counts.length || vague)) hits.push(`经历动作｜${line.slice(0, 40)}`)
    else if (times && action) hits.push(`重复次数｜${line.slice(0, 40)}`)
    else if (firstPerson && (counts.length || vague) && (noun || times)) hits.push(`第一人称经历｜${line.slice(0, 40)}`)
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
  if (prohibitedHits.length) { evidence.push(evidenceItem('prohibited_pattern', `命中档案表达边界：${prohibitedHits.join('、')}`, 'warning', prohibitedHits[0])); suggestions.push('替换为符合个人表达边界的说法') }
  const firstPerson = /我|我的|我们|亲自|经历|复盘/.test(body)
  if (!firstPerson) { evidence.push(evidenceItem('low_personal_signal', '正文缺少明显的个人经历或第一人称信号')); suggestions.push('加入一个本人经历、过程或明确判断') }
  const score = Math.max(0, 100 - evidence.reduce((sum, item) => sum + (item.severity === 'warning' ? 15 : 10), 0))
  return result(evidence.length ? 'warning' : 'passed', { score, evidence, suggestions, draftVersion: currentVersion(draft) })
}

export function checkQuality(draft, profile = {}, options = {}) {
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
  // 角色约定（README 第 0 节）：判断性判据不设卡，只作为可改项。
  // 没选开头范式、缺来源引用、综合分低，都是「我的看法」，不是「你做不到」。
  if (!openingReady) { evidence.push(evidenceItem('opening_missing', '尚未用「开头句」槽位确定开头范式')); suggestions.push('点草稿的「开头句」槽位，从方法库选一个开头范式') }
  if (!sourceValid || sourceCount(draft) === 0) { evidence.push(evidenceItem('source_missing', '草稿缺少有效来源引用')); suggestions.push('补回选题、素材或方法来源；自己心里有数也可以不补') }
  if (riskHits.length) { evidence.push(evidenceItem('risk_words', `正文命中风险表达：${riskHits.join('、')}`, 'blocked', riskHits[0])); suggestions.push('修改风险表达后重新检查') }
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
  // 闸门项（格式泄漏 / 串台）留在 evidence 里，它们是客观项；
  // 语言层命中走 reminders，不混进 evidence——否则同一个问题会在面板上出现两次。
  // self_intro 与 length_severe 降级后也走 reminders，但仍是可改项。
  const writing = writingIssues(draft)
  evidence.push(...writing.gate)
  suggestions.push(...writing.suggestions)
  // Requirement 17 第 4 条：已在回流里被用户偏好替换掉的特征，不再按通用特征提醒。
  // 只作用于语言层；结构层闸门（格式泄漏、串台）不受影响。
  const replacedFeatureIds = options.replacedFeatureIds
  reminders = replacedFeatureIds && replacedFeatureIds.size
    ? writing.reminders.filter(item => { const feature = featureForCode(item.code); return !(feature && replacedFeatureIds.has(Number(feature.id))) })
    : writing.reminders
  // 综合分是判断，不是事实：低分只作为可改项，不封堵。
  if (score < 60) evidence.push(evidenceItem('score_low', '质量综合分低于 60 分'))
  const blocked = evidence.some(item => item.severity === 'blocked')
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
  // 语言层（14 个 code）的改写指令统一在 languageFixes 里一句一个 code，这里不再重复。
}

export function draftCheckRewriteNote(draft) {
  const version = currentVersion(draft)
  const hints = []
  const seen = new Set()
  for (const key of ['persona', 'quality']) {
    const item = draft?.checks?.[key]
    if (!item || Number(item.draft_version || 0) !== version) continue
    // 不看整体状态：状态是「整体过没过」，而 evidence 里还挂着字数、语言层这类可改项。
    // 以前只在未通过时才抽指令，于是「整体通过但字数超了」时，改写指令里反而没有字数要求。
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
      const key = `reminder:${reminder.code}`
      if (seen.has(key)) continue
      seen.add(key)
      const fix = languageFixes[reminder.code]
      if (!fix) continue
      const detail = String(reminder.message || '').split('：').slice(1).join('：').trim()
      if ((reminder.code === 'consulting_tone' || reminder.code === 'vague_case' || reminder.code === 'case_claim' || reminder.code === 'experience_claim') && detail) hints.push(`${fix}。点名原文：${detail}`)
      else hints.push(fix)
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
  const codes = [...issues.gate.map(item => item.code), ...issues.reminders.map(item => item.code)]
  const max = Number(draftLengthTargetOf({ platform })?.max || 0)
  if (max && String(body || '').trim().length > max) codes.push('platform_length')
  return codes
}

// 改写结果的判定分两档，因为这两件事性质不同：
//   failures —— 稿子被弄坏了（越改越短）。这种必须拒收，用户的正文不能拿来赌。
//   warnings —— 「被点名的问题没减少」。以前它也是拒收，结果是：用户举的真实案例（case_claim 这类提醒）
//     本来就该留着，于是「按检查意见改写」永远改不进去，看起来就是按钮没反应；
//     而要让它通过，最省力的做法反而是把案例删掉——护栏在奖励删内容。改成照改、如实报。
export function checkReviseOutcome({ before, after, platform, format = '', note = '', requireImprove = false } = {}) {
  const failures = []
  const warnings = []
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
      if (afterCodes.length >= beforeCodes.length) warnings.push(`被点名的问题没减少：改写前 ${beforeCodes.length} 处（${beforeCodes.join('、')}），改写后 ${afterCodes.length} 处（${afterCodes.join('、')}）`)
    }
  }
  return { ok: failures.length === 0, improved: warnings.length === 0, failures, warnings }
}

// 生成入库前的硬门：提示词拦不住的那几条。不复用 checkQuality——那边会因还没选开头句、还没补来源直接 blocked。

// 语言层特征识别：只认能一眼确认的形态，宁可漏也不误伤正常口语。
const aiTonePatterns = [
  /不是[^。！？\n]{1,20}而是/,
  /不仅仅是[^。！？\n]{1,20}(更是|而是)/,
  /与其说[^。！？\n]{1,20}不如说/,
  /真正的[^。！？\n]{0,12}是/,
]
// 「不是 X，是 Y」的短式：口播稿几乎都省掉「而」，上面那条 /不是…而是/ 认不出来。
// 但这一式人类作者也高频用，源技能的误伤警告写着「一次是正常修辞」（鲁迅、李敖、罗翔都用），
// 所以这里只收集，够不够密度由调用方判。
const flipShortPattern = /不是[^。！？\n]{1,20}[，,]\s*是[^。！？\n]{1,20}/g
// 源技能给的阈值是「800 字内 3 次以上」。长文按同一密度换算，避免 3000 字的文章出现 3 次就被误报。
const flipDensityThreshold = body => Math.max(3, Math.ceil(String(body || '').length / 800 * 3))
const vagueCasePatterns = [/某某/, /某人/, /有个人/, /有个朋友/, /有位(朋友|学员|客户|同事)/]
const concreteSignalPatterns = [/[0-9０-９]/, /我/, /(昨天|今天|上周|上个月|去年|当时|那天|前几天)/, /(客户|学员|同事|评论区|私信|直播|现场|后台|群里)/]

function aiToneHits(body) {
  const text = String(body || '')
  return aiTonePatterns.map(pattern => text.match(pattern)?.[0]).filter(Boolean).map(hit => hit.slice(0, 14))
}

function flipShortHits(body) {
  return [...String(body || '').matchAll(flipShortPattern)].map(match => match[0].slice(0, 16))
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

// 源技能特征 4：同一个让步模板走三遍。只认「虽然/尽管/…但是」这种一眼能数清的形态。
function concessionHits(body) {
  return String(body || '').match(/(?:虽然|尽管|固然|不可否认|不得不承认|诚然)[^。！？\n]{0,30}(?:但是|可是|然而|却)/g) || []
}

// 源技能特征 5 误伤表：同一句式 2 次以上才算起名仪式，用一次是正常修辞。
function namingRitualHit(body) {
  const text = String(body || '')
  const patterns = [/我称之为/g, /我把这(?:个|件事|一套|一招)?叫做/g, /我给它起了个名字/g, /称之为[「"]/g]
  for (const pattern of patterns) {
    const found = text.match(pattern) || []
    if (found.length >= 2) return found[0]
  }
  return ''
}

// 源技能特征 10 点名的形态：「1.7 秒」「2.3 秒」。整数秒不判。
function fakePreciseEmotionHit(body) {
  return String(body || '').match(/\d+\.\d+\s*秒/)?.[0] || ''
}

// 源技能特征 15 点名的收束：「身体知道答案」。身体不舒服这类身体状态不判。
function bodyFeelingHit(body) {
  return String(body || '').match(/身体(?:知道|记得|告诉我)(?:答案|对的|怎么做|该怎么)?/)?.[0] || ''
}

// 源技能特征 22：出现「本质上 / 归根结底」且后面接更大号命题。实操总结不判。
function profundityHit(body) {
  return String(body || '').match(/(?:本质上|归根结底|归根到底)[^。！？\n]{0,30}(?:意义|人生|人性|命运|存在|哲学|宇宙|终极)/)?.[0] || ''
}

// 源技能特征 1：堵住所有反驳。自媒体适用。一条稻草人是特征 7；两条以上预判反驳才算「全堵上」。
function blockAllRebuttalsHit(body) {
  const text = String(body || '')
  const cues = ['你可能会说', '你可能会觉得', '你是不是觉得', '有人会反驳', '我知道你要问', '常见的质疑', '无论你怎么', '别急着反驳', '也许你会说']
  const found = cues.filter(cue => text.includes(cue))
  return found.length >= 2 ? found[0] : ''
}

// 源技能特征 2：知识全部输出。三条以上术语标签才算堆，用一次框架不判。
function dumpAllKnowledgeHit(body) {
  const text = String(body || '')
  const terms = ['心智模型', '方法论', 'SOP', '模型', '框架', '理论', '体系', '范式']
  const found = []
  for (const term of terms) {
    if (!text.includes(term)) continue
    if (found.some(item => item.includes(term) || term.includes(item))) continue
    found.push(term)
  }
  return found.length >= 3 ? found[0] : ''
}

// 源技能特征 6：情绪曲线太光滑。只认「从痛到燃」这种修圆了的弧线，不猜作者想没想通。
function smoothEmotionHit(body) {
  const text = String(body || '')
  return text.match(/从.{0,8}(?:迷茫|焦虑|痛苦|低谷|崩溃).{0,10}到.{0,8}(?:清晰|释然|成长|爆发|燃)/)?.[0]
    || text.match(/情绪.{0,8}(?:从|由).{0,12}(?:到|再到)/)?.[0]
    || ''
}

// 源技能特征 9：没有任何犹豫。两条以上绝对判断才算，单次「一定」是口播正常说法。
function noHesitationHit(body) {
  const text = String(body || '')
  const cues = ['毫无疑问', '百分百', '没有任何例外', '永远都是', '所有人都会']
  const found = cues.filter(cue => text.includes(cue))
  return found.length >= 2 ? found[0] : ''
}

// 源技能特征 11：脆弱感服务于论点。经历后立刻接到「所以你 / 这证明」。
function vulnerabilityServesHit(body) {
  return String(body || '').match(/我(?:也)?曾经[^。！？]{0,24}(?:崩溃|失败|自卑|走投无路)[^。！？]{0,8}[。！？]?\s*(?:所以你|这证明|这让我明白)/)?.[0] || ''
}

// 源技能特征 12：把结论包装成协议。只认「当成协议 / 记住这几条 / 军规」，口播里的「下一步」不判。
function conclusionAsProtocolHit(body) {
  const text = String(body || '')
  return text.match(/把这(?:个|件事|一套)?当成(?:你的)?(?:协议|口诀|公式|军规)/)?.[0]
    || text.match(/记住这[两三四五几\d]+条/)?.[0]
    || text.match(/三条军规/)?.[0]
    || ''
}

// 源技能特征 14：句子节奏过于均匀。推文才不适用；口播五句字数几乎一样才算。短句或缺句不判。
function evenSentenceRhythmHit(body) {
  const sentences = String(body || '')
    .split(/[。！？\n]/)
    .map(item => item.replace(/\s+/g, '').trim())
    .filter(item => item.length >= 6)
  if (sentences.length < 5) return ''
  const sample = sentences.slice(0, 5).map(item => item.length)
  return Math.max(...sample) - Math.min(...sample) <= 4 ? sentences[0].slice(0, 14) : ''
}

// 源技能特征 16：短视频更突出。前三句同时有钩子和承诺才算三件套，单句设问不算。
function hookPainPromiseHit(body) {
  const sentences = []
  for (const rawLine of String(body || '').split('\n')) {
    const line = rawLine.trim().replace(/^[（(][^）)]*[）)]\s*/, '')
    if (!line || /^(#{1,6}\s*|标题[:：]|正文[:：])/.test(line)) continue
    for (const piece of line.split(/(?<=[。！？；])/)) {
      const sentence = piece.trim()
      if (sentence) sentences.push(sentence)
      if (sentences.length >= 3) break
    }
    if (sentences.length >= 3) break
  }
  const opening = sentences.join('')
  const hook = opening.match(/你是不是|还在为|有没有发现|先别划走|停一下/)
  const promise = opening.match(/看完.{0,8}(?:你就|就能)|我告诉你|我教你|三分钟(?:让你|教会)|这篇(?:教你|告诉你)|你将学会|给你一个方法/)
  if (!hook || !promise) return ''
  return hook[0]
}

// 源技能特征 18：同义词刻意替换。认「或者说 / 也可以叫 / 换个说法」叠着用，单次换说法不判。
function synonymSwappingHit(body) {
  const text = String(body || '')
  const markers = ['或者说', '也可以叫', '换个说法']
  const found = markers.filter(marker => text.includes(marker))
  return found.length >= 2 ? found[0] : ''
}

// ── 判据分层 ────────────────────────────────────────────────────────────────
// 闸门：客观可判定，命中即拦停生成结果。封顶 5 条，加一条必须先删一条。
// 第 5 条 same_essay 在 scanGeneratedBodies 里判——它要看四篇正文，单篇判不了。
// 内容层（案例、数字是否真实）不在闸门里：系统没有事实来源，没资格判。
// 闸门只留「初稿根本没做出来」：格式泄漏与串台。四平台同一篇走 sameEssayHits。
// self_intro（Requirement 13 第 3 条）与 length_severe（第 4 条）已降为提醒：
// 它们落在 reminders 里，不再触发生成阶段的自动重写，也不拦停发布。
export const gateCodes = ['format_leak', 'platform_mixup']

// 生成闸门的判据：验收失败，或案例位/数字位用了不可溯源的素材（Requirement 13 第 3 条）。
// 两者都算「初稿根本没做出来」，触发同一次重写；summary 给重写提示词和草稿记录看。
export function generationGate({ scan, unbacked } = {}) {
  const unbackedSummary = Object.entries(unbacked || {})
    .filter(([, numbers]) => (numbers || []).length)
    .map(([platform, numbers]) => `${platform}：正文用了素材里没有的数字（${numbers.join('、')}）`)
    .join('；')
  return { triggered: Boolean(scan?.failed || unbackedSummary), summary: [scan?.summary, unbackedSummary].filter(Boolean).join('；') || null }
}

// 语言层提醒：审美类，不拦停、不触发自动重写、不影响 workflow_status。
// 不再归并成类别，也不设条数上限（Requirement 11 第 6 条）：一个 code 一条，按正文顺序逐处呈现。
// 对不上 dbs-ai-check 22 个特征的 code（整篇级判断、体裁类）名字只在这里给。
const languageLabels = {
  ing_tail: '「正在 / 越来越」式尾句',
  avoid_copula: '少用「是」字句',
  case_claim: '来路不明的具体案例',
  experience_claim: '来路不明的经历数量',
  no_concrete_support: '整篇通用判断',
  method_talk: '方法骨架 / 分发说明',
  opening_question: '开头第一句是问句',
}

// 现有检测码 → dbs-ai-check 特征编号。自媒体口播 22 条都适用，只认能指到原句的形态。
export const aiFeatureCodeOf = {
  ai_tone_phrase: 'not_x_but_y',
  golden_tail: 'every_paragraph_punchline',
  generic_ending: 'you_deserve_ending',
  connector_abuse: 'connector_overuse',
  fake_rebuttal: 'strawman_reader',
  triple_list: 'even_parallelism',
  vague_case: 'fake_story',
  consulting_tone: 'translationese',
  repeated_concession: 'repeated_concession',
  naming_ritual: 'naming_ritual',
  fake_precise_emotion: 'fake_precise_emotion',
  body_feeling_over_logic: 'body_feeling_over_logic',
  overfitting_profundity: 'overfitting_profundity',
  block_all_rebuttals: 'block_all_rebuttals',
  dump_all_knowledge: 'dump_all_knowledge',
  smooth_emotion_curve: 'smooth_emotion_curve',
  no_hesitation: 'no_hesitation',
  vulnerability_serves_point: 'vulnerability_serves_point',
  conclusion_as_protocol: 'conclusion_as_protocol',
  even_sentence_rhythm: 'even_sentence_rhythm',
  hook_pain_promise: 'hook_pain_promise',
  synonym_swapping: 'synonym_swapping',
}

const featureForCode = code => (aiFeatureCodeOf[code] ? aiFeatureByCode[aiFeatureCodeOf[code]] : null)

// 「按检查意见改写」的指令：一个 code 一句，不再按类别。
// 句子沿用原来那几份，没有重写；条目结构上不再有类别，也就没有条数上限。
const languageFixes = {
  ai_tone_phrase: '把升华句、段尾金句和万能收尾换成具体的人和事：谁、在什么场合、发生了什么',
  golden_tail: '把升华句、段尾金句和万能收尾换成具体的人和事：谁、在什么场合、发生了什么',
  ing_tail: '把升华句、段尾金句和万能收尾换成具体的人和事：谁、在什么场合、发生了什么',
  avoid_copula: '把升华句、段尾金句和万能收尾换成具体的人和事：谁、在什么场合、发生了什么',
  generic_ending: '把升华句、段尾金句和万能收尾换成具体的人和事：谁、在什么场合、发生了什么',
  triple_list: '删掉凑数三连、没人提出的反驳和「首先 / 其次 / 此外」这类书面连接词，用口语顺序讲',
  fake_rebuttal: '删掉凑数三连、没人提出的反驳和「首先 / 其次 / 此外」这类书面连接词，用口语顺序讲',
  connector_abuse: '删掉凑数三连、没人提出的反驳和「首先 / 其次 / 此外」这类书面连接词，用口语顺序讲',
  vague_case: '把没有主体的例子和来路不明的数字换成你自己经历过的具体事，或直接删掉',
  case_claim: '把没有主体的例子和来路不明的数字换成你自己经历过的具体事，或直接删掉',
  experience_claim: '把「做过多少次、带过多少人」这类数字换成你真做过的那一件事，或者直接删掉数字',
  no_concrete_support: '补一个具体场景、数字或时间，让整篇有一个能落地的地方',
  method_talk: '把「拆成几块 / 裂变 / 多平台分发」换成一件具体的经历或判断，字数不要因此变少',
  consulting_tone: '改成跟熟人说话，删掉咨询腔和工程词',
  opening_question: '第一句直给冲突或结论，不要问句',
  repeated_concession: '同一个让步结构只用一遍，后面换说法或跳过',
  naming_ritual: '概念只起一个名字，第二次删掉起名仪式',
  fake_precise_emotion: '把量过的假精确数字换成嘴里会说的感受',
  body_feeling_over_logic: '别用身体感受收束，讲不下去就直说讲不下去',
  overfitting_profundity: '删掉「本质上 / 归根结底」后面那句更大的命题，回到具体事情',
  block_all_rebuttals: '只留你真被人问过的那一条反驳，剩下想象出来的删掉',
  dump_all_knowledge: '术语只留一个你真正用来想事情的，剩下的删掉',
  smooth_emotion_curve: '留一个你自己也没想通的地方，别修成从痛到燃的弧线',
  no_hesitation: '写一处你其实也不太确定的地方',
  vulnerability_serves_point: '经历里跟论点无关、但你还记得的那截留下，别只用它证明观点',
  conclusion_as_protocol: '结尾不要再给一份协议或口诀，事情说到哪收到哪',
  even_sentence_rhythm: '加一句两三个字的短句，或一句明显更长的话，打断均匀节奏',
  hook_pain_promise: '前三句别卖焦虑，从你真正想让人知道的那件事说起',
  synonym_swapping: '同一个词觉得准就重复用，不要连着换说法',
  // Requirement 13 第 3、4 条：自介与字数不足降为提醒后，改写指令不能跟着丢。
  self_intro: '删掉自我介绍和引导关注，直接说内容本身',
  length_severe: '把正文补到目标字数，保留已有的判断，不要另写一篇更简单的',
}

function writingIssues(draft) {
  const hits = []
  // quote 是直接引用的原文，position 是它在正文里的位置：报告要按文本顺序呈现，不按特征归类。
  // 整篇级的问题（太短、通篇没有落地）没有单一位置，position 记 -1，排到最后，不假装它在开头。
  const add = (code, message, suggestion = '', quote = '', wholeBody = false) => {
    const feature = featureForCode(code)
    // label / intent / followup 对齐 design.md 的语言层条目结构。
    // severity 仍是内部的 warning：评分（100 - 15/10）和 blocked 判定读这个字段。
    // scope 只加不改：quote 与 position 保持原样，诊断报告靠它们展示（每条都要有原文引用）。
    // scope 回答的是另一个问题——这一处能不能单独改，界面拿它决定给不给「改这一处」。
    const locatable = !wholeBody && Boolean(quote)
    hits.push({ code, label: feature?.name || languageLabels[code] || code, intent: feature?.intent || '', followup: feature?.question || '', feature, message, suggestion, severity: 'warning', scope: locatable ? 'locatable' : 'whole_body', quote, position: wholeBody || !quote ? -1 : String(draft?.body || '').indexOf(quote) })
  }

  const introHits = selfIntroHits(draft?.body)
  if (introHits.length) add('self_intro', `正文出现自我介绍或引导关注：${introHits.join('、')}`, '删掉自我介绍与引导关注，改成直给结论的开头', introHits[0])
  const leakHits = formatLeakHits(draft?.body)
  if (leakHits.length) add('format_leak', `正文混入结构骨架或标记：${leakHits.join('、')}`, '删掉结构说明、占位符与其他平台建议，只留给读者看的正文', leakHits[0])
  const aiToneList = aiToneHits(draft?.body)
  if (aiToneList.length) add('ai_tone_phrase', `正文出现升华式句式：${aiToneList.join('、')}`, '', aiToneList[0])
  // 短式翻转补齐：口播稿基本不写「而」，只靠上面那条正则会整类漏判。
  // 密度不够就不报——一次翻转是正常修辞，不是 AI 味。
  const flips = flipShortHits(draft?.body)
  if (!aiToneList.length && flips.length >= flipDensityThreshold(draft?.body)) add('ai_tone_phrase', `正文反复用「不是X，是Y」翻转 ${flips.length} 次：${flips[0]}`, '', flips[0])
  const vagueList = vagueCaseHits(draft?.body)
  if (vagueList.length) add('vague_case', `正文出现没有主体的案例：${vagueList.join('、')}`, '', vagueList[0])
  if (lacksConcreteSupport(draft?.body)) add('no_concrete_support', '正文没有具体场面、人、数字或时间，整篇是通用判断', '', openingSentence(draft?.body), true)
  for (const [code, hit] of templateSentenceHits(draft?.body)) add(code, `正文出现模板句：${hit}`, '', hit)
  const mixupHits = platformMixupHits(draft?.body, draft?.platform)
  if (mixupHits.length) add('platform_mixup', `正文提到别的平台：${mixupHits.join('、')}`, '把其他平台名和分发说明换成这一条自己的具体内容，不要只删掉那句话', mixupHits[0])
  const methodHits = methodTalkHits(draft?.body)
  if (methodHits.length) add('method_talk', `正文在讲方法或分发骨架：${methodHits.join('、')}`, '', methodHits[0])
  const caseHits = caseClaimHits(draft?.body)
  if (caseHits.length) add('case_claim', `正文里有几句${[...new Set(caseHits.map(hit => splitClaimHit(hit).reason).filter(Boolean))].join('、') || '写了具体的人和数字'}，真假只有你能核实：${claimSentences(caseHits).map(item => `「${item}」`).join('')}`, '', claimSentences(caseHits)[0])
  const experienceHits = experienceClaimHits(draft?.body)
  if (experienceHits.length) add('experience_claim', `正文里有几句说的是你自己做过多少（次数、人数、账号数），这些只有你能核实：${claimSentences(experienceHits).map(item => `「${item}」`).join('')}`, '', claimSentences(experienceHits)[0])
  const toneHits = consultingToneWords.filter(word => String(draft?.body || '').includes(word)).slice(0, 6)
  if (toneHits.length) add('consulting_tone', `正文出现咨询腔或工程词：${toneHits.join('、')}`, '', toneHits[0])
  const concessions = concessionHits(draft?.body)
  if (concessions.length >= 3) add('repeated_concession', `正文把同一个让步模板用了 ${concessions.length} 遍：${concessions[0]}`, '', concessions[0])
  const naming = namingRitualHit(draft?.body)
  if (naming) add('naming_ritual', `正文反复给概念起名字：${naming}`, '', naming)
  const precise = fakePreciseEmotionHit(draft?.body)
  if (precise) add('fake_precise_emotion', `正文出现量过的假精确时间：${precise}`, '', precise)
  const feeling = bodyFeelingHit(draft?.body)
  if (feeling) add('body_feeling_over_logic', `正文用身体感受收束：${feeling}`, '', feeling)
  const profundity = profundityHit(draft?.body)
  if (profundity) add('overfitting_profundity', `正文把事情升维：${profundity}`, '', profundity)
  const rebuttals = blockAllRebuttalsHit(draft?.body)
  if (rebuttals) add('block_all_rebuttals', `正文连着堵住多处反驳：${rebuttals}`, '', rebuttals)
  const knowledge = dumpAllKnowledgeHit(draft?.body)
  if (knowledge) add('dump_all_knowledge', `正文在堆术语：${knowledge}`, '', knowledge)
  const emotion = smoothEmotionHit(draft?.body)
  if (emotion) add('smooth_emotion_curve', `正文把情绪修成光滑弧线：${emotion}`, '', emotion)
  const certainty = noHesitationHit(draft?.body)
  if (certainty) add('no_hesitation', `正文没有任何犹豫：${certainty}`, '', certainty)
  const vulnerability = vulnerabilityServesHit(draft?.body)
  if (vulnerability) add('vulnerability_serves_point', `正文用脆弱感证明论点：${vulnerability}`, '', vulnerability)
  const protocol = conclusionAsProtocolHit(draft?.body)
  if (protocol) add('conclusion_as_protocol', `正文把结论包装成协议：${protocol}`, '', protocol)
  const rhythm = evenSentenceRhythmHit(draft?.body)
  if (rhythm) add('even_sentence_rhythm', `正文句子节奏过于均匀：${rhythm}`, '', rhythm)
  const trio = hookPainPromiseHit(draft?.body)
  if (trio) add('hook_pain_promise', `开头在卖钩子加承诺：${trio}`, '', trio)
  const synonyms = synonymSwappingHit(draft?.body)
  if (synonyms) add('synonym_swapping', `正文刻意替换同义词：${synonyms}`, '', synonyms)
  const opening = openingSentence(draft?.body)
  if (opening && (opening.endsWith('？') || opening.endsWith('?'))) add('opening_question', `开头第一句是问句：${opening.length > 26 ? `${opening.slice(0, 26)}…` : opening}`, '', opening)
  // 字数严重不足：低于目标下限的六成。没有下限的目标不判。
  const target = draftLengthTargetOf(draft)
  const min = Number(target?.min || 0)
  const bodyLength = String(draft?.body || '').trim().length
  if (min && bodyLength && bodyLength < Math.round(min * 0.6)) add('length_severe', `正文只有 ${bodyLength} 字，${draft?.platform || ''}目标下限 ${min} 字，不到六成`, `把正文补到 ${draftLengthRangeFrom(target)} 字，保留已有判断`, openingSentence(draft?.body), true)

  const gate = hits.filter(item => gateCodes.includes(item.code))
  // 语言层不归并：一个 code 一条，不设条数上限，且按正文顺序排（Requirement 11 第 2、6 条）。
  const reminders = hits
    .filter(item => !gateCodes.includes(item.code))
    .sort((left, right) => (left.position < 0 ? Number.MAX_SAFE_INTEGER : left.position) - (right.position < 0 ? Number.MAX_SAFE_INTEGER : right.position))
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

// 数字归一化：中文数字和阿拉伯数字按同一个「值」比较。
// 不归一化的话，素材里写 300、正文里写 三百会被当成两个数字，正文那个必然被判不可溯源。
const chineseDigitValues = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 零: 0 }
const chinesePlaceValues = { 十: 10, 百: 100, 千: 1000 }
const chineseNumberChars = '一二三四五六七八九十百千万零两'

function chineseNumberValue(text) {
  let total = 0
  let section = 0
  let digit = null
  for (const char of String(text || '')) {
    if (Object.hasOwn(chineseDigitValues, char)) { digit = chineseDigitValues[char]; continue }
    if (Object.hasOwn(chinesePlaceValues, char)) { section += (digit ?? 1) * chinesePlaceValues[char]; digit = null; continue }
    if (char === '万') { total += (section + (digit ?? 0)) * 10000; section = 0; digit = null }
  }
  return total + section + (digit ?? 0)
}

// 只抓像数据声明的数字：两位数以上，或带 % 万 倍 元 块 单位的。
// 个位数的「一步」「三个动作」是最常见的修辞用法，抓了只会误伤。
const dataNumberPattern = /(\d+(?:\.\d+)?)\s*(%|％|万|倍|元|块)?/g
// 中文数字走同一把尺子。不补这一条，把数字写成汉字就能绕过不可溯源闸门。
const chineseNumberPattern = new RegExp(`([${chineseNumberChars}]+)\\s*(%|％|倍|元|块)?`, 'g')
// 长得像数字、实际不是数据声明的词。这是闸门，误报会直接拦住稿子，宁可先排掉。
// 后面那串是成语：真模型复验时在正文里写下「十万八千里」，被当成编造数字标了出来（2026-09-21）。
// 不用「含两个数量级词就算成语」那种通用规则——「一百三十」「一千二百」也是两个数量级词，
// 那是正常的数字写法，通用规则会把它们误杀。成语是固定词表，就按词表排。
const numeralIdioms = ['十分', '百分', '千万', '万般', '百般', '十足', '百姓',
  '十万八千', '十拿九稳', '七上八下', '五花八门', '丢三落四', '不三不四', '朝三暮四', '低三下四', '歪七扭八', '七七八八', '三三两两', '七零八落']
// 「几十条」「十几万」里的「十」是估值，不是数据声明。
// 中文数字的正则字符集里没有「几」「数」，所以「几十」会被切成孤立的「十」，
// 不管它的话「拆了几十条片子」会被当成数据声明，直接拦住稿子。
const vagueNeighbors = '几数多来余许'

const isNumeralIdiom = (text, index) => numeralIdioms.some(word => text.startsWith(word, index))
// 注意 空字符串：`vagueNeighbors.includes('')` 返回 true，
// 不显式判空的话，出现在文末的数字会拿到空邻居，被静默当成估值跳过。
const isVagueNeighbor = (text, index, length) => {
  const before = text[index - 1]
  const after = text[index + length]
  return Boolean((before && vagueNeighbors.includes(before)) || (after && vagueNeighbors.includes(after)))
}
const valueOfArabic = (digits, unit) => (unit === '万' ? Number(digits) * 10000 : Number(digits))

// 归一化成「值 → 原样写法」。同一个数值的两种写法只留一个，报告里显示正文里的那个写法。
function numberTokens(input) {
  const text = String(input || '')
  const found = new Map()
  const add = (value, form) => found.set(value, form)
  for (const match of text.matchAll(dataNumberPattern)) {
    if (!match[2] && match[1].replace(/\D/g, '').length < 2) continue
    add(valueOfArabic(match[1], match[2]), match[2] ? `${match[1]}${match[2]}` : match[1])
  }
  for (const match of text.matchAll(chineseNumberPattern)) {
    if (isNumeralIdiom(text, match.index) || isVagueNeighbor(text, match.index, match[0].length)) continue
    const value = chineseNumberValue(match[1])
    if (!match[2] && value < 10) continue
    add(match[2] === '万' ? value * 10000 : value, match[2] ? `${match[1]}${match[2]}` : match[1])
  }
  return found
}

// 正文里出现的、像数据声明的数字。返回去重后的原样写法（带单位）。
export function draftNumbers(body) {
  return [...numberTokens(body).values()]
}

// 正文里素材和简报都没有的数字：这些数字不可溯源。
// Requirement 13 第 3 条把它列为闸门：生成阶段命中就重写一次并标成待修改（见 index.mjs 生成路由）。
// 这里只负责把不可溯源的数字算出来，拦不拦由调用方决定。
export function unbackedNumberHits(body, allowedText = '') {
  const allowed = new Set(numberTokens(allowedText).keys())
  return [...numberTokens(body).entries()].filter(([value]) => !allowed.has(value)).map(([, form]) => form)
}

// 生成阶段的拦停只看闸门：格式泄漏、串台，加四平台同一篇。
// 语言层命中与降级后的 self_intro / length_severe（审美）不拦停，
// 进 reminders 等用户点「检查」或「重写」时再说。
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

// Requirement 9：诊断报告要按正文顺序逐处呈现，每处给原文引用、一句人话和严重度。
// 严重度三档只用于排序和提示，不带否决权——没有任何一档能单独把正文拦下来。
const diagnosticSeverityOf = {
  format_leak: 'strong',
  platform_mixup: 'strong',
  self_intro: 'strong',
  length_severe: 'strong',
  no_concrete_support: 'medium',
  vague_case: 'medium',
  case_claim: 'medium',
  experience_claim: 'medium',
  method_talk: 'medium',
  ai_tone_phrase: 'medium',
  consulting_tone: 'weak',
  opening_question: 'weak',
}

// 三档词汇直接用 dbs-ai-check 的：强信号 / 中信号 / 弱信号。
export const diagnosticSeverityLabels = { strong: '强信号', medium: '中信号', weak: '弱信号' }

// 第 6 条：结尾要明确说明这只是检测结果，并问一句要不要改。
export const diagnosticReportFooter = '以上是检测结果，不涉及修改。要按这些改一版吗？'

// 阶段 4.3：定点替换到底要改哪些地方。
// 原来只收语言层命中，人设/质量里同样指得出具体词句的标记（命中档案表达边界、命中风险表达）
// 界面上标了「能单独改」却改不动，所以在这里并成一份清单。
// 只收 scope === 'locatable'：全篇级和档案级的没有哪一处可改，放进去只会让模型瞎改一句。
export function markableIssues(draft, scan) {
  const markable = []
  const add = (code, message, quote) => {
    const text = String(quote || '').trim()
    // 没原句的进不来：说不清改哪一句，就只能让模型自由发挥。
    if (!text) return
    // 按「位置」去重，不是按哪条规则报的：同一个词可能同时踩到档案禁忌和风险词，
    // 那是两处标记、一处正文，只能改一次——改两遍第二遍就找不到原句了。
    if (markable.some(item => item.quote === text)) return
    markable.push({ code, message, quote: text })
  }
  for (const item of scan?.evidence || []) add(item.code, item.message, item.quote)
  for (const key of ['persona', 'quality']) {
    const checked = draft?.checks?.[key]
    // 检查是对着某个版本做的；版本改过之后，那些标记说的不是现在这条正文，不能拿来改。
    if (checked?.draft_version !== draft?.version) continue
    for (const item of checked.evidence || []) if (item.scope === 'locatable') add(item.code, item.message, item.quote)
  }
  return markable
}

export function diagnosticReport(draft) {
  const { hits } = writingIssues(draft)
  // Requirement 13：结构层（dbs-script-flow）与语言层用同一份报告、同一套风险三档，
  // 按文本顺序逐处呈现；layer 标清是哪一层判出来的。结构层不拦停生成。
  const structure = structureReport(draft)
  const entries = [
    ...hits.map(item => ({ layer: 'language', code: item.code, label: item.label, quote: item.quote, note: item.message, severity: item.feature?.severity || diagnosticSeverityOf[item.code] || 'weak', scope: item.scope, position: item.position, intent: item.intent, followup: item.followup, feature: item.feature ? { id: item.feature.id, name: item.feature.name } : null })),
    ...structure.findings.map(item => ({ layer: 'structure', code: item.code, label: structureDimensions[item.dimension], quote: item.quote, note: item.note, severity: item.risk, scope: item.position >= 0 && item.quote ? 'locatable' : 'whole_body', position: item.position, intent: '', followup: '', fix: item.fix })),
  ].sort((left, right) => (left.position < 0 ? Number.MAX_SAFE_INTEGER : left.position) - (right.position < 0 ? Number.MAX_SAFE_INTEGER : right.position))
  // 第 5 条：整体没特征就直说，不硬找。
  const summary = entries.length ? '' : '没有发现明显的 AI 特征，也没发现逻辑断裂。不硬找。'
  return { entries, segments: structure.segments, summary, severity_labels: diagnosticSeverityLabels, footer: diagnosticReportFooter }
}

export { qualityKeys }
