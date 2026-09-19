// 移植 dbs-content-risk-check 的发布前风险检查，并进发布前诊断区（不加新环节）。
//
// 源技能的核心是两层分别成立：
//   一、平台机器可能识别什么（外链、联系方式、二维码、长数字、广告结构、名单型词面）；
//   二、内容本身有没有实质问题（欺诈、虚假承诺、受限推广、医疗功效、隐私、攻击）。
// 并且写明：词面只负责召回线索，完整语义和独立证据才决定进不进报告；
// 机器误伤只能写成「可能触发机器审核」，不许补造一个违规原因；
// 强观点、情绪、口语、夸张修辞本身不是风险。
//
// 这些规矩在提示词里逐条写死，解析时再卡三道：层级只认三个、原句必须在稿子里找得到（防编造）、
// 贴片小字必须是三行且每行 4-9 个汉字（源技能的规定），对不上整份不要，不替它凑。
//
// 跟共鸣报告、逐字稿检查一样：只出报告给人看，不写 checks、不改 workflow_status、不动 approval；
// 它不替用户决定能不能发，也不写「一定会被限流」这种没有依据的结论。
//
// 来源：dbs-content-risk-check（CC BY-NC 4.0，dontbesilent2025/dbskill）。

export const publishRiskKinds = [
  { id: 'substance', label: '建议优先处理', note: '内容本身的实质问题' },
  { id: 'machine', label: '可能触发机器审核', note: '平台机器可能识别到的信号' },
  { id: 'needs_confirm', label: '发布前确认', note: '结论取决于资质、授权、类目或平台当前规则' },
]

const urlPattern = /(?:https?:\/\/|www\.)[^\s，。；！？）】"'<>]+/gi
const phonePattern = /(?<!\d)1[3-9]\d{9}(?!\d)/g
const longDigitPattern = /(?<!\d)\d{8,}(?!\d)/g
const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const contactPattern = /(?:微信|weixin|wx|WX|vx|VX|v信|QQ|qq)\s*[:：]?\s*[A-Za-z0-9_-]{4,}/g
const qrcodeWords = ['二维码', '扫码', '扫一扫', '码上']
const driveActions = ['私信我', '私我', '加我', '联系我', '扣1', '扣一', '评论区扣', '主页有', '主页链接', '找我', '进群', '加群', '咨询我', '私聊']
const absoluteClaims = ['100%', '百分之百', '永久有效', '全网最低', '最低价', '销量第一', '保证有效', '稳赚', '零风险', '绝对有效']
// 医疗功效词单独一类：源技能里它属于「受限推广」，跟「绝对化」不是同一层问题。
const medicalClaims = ['治疗', '治愈', '根治', '包治', '降血压', '降血糖', '抗癌', '消炎', '排毒', '生发', '祛疤', '无副作用']

function text(value) { return String(value ?? '').trim() }

// 逐句扫描：机器信号 + 词面线索。规则只负责「这里有东西值得看」，不负责定性。
export function scanRiskSurface(input) {
  const title = text(input?.title)
  const body = text(input?.body)
  const lines = `${title}\n${body}`.split('\n').map(line => line.trim()).filter(Boolean)
  const hits = []
  const push = (kind, keyword, evidence, where) => {
    if (evidence) hits.push({ kind, keyword, evidence: evidence.slice(0, 80), where: where || (title && title.includes(evidence) ? '标题' : '正文') })
  }
  for (const line of lines) {
    for (const match of line.match(urlPattern) || []) push('url', '完整外链', match, line === title ? '标题' : '正文')
    for (const match of line.match(phonePattern) || []) push('phone', '手机号', match)
    for (const match of line.match(contactPattern) || []) push('contact', '站外联系方式', match)
    for (const match of line.match(emailPattern) || []) push('email', '邮箱', match)
    // 长数字串：手机号已经单列，避免同一串数字报两次。
    for (const match of line.match(longDigitPattern) || []) { if (!phonePattern.test(match)) push('digits', '连续长数字', match) }
    for (const word of qrcodeWords) if (line.includes(word)) push('qrcode', word, word)
    for (const word of driveActions) if (line.includes(word)) push('drive', word, word)
    for (const word of absoluteClaims) if (line.includes(word)) push('claim', word, word)
    for (const word of medicalClaims) if (line.includes(word)) push('medical', word, word)
  }
  // 同一句同一个关键词只留一条。
  const seen = new Set()
  return hits.filter(item => {
    const key = `${item.kind}:${item.evidence}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function publishRiskSignals(input) {
  const hits = scanRiskSurface(input)
  const byKind = kind => hits.filter(item => item.kind === kind)
  return {
    hit_count: hits.length,
    url_count: byKind('url').length,
    contact_count: byKind('contact').length + byKind('phone').length + byKind('email').length,
    qrcode_count: byKind('qrcode').length,
    drive_action_count: byKind('drive').length,
    digits_count: byKind('digits').length,
    claim_count: byKind('claim').length,
    medical_count: byKind('medical').length,
    samples: hits.slice(0, 12).map(item => `${item.keyword}：${item.evidence}`),
  }
}

export function publishRiskPrompt({ platform, title, body, signals }) {
  const signalLines = signals.hit_count
    ? signals.samples.map(item => `- ${item}`).join('\n')
    : '（规则没扫到明显词面信号，仍要按完整语义判断实质问题）'
  return {
    system: `你在做${platform}内容的发布前风险检查。两层结论分别成立，不要混：\n一、平台机器可能识别什么（广告结构、联系方式、外链、二维码、连续数字、名单型词面、重复堆叠）；\n二、内容本身有没有实质问题（欺诈、虚假宣传、违规导流、受限推广、医疗功效、侵权、隐私、攻击、危险行为）。\n\n硬规矩：\n1. 词面只负责召回线索，完整语义决定进不进报告。机器误伤只能写成「可能触发机器审核」，不许补造一个违规原因。\n2. 实质问题必须说出独立机制，不能只引用关键词或机器标签。\n3. 强观点、情绪化表达、冲突结构、口语、夸张修辞、隐喻和个人偏好本身不是风险，不要以「更稳妥」「可能让人联想到」为由建议修改。\n4. 不预测违规概率，不承诺机器一定怎样处理，不写「能发」「不能发」「保证通过」。\n5. 每条必须引用稿子里的原句（evidence 要是原文里逐字出现的句子），指不到就不要出这条。\n6. 只给最小修改动作（补条件、补主体、改成官方入口、局部删改），不要重写全文，也不要给谐音、拆字、暗号这类绕审写法。\n7. 贴片小字只在真正需要时给：稿子里的个人经验容易被读成普遍效果、设想容易被读成承诺、观点容易被读成事实指控。给就给三行，每行 4 到 9 个汉字，只写事实边界，不写「更加保险」这种废话；不需要就给空数组。\n8. 只输出 JSON，不要解释、不要代码块。\n\n输出格式：\n{\n  "findings": [{ "kind": "substance" | "machine" | "needs_confirm", "evidence": "稿子里逐字出现的原句", "location": "标题" | "正文", "problem": "一句话说清机制", "action": "删什么、改什么、补什么", "false_positive": "机器误伤可能（只有 machine 这类要填）" }],\n  "overlay": ["第一行", "第二行", "第三行"],\n  "summary": { "machine": "最明显的机器信号或未发现", "substance": "是否存在需要优先处理的实质问题" }\n}`,
    user: `平台：${platform}\n标题：${title || '（没有标题）'}\n\n规则先扫到的词面信号（供你判断，不用复述）：\n${signalLines}\n\n正文：\n${body}`,
  }
}

// 三道卡：层级只认三个、原句必须在稿子里找得到、贴片是三行且每行 4-9 个汉字。
export function parsePublishRiskResponse(content, { title = '', body = '', signals = null } = {}) {
  const raw = text(content).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  let parsed = null
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const kindIds = publishRiskKinds.map(item => item.id)
  const haystack = `${text(title)}\n${text(body)}`
  const findings = []
  for (const entry of Array.isArray(parsed.findings) ? parsed.findings : []) {
    const kind = kindIds.includes(text(entry?.kind)) ? text(entry.kind) : ''
    const evidence = text(entry?.evidence)
    const problem = text(entry?.problem)
    const action = text(entry?.action)
    // 原句必须在稿子里逐字出现：编一句「原文」出来这条就不成立。
    if (!kind || !evidence || !problem || !action || !haystack.includes(evidence)) continue
    findings.push({ kind, kind_label: publishRiskKinds.find(item => item.id === kind).label, evidence, location: text(entry?.location) === '标题' ? '标题' : '正文', problem, action, false_positive: text(entry?.false_positive) })
  }
  const overlayLines = (Array.isArray(parsed.overlay) ? parsed.overlay : []).map(text).filter(Boolean)
  const overlayValid = overlayLines.length === 3 && overlayLines.every(line => /^[\u4e00-\u9fa5]{4,9}$/.test(line))
  return {
    findings,
    kind_counts: publishRiskKinds.reduce((counts, item) => ({ ...counts, [item.id]: findings.filter(finding => finding.kind === item.id).length }), {}),
    // 贴片要么三行合规，要么不给：不替它补、不替它删到凑数。
    overlay: overlayValid ? overlayLines : [],
    overlay_rejected: overlayLines.length > 0 && !overlayValid,
    measured: signals || null,
    summary: { machine: text(parsed.summary?.machine), substance: text(parsed.summary?.substance) },
  }
}
