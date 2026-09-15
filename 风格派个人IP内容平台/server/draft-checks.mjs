import { prohibitedHits } from './redfox.mjs'
import { validateSourceRefs } from './validation.mjs'
import { openingReadiness } from './draft-workflow.mjs'
import { draftLengthRange, draftLengthTargets } from './draft-writing.mjs'

const riskWordHits = value => prohibitedHits(value).map(item => item.word)
const qualityKeys = ['opening_clarity', 'audience_fit', 'core_point', 'evidence', 'structure_and_risk']

function text(value) { return String(value || '').replace(/\s+/g, ' ').trim() }
function list(value) { return Array.isArray(value) ? value.map(text).filter(Boolean) : [] }
function hitsFor(value, words) { const body = text(value); return words.filter(word => body.includes(word)) }
function evidenceItem(code, message, severity = 'warning') { return { code, message, severity } }
function result(status, { score = null, dimensions = {}, evidence = [], suggestions = [], draftVersion = 1 } = {}) {
  return { status, score, dimensions, evidence, suggestions, draft_version: draftVersion, checked_at: new Date().toISOString() }
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
  if (audiences.length && !matchedAudience) { evidence.push(evidenceItem('audience_mismatch', '正文未明显对应当前受众')) ; suggestions.push('在正文中写出受众正在面对的具体问题') }
  if (pillars.length && !matchedPillar) { evidence.push(evidenceItem('pillar_mismatch', '正文未明显对应内容支柱')); suggestions.push('补充一个与内容支柱直接相关的观点或案例') }
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
  // 口播稿（≤250 字）本来就常常是一整段，不拿段落数要求它们；长文才看分段。
  const structureReady = rawBody.length >= 120 && (rawBody.length <= 250 || paragraphCount >= 2)
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
  if (!body) { evidence.push(evidenceItem('body_missing', '正文不能为空', 'blocked')); suggestions.push('补充正文内容') }
  if (!openingReady) { evidence.push(evidenceItem('opening_missing', '尚未用「开头句」槽位确定开头范式', 'blocked')); suggestions.push('点草稿的「开头句」槽位，从方法库选一个开头范式') }
  if (!sourceValid || sourceCount(draft) === 0) { evidence.push(evidenceItem('source_missing', '草稿缺少有效来源引用', 'blocked')); suggestions.push('补回选题、素材或方法来源') }
  if (riskHits.length) { evidence.push(evidenceItem('risk_words', `正文命中风险表达：${riskHits.join('、')}`, 'blocked')); suggestions.push('修改风险表达后重新检查') }
  if (body && structureScore < 100) { evidence.push(evidenceItem('structure_weak', '正文长度或段落结构仍需加强')); suggestions.push('补充真实过程、证据和可执行步骤') }
  // 受众/支柱的命中靠「正文里出现档案里的原话」。档案里写成了整句时（实测他现在的受众是 17 字整句），
  // 正文不可能原样出现，这条就永远命中（真实草稿 1/32）；把原因写进建议，别让人以为正文真有问题。
  const overlongValue = [...audienceValues, ...pillarValues].map(value => text(value)).find(value => value.length > 12)
  const shortValueHint = () => `档案里的「${overlongValue}」有 ${overlongValue.length} 字，正文不会原样出现这句，所以这条会一直命中；把它改成 2-8 字短词（例如「个人IP创业者」），或确认正文确实对上了之后忽略`
  if (audienceScore < 100) { evidence.push(evidenceItem('audience_weak', '正文与当前受众问题的连接不够明确')); suggestions.push(overlongValue ? shortValueHint() : '在正文中写出受众正在面对的具体问题') }
  if (pointScore < 100) { evidence.push(evidenceItem('point_weak', '核心观点或内容支柱不够明确')); suggestions.push(overlongValue ? shortValueHint() : '用一句话写出你的判断，再用过程或案例支撑') }
  // 模型并不遵守提示词里的字数要求（实测：提示词写抖音不超 250 字，模型给了 384 字），所以这里做确定性校验。
  const lengthTarget = draftLengthTargets[draft?.platform]
  const bodyLength = String(draft?.body || '').trim().length
  if (lengthTarget && bodyLength && (bodyLength < lengthTarget.min || bodyLength > lengthTarget.max)) {
    evidence.push(evidenceItem('platform_length', `正文 ${bodyLength} 字，${draft.platform}目标${draftLengthRange(draft.platform)} 字`))
    suggestions.push(`把正文调整到 ${draftLengthRange(draft.platform)} 字`)
  }
  // 提示词要求「开头第一句直给冲突或结论」，模型实测仍会用设问开头，所以也用可算的判据检查。
  const introHits = selfIntroHits(draft?.body)
  if (introHits.length) {
    evidence.push(evidenceItem('self_intro', `正文出现自我介绍或引导关注：${introHits.join('、')}`))
    suggestions.push('删掉自我介绍与引导关注，改成直给结论的开头')
  }
  // 结构骨架与标记：提示词要求纯文本、只写给读者看的内容，同样需要用可算的判据兑一遍。
  const leakHits = formatLeakHits(draft?.body)
  if (leakHits.length) {
    evidence.push(evidenceItem('format_leak', `正文混入结构骨架或标记：${leakHits.join('、')}`))
    suggestions.push('删掉结构说明、占位符与其他平台建议，只留给读者看的正文')
  }
  // 具体案例与数字：素材库里只有对标样本、没有己方案例，这类句子很可能是模型编的，发布前必须有人确认。
  const caseHits = caseClaimHits(draft?.body)
  if (caseHits.length) {
    evidence.push(evidenceItem('case_claim', `正文出现具体案例或数字：${caseHits.join('、')}`))
    suggestions.push('确认案例与数字是否真实；不是真实经历就改成通用判断，或补一条真实素材')
  }
  // 判据要按行找：口播稿开头常是一行镜头提示（如「（镜头怼脸，语速快）」），那不是句子，要跳到下一行。
  const opening = openingSentence(draft?.body)
  if (opening) {
    if (opening.endsWith('？') || opening.endsWith('?')) {
      evidence.push(evidenceItem('opening_question', `开头第一句是问句：${opening.length > 26 ? `${opening.slice(0, 26)}…` : opening}`))
      suggestions.push('把结论提到第一句，或点「开头句」槽位换一个开头范式')
    }
  }
  const scoreBlocked = score < 60
  if (scoreBlocked) evidence.push(evidenceItem('score_low', '质量综合分低于 60 分', 'blocked'))
  const blocked = evidence.some(item => item.severity === 'blocked') || scoreBlocked
  return result(blocked ? 'blocked' : 'passed', { score, dimensions, evidence, suggestions, draftVersion: currentVersion(draft) })
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

export { qualityKeys }
