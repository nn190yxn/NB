// 逻辑检查（第一条：痛点-解法错位）
//
// 为什么不能纯靠规则：稿子提了「怕得罪人」，解法却治的是「不知道说什么」——
// 形式上完全合格，关键词一个不漏。规则看不出「治错了病」，这是语义问题。
//
// 为什么不能让模型整篇自由发挥：直接问「这篇逻辑通不通」，它必瞎编。
// 所以规则先把范围缩到「提了问题的地方」和「给了办法的地方」，
// 只把这几段交给模型，问一个具体到答不出花样的问题：
// 「他提了哪些问题？他给的办法治的是哪个？有没有提了但没人回应的？」
//
// 三道闸门保证不瞎报：
//   1. 模型必须引用原句，且引用必须真的能在正文里找到（找不到就是编的，丢掉）
//   2. 只问一个问题，不问「逻辑通不通」（太宽，模型必编）
//   3. 报出来的挂进现有标记体系，跟 AI 味检查共用一个界面

// 问题信号：疑问句，以及短视频里常见的「是不是 / 有没有 / 会不会」式自问。
const problemMarkers = ['是不是', '有没有', '会不会', '到底', '为什么', '很多人', '大多数人', '自不自然', '得不得罪']

// 办法信号：给解法、给方法、给判断的地方。
const remedyMarkers = ['你需要', '你要', '我的方法', '我后来', '我把', '核心是', '核心就', '关键是', '关键就', '第一步', '方法是', '解决办法', '我有一个判断', '我是先']

// 按句切开。中文短视频的句子边界就是这几个标点，不需要更复杂的分句器。
export function splitSentences(body) {
  return String(body || '')
    .split(/(?<=[。！？!?；;\n])/)
    .map(text => text.trim())
    .filter(Boolean)
}

const markerHits = (text, markers) => markers.filter(marker => text.includes(marker))

// 圈出「提了问题」和「给了办法」的句子。返回整句，不返回片段——
// 片段脱离上下文，模型反而更容易误判。
export function logicSignalSpans(body) {
  const problems = []
  const remedies = []
  for (const sentence of splitSentences(body)) {
    if (/[？?]/.test(sentence) || markerHits(sentence, problemMarkers).length) problems.push(sentence)
    if (markerHits(sentence, remedyMarkers).length) remedies.push(sentence)
  }
  return { problems, remedies, shouldCheck: Boolean(problems.length && remedies.length) }
}

export const logicCheckCode = 'problem_remedy_mismatch'

// 提示词和变量分开交，跟项目里其他 skill 一个形状：
// generateStructured(request, logicCheckSystemPrompt, logicCheckVariables(body))。
export const logicCheckSystemPrompt = [
    '你在给一条已经写好的短视频口播稿挑逻辑毛病，只挑一种：',
    '作者提出了问题，但后面给出的办法，治的是另一个问题。',
    '',
    '要求：',
    '- 只报「提了、但整篇都没人回应」的问题。回应了就不算，换个说法回应了也算回应。',
    '- 每一条必须逐字引用正文里的原句，不能改写、不能拼接。引用不到原句就不要报。',
    '- 指不出具体是哪个问题没人管的，一律不报。',
    '- 最多报两条。宁可不报，也不要凑。',
    '- 短视频本来就有省略和跳跃，两句之间没有论证不算毛病。只有「治错了病」才算。',
    '',
    '只输出 JSON，不要解释，不要代码块围栏：',
    '{"findings":[{"problem":"没人回应的问题，逐字引用原句","remedy":"作者给的办法治的是什么，一句话","explain":"为什么说这个办法治的不是它，一句话"}]}',
    '没有问题就输出 {"findings":[]}',
]

// 正文和圈出来的两类句子一起交给模型。规则已经缩过范围，模型只需要在圈内判断。
export function logicCheckVariables(body, spans = logicSignalSpans(body)) {
  return { body, problems: spans.problems, remedies: spans.remedies }
}

// 从可能带代码块或前后废话的回复里抠出 JSON。模型经常不听话，这里宽容一点。
function extractJson(content) {
  const text = String(content || '').replace(/```(?:json)?/gi, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

// 解析模型返回，并把编造的引用丢掉。
// 引用必须真的在正文里——这一条是整套设计里最要紧的闸门：
// 模型最常见的失败不是答错，是把「我认为的问题」写成「原文里的话」。查一遍就能拦住。
//
// 解析不出来时抛错（返回空数组是错的）：返回空数组等于把「模型输出坏了」压成「模型说没问题」，
// 上层 runLogicCheck 于是写 status: 'passed'，界面显示「已通过」——用户把「没查成」读成「查过没问题」。
// 假阴性比假阳性危险，所以「没查成」必须是一条错误，不能是一个正常结果。
// 这个约定和 claims / deconstruct / 定位 / 选题的 parseXxx 一致（它们也是抛错，路由转 502）。
//
// reported 是模型一共报了几条，unverifiable 是其中「引用对不上正文」被丢掉的条数。
// 两个数都要露出来：上层要拿它们把「丢了几条、为什么丢」说出来。
// 只返回 findings 的话，被丢掉的条目在界面上完全不可见——用户分不清「模型没报」和「报了但被丢」。
export function parseLogicOutput(content, body) {
  const parsed = extractJson(content)
  if (!parsed || !Array.isArray(parsed.findings)) throw Object.assign(new Error('模型这次没给出可解析的结果，重试一次通常就好。'), { code: 'MODEL_OUTPUT_INVALID' })
  const items = parsed.findings
  const source = String(body || '')
  const findings = []
  let unverifiable = 0
  for (const item of items) {
    const quote = String(item?.problem || '').trim()
    // 引用不到原句的：按「编的」丢掉。丢掉的条数要单独数出来，下面要报给用户。
    if (!source.includes(quote)) { unverifiable += 1; continue }
    // 一句话太短算不上「一个问题」，太长的多半是把整段抄回来了。
    if (quote.length < 4 || quote.length > 120) continue
    if (findings.some(finding => finding.quote === quote)) continue
    findings.push({
      code: logicCheckCode,
      // 跟 DraftCheck.evidence 的形状对齐（前端按 severity 上色）。
      severity: 'warning',
      // 措辞只说这条的性质，不提具体功能——避免提示指向一个做不到的操作。
      message: `提出了「${quote}」，但正文给出的办法治的是另一件事：${String(item?.explain || item?.remedy || '').trim() || '后文没有回应它'}`,
      quote,
      // 问题本身指得出原句，所以能定位；改法是补一段回应，用户能自己去改。
      scope: 'locatable',
    })
    if (findings.length >= 2) break
  }
  return { findings, reported: items.length, unverifiable }
}

// 只取 findings 的旧形状，调用点（skill 路由、测试）不动。
export function parseLogicFindings(content, body) {
  return parseLogicOutput(content, body).findings
}
