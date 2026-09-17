import { prohibitedHits } from './redfox.mjs'
import { validateSourceRefs } from './validation.mjs'
import { openingReadiness } from './draft-workflow.mjs'
import { consultingToneWords, draftFormatOf, draftLengthRangeFrom, draftLengthTargetOf, draftPlatforms } from './draft-writing.mjs'

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
  const lengthTarget = draftLengthTargetOf(draft)
  const lengthRange = draftLengthRangeFrom(lengthTarget)
  const bodyLength = String(draft?.body || '').trim().length
  if (lengthTarget && bodyLength && (bodyLength < lengthTarget.min || bodyLength > lengthTarget.max)) {
    const format = draftFormatOf(draft)
    evidence.push(evidenceItem('platform_length', `正文 ${bodyLength} 字，${draft.platform}${format ? format : ''}目标${lengthRange} 字`))
    suggestions.push(`把正文调整到 ${lengthRange} 字`)
  }
  const writing = writingIssues(draft)
  evidence.push(...writing.evidence)
  suggestions.push(...writing.suggestions)
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
  case_claim: '不要编客户和数字，改成通用判断',
  consulting_tone: '改成跟熟人说话，删掉咨询腔和工程词',
  opening_question: '第一句直给冲突或结论，不要问句',
}

export function draftCheckRewriteNote(draft) {
  const version = currentVersion(draft)
  const hints = []
  for (const key of ['persona', 'quality']) {
    const item = draft?.checks?.[key]
    if (!item || Number(item.draft_version || 0) !== version) continue
    if (item.status === 'passed') continue
    for (const evidence of item.evidence || []) {
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
  }
  return [...new Set(hints)].join('；')
}

// 生成入库前的硬门：提示词拦不住的那几条。不复用 checkQuality——那边会因还没选开头句、还没补来源直接 blocked。
function writingIssues(draft) {
  const evidence = []
  const suggestions = []
  const introHits = selfIntroHits(draft?.body)
  if (introHits.length) {
    evidence.push(evidenceItem('self_intro', `正文出现自我介绍或引导关注：${introHits.join('、')}`))
    suggestions.push('删掉自我介绍与引导关注，改成直给结论的开头')
  }
  const leakHits = formatLeakHits(draft?.body)
  if (leakHits.length) {
    evidence.push(evidenceItem('format_leak', `正文混入结构骨架或标记：${leakHits.join('、')}`))
    suggestions.push('删掉结构说明、占位符与其他平台建议，只留给读者看的正文')
  }
  const caseHits = caseClaimHits(draft?.body)
  if (caseHits.length) {
    evidence.push(evidenceItem('case_claim', `正文出现具体案例或数字：${caseHits.join('、')}`))
    suggestions.push('确认案例与数字是否真实；不是真实经历就改成通用判断，或补一条真实素材')
  }
  const toneHits = consultingToneWords.filter(word => String(draft?.body || '').includes(word)).slice(0, 6)
  if (toneHits.length) {
    evidence.push(evidenceItem('consulting_tone', `正文出现咨询腔或工程词：${toneHits.join('、')}`))
    suggestions.push('改成跟熟人说话的口吻，或先用「去 AI 感改写」再人工过一遍')
  }
  const opening = openingSentence(draft?.body)
  if (opening && (opening.endsWith('？') || opening.endsWith('?'))) {
    evidence.push(evidenceItem('opening_question', `开头第一句是问句：${opening.length > 26 ? `${opening.slice(0, 26)}…` : opening}`))
    suggestions.push('把结论提到第一句，或点「开头句」槽位换一个开头范式')
  }
  return { evidence, suggestions }
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

export function scanGeneratedBody(body, platform) {
  const evidence = writingIssues({ body, platform }).evidence
  return { failed: evidence.length > 0, evidence, summary: evidence.map(item => item.message).join('；') }
}

export function scanGeneratedBodies(bodies) {
  const issues = {}
  for (const platform of draftPlatforms) issues[platform] = writingIssues({ body: bodies?.[platform], platform }).evidence
  const same_essay = sameEssayHits(bodies)
  const failed = same_essay.length > 0 || Object.values(issues).some(list => list.length > 0)
  const summary = [
    ...same_essay.map(item => `四平台同一篇（${item.a}≈${item.b}）`),
    ...draftPlatforms.flatMap(platform => (issues[platform] || []).map(item => `${platform}：${item.message}`)),
  ].slice(0, 8).join('；')
  return { failed, issues, same_essay, summary }
}

export { qualityKeys }
