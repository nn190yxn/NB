// Requirement 16 第 2 条：发布前内容层报告。移植 dbs-resonate 的五维共鸣诊断与 dbs-spread 的传播心理维度。
//
// 两个技能用的是同一批 1980 年前已被验证的经典传播学理论，所以合成一份五维报告：
// 每条同时给「诊断结论 + 指向哪句原文」和「传播解码」。按源技能注意事项执行：
// 不评价内容好坏、不预测平台表现、每条结论必须关联具体文字、综合推导必须注明来自哪个维度。
//
// 这份报告只给人看，不拦停发布：不写 checks、不改 workflow_status、不动 approval。

export const resonanceDimensions = [
  { id: 'silence', label: '沉默解除', theory: '沉默的螺旋 Noelle-Neumann 1974', question: '受众憋着不敢说的那句判断，内容有没有替他说出来' },
  { id: 'gratification', label: '满足动机', theory: '使用与满足 Katz 1959', question: '满足了身份认同、情绪宣泄、社交资本还是信息价值' },
  { id: 'framing', label: '立场框架', theory: '框架理论 Entman 1993', question: '内容站在谁那边，受众会不会觉得被代言' },
  { id: 'gateway', label: '传播入口', theory: '两级传播 Lazarsfeld 1944', question: '谁会第一个传出去，动机是什么' },
  { id: 'belief', label: '信念结构', theory: '认知一致性 Festinger 1957', question: '确认了受众什么信念，有没有触发行动冲动' },
]

export const resonanceVerdicts = ['有效', '弱', '无效']

// 「综合推导」的三条必须注明推导来源，只能来自这五个维度。
export const resonanceSynthesisFields = [
  { id: 'emotion_core', label: '受众情绪底层' },
  { id: 'effective_stance', label: '有效立场' },
  { id: 'audience_wants', label: '受众还想听什么' },
]

const claimMarkers = ['其实', '不是', '而是', '关键是', '本质上', '说到底', '真正', '说白了', '问题是', '意味着', '应该', '必须', '别再', '不要', '只会', '才算']

// 结构行不是观点：镜头提示、「标题：」「正文：」这类行先跳过。
function contentSentences(body) {
  const sentences = []
  for (const rawLine of String(body || '').split('\n')) {
    const line = rawLine.trim().replace(/^[（(][^）)]*[）)]\s*/, '')
    if (!line || /^(#{1,6}\s*|标题[:：]|正文[:：])/.test(line) || /^[^，。！？；]{1,6}[:：]$/.test(line)) continue
    for (const sentence of line.split(/(?<=[。！？；])/)) {
      const text = sentence.trim()
      if (text) sentences.push(text)
    }
  }
  return sentences
}

// 主张候选：带判断词的成句。规则判不了「说的是不是同一件事」，
// 只数得出「有几处判断」，多到三处以上就提示核心被稀释的风险，交给模型在报告里下判断。
export function claimCandidates(body) {
  const seen = new Set()
  const claims = []
  for (const sentence of contentSentences(body)) {
    if (!claimMarkers.some(marker => sentence.includes(marker))) continue
    const key = sentence.slice(0, 24)
    if (seen.has(key)) continue
    seen.add(key)
    claims.push(sentence)
    if (claims.length >= 6) break
  }
  return claims
}

export function coreMechanismCheck(body) {
  const claims = claimCandidates(body)
  const verdict = claims.length >= 3 ? 'diluted' : claims.length === 2 ? 'risk' : 'clear'
  const notes = {
    diluted: `数到 ${claims.length} 处判断，核心被稀释的风险高：源技能的做法是只留一处最有爆发力的，其余压成支撑材料。`,
    risk: `数到 2 处判断，可能各自在说一件事：确认它们服务的是不是同一个机制。`,
    clear: claims.length ? '只数到 1 处判断，核心大概率是清楚的。' : '没数到明确的判断句，内容可能只是在陈述事实，缺一个主张。',
  }
  return { verdict, claim_count: claims.length, claims, note: notes[verdict] }
}

export function resonancePrompt({ platform, topic, body, core }) {
  const dimensionLines = resonanceDimensions.map((item, index) => `${index + 1}. ${item.label}（${item.theory}）：${item.question}`).join('\n')
  const synthesisLines = resonanceSynthesisFields.map(item => `${item.id}（${item.label}）：{ "text": "一句话", "from": "推导来源的维度 id" }`).join('\n')
  return {
    system: `你在给${platform}内容做发布前的共鸣诊断，用的是传播心理学框架。\n\n只做五维判断：\n${dimensionLines}\n\n硬规矩：\n1. 不评价内容好坏，不打分，不预测完播率/点击率/推荐量。\n2. 每条结论必须指向文稿里的具体文字，evidence 里放原文原句；指不到就整条不要出。\n3. 五个维度各给一次判定，verdict 只能是「有效」「弱」「无效」。\n4. 「综合推导」三条各自要注明推导来源（上面五个维度之一的 id）。\n5. 只输出 JSON，不要解释、不要代码块。\n\n输出格式：\n{\n  "dimensions": [{ "id": "${resonanceDimensions.map(item => item.id).join('" | "')}", "verdict": "有效|弱|无效", "evidence": "文稿里的原句", "detail": "一句话说明" }],\n  "core": { "text": "这段内容的核心机制，一句话", "verdict": "明确|被稀释|不明确" },\n${synthesisLines.split('\n').map(line => `  "${line.split('（')[0]}": { "text": "一句话", "from": "维度 id" },`).join('\n')}\n  "fixes": { "cut": ["删掉哪句，为什么"], "compress": ["哪句压成支撑材料"], "strengthen": ["哪句是核心，怎么放大"] }\n}`,
    user: `话题：${topic || '（没写话题）'}\n\n规则判出的主张候选（供你判断核心有没有被稀释，不用复述）：${core.claims.length ? core.claims.join(' / ') : '没数到明确判断句'}\n\n正文：\n${body}`,
  }
}

function text(value) { return String(value ?? '').trim() }

// 源技能要求每条结论都关联具体文字，且判定只能是三档；对不上的整条丢掉，不替它编。
export function parseResonanceResponse(content, { core } = {}) {
  const raw = String(content || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  let parsed = null
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const byId = new Map(resonanceDimensions.map(item => [item.id, item]))
  const dimensions = []
  for (const entry of Array.isArray(parsed.dimensions) ? parsed.dimensions : []) {
    const dimension = byId.get(text(entry?.id))
    const evidence = text(entry?.evidence)
    const verdict = resonanceVerdicts.includes(text(entry?.verdict)) ? text(entry.verdict) : null
    // 指不到原文、判定不在三档内：这条不算数（源技能禁止空话结论）。
    if (!dimension || !evidence || !verdict) continue
    dimensions.push({ id: dimension.id, label: dimension.label, theory: dimension.theory, verdict, evidence, detail: text(entry?.detail) })
  }
  const known = new Set(dimensions.map(item => item.id))
  const synthesis = {}
  for (const field of resonanceSynthesisFields) {
    const entry = parsed[field.id]
    const from = text(entry?.from)
    synthesis[field.id] = { label: field.label, text: text(entry?.text), from: known.has(from) ? byId.get(from).label : null, from_id: known.has(from) ? from : null }
  }
  const fixes = parsed.fixes && typeof parsed.fixes === 'object' ? parsed.fixes : {}
  const fixList = key => (Array.isArray(fixes[key]) ? fixes[key].map(text).filter(Boolean) : [])
  return {
    dimensions,
    verdict_counts: { 有效: dimensions.filter(item => item.verdict === '有效').length, 弱: dimensions.filter(item => item.verdict === '弱').length, 无效: dimensions.filter(item => item.verdict === '无效').length },
    core: { verdict: text(parsed.core?.verdict) || '未判定', text: text(parsed.core?.text), measured: core || null },
    synthesis,
    fixes: { cut: fixList('cut'), compress: fixList('compress'), strengthen: fixList('strengthen') },
  }
}
