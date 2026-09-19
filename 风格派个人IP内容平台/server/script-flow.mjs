// 移植 dbs-script-flow（v1.1）的三维逐字稿检查：段落衔接 / 信息密度 / 口播流畅。
//
// 与源技能的差别，是平台既有的红线：源技能拿「观众会在哪一秒划走」当说法，
// 而这一步的产出跟共鸣报告一样只给人看、不拦发布（不写 checks、不改 workflow_status、不动 approval），
// 所以这里只描述文稿本身（哪一段到哪一段缺过渡、哪句念不出来），
// 不预测完播率/点击率/推荐量——那是平台指标，判不了也不该拿来当结论。
//
// 规则判得出「有多少处长句、多少处书面语、哪里在重复」，判不出「这一跳到那一段是不是断了」；
// 前者用规则先数出来喂给模型，后者交给模型，每条结论都必须指向原句，指不到就整条不要。
//
// 来源：dbs-script-flow（CC BY-NC 4.0，dontbesilent2025/dbskill）。三维检查法逐条对应源技能第二步。

export const scriptFlowAxes = [
  { id: 'continuity', label: '段落衔接', verdicts: ['断裂', '勉强', '成立'], question: '上一段的最后一句和这一段的第一句之间，缺不缺一句承上启下' },
  { id: 'density', label: '信息密度', verdicts: ['塌陷', '偏松', '合适'], question: '这一段在重复前面说过的、或绕圈子，还是每句都在推进' },
  { id: 'spoken', label: '口播流畅', verdicts: ['拗口', '偏书面', '顺'], question: '这句话能不能一口气念出来，有没有术语和自问自答堆着' },
]

// 源技能的标准：超过 30 字的单句要警惕。
const longSentenceLimit = 30
// 书面语词表：口播稿里念出来会卡的字眼。
const writtenStyleWords = ['针对', '鉴于', '基于以上', '综上所述', '与此同时', '值得注意的是', '换言之', '一定程度上', '在此基础', '从而', '以便', '予以', '加以', '进一步而言']
const questionTailPattern = /[吗呢吧]\s*[？?]\s*$/

function text(value) { return String(value ?? '').trim() }

// 分段按空行切：源技能要求先分段，再逐段扫三个维度。
export function scriptFlowSegments(body) {
  const blocks = text(body).split(/\n\s*\n/)
  const segments = []
  for (const block of blocks) {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean)
    // 镜头提示、「标题：」这类结构行不算内容，跟共鸣报告同一套跳过规则。
    const contentLines = lines.filter(line => !/^(#{1,6}\s*|标题[:：]|正文[:：])/.test(line) && !/^[（(][^）)]*[）)]$/.test(line))
    if (!contentLines.length) continue
    const joined = contentLines.join(' ')
    segments.push({ index: segments.length + 1, chars: joined.length, opening: joined.slice(0, 40) })
  }
  return segments
}

function sentences(body) {
  return text(body)
    .split(/\n+/)
    .map(line => line.trim())
    .filter(line => line && !/^(#{1,6}\s*|标题[:：]|正文[:：])/.test(line))
    .flatMap(line => line.split(/(?<=[。！？；])/).map(item => item.trim()))
    .filter(Boolean)
}

export function longSentences(body) {
  return sentences(body).filter(sentence => sentence.replace(/\s/g, '').length > longSentenceLimit)
}

export function writtenStyleHits(body) {
  return sentences(body).filter(sentence => writtenStyleWords.some(word => sentence.includes(word)))
}

// 自问自答：连续出现才是问题——源技能写的是「偶尔可以，连续用会烦」。
export function selfAnsweredPositions(body) {
  const list = sentences(body)
  const positions = []
  for (let index = 0; index < list.length - 1; index += 1) {
    if (questionTailPattern.test(list[index]) || /[？?]$/.test(list[index])) positions.push(index + 1)
  }
  return { count: positions.length, sentences: positions.map(index => index).length, sample: positions.slice(0, 3).map(index => list[index - 1]).filter(Boolean) }
}

// 重复表述：短句按整句比（抓原样重复），长句按前 8 个字比（抓「换了说法讲同一件事」）。
// 长度门槛只用来挡「好的」「然后」这种口头溢出的碎片，不能把整句重复也挡掉——
// 门槛定在 6 个字时，「素材要拆解」这类 5 字短句的重复会全部漏掉（写测试时踩到）。
const repeatMinChars = 4
export function repeatedSentences(body) {
  const list = sentences(body)
  const buckets = new Map()
  for (const sentence of list) {
    const normalized = sentence.replace(/[，。！？；、\s]/g, '')
    if (normalized.length < repeatMinChars) continue
    const key = normalized.length > 8 ? `前缀:${normalized.slice(0, 8)}` : `整句:${normalized}`
    buckets.set(key, (buckets.get(key) || 0) + 1)
  }
  const repeated = [...buckets.entries()].filter(([, count]) => count > 1).map(([key]) => key.replace(/^(整句|前缀):/, ''))
  return { count: repeated.length, sample: repeated.slice(0, 4) }
}

export function scriptFlowSignals(body) {
  const segments = scriptFlowSegments(body)
  const longs = longSentences(body)
  const written = writtenStyleHits(body)
  const repeated = repeatedSentences(body)
  return {
    segment_count: segments.length,
    segments,
    long_sentence_count: longs.length,
    long_sentence_sample: longs.slice(0, 3).map(item => item.slice(0, 60)),
    written_style_count: written.length,
    written_style_sample: written.slice(0, 3).map(item => item.slice(0, 60)),
    repeated_count: repeated.count,
    repeated_sample: repeated.sample,
    segment_char_range: segments.length ? { min: Math.min(...segments.map(item => item.chars)), max: Math.max(...segments.map(item => item.chars)) } : null,
  }
}

export function scriptFlowPrompt({ platform, topic, body, signals }) {
  const axisLines = scriptFlowAxes.map(item => `${item.id}（${item.label}）：${item.question}。判定只能是 ${item.verdicts.join(' / ')}`).join('\n')
  const segmentLines = signals.segments.length
    ? signals.segments.map(item => `第 ${item.index} 段（${item.chars} 字）：${item.opening}${item.chars > 40 ? '…' : ''}`).join('\n')
    : '（没分出段落，按一整段处理）'
  const signalLines = [
    `超过 ${longSentenceLimit} 字的单句：${signals.long_sentence_count} 处${signals.long_sentence_sample.length ? `（例：${signals.long_sentence_sample.join(' / ')}）` : ''}`,
    `书面语字眼：${signals.written_style_count} 处${signals.written_style_sample.length ? `（例：${signals.written_style_sample.join(' / ')}）` : ''}`,
    `重复表述（前 8 字相同的句子）：${signals.repeated_count} 处${signals.repeated_sample.length ? `（例：${signals.repeated_sample.join(' / ')}）` : ''}`,
  ].join('\n')

  return {
    system: `你在检查${platform}口播稿的读下去顺不顺。用的是逐字稿逻辑延续检查法，只看文稿本身。\n\n按段落逐段扫三个维度：\n${axisLines}\n\n硬规矩：\n1. 只说文稿本身。不预测完播率、点击率、推荐量，不说「观众会划走」这类平台表现的话——判不了，也不该拿来当结论。\n2. 每条结论必须指向文稿里的具体原句，evidence 里放原文原句；指不到就整条不要出。\n3. segment 只能填上面给出的段落号；说不出属于哪一段的整条丢掉。\n4. 每个问题的 fix 给最小修改动作（加一句过渡、删哪句、拆成两句、术语后补一句大白话），不要重写整段。\n5. 只输出 JSON，不要解释、不要代码块。\n\n输出格式：\n{\n  "findings": [{ "axis": "${scriptFlowAxes.map(item => item.id).join('" | "')}", "segment": 1, "verdict": "该维度允许的判定之一", "evidence": "文稿里的原句", "detail": "一句话说明", "fix": "最小修改动作" }],\n  "fixes": { "cut": ["删哪句"], "merge": ["哪两段可以合并"], "transition": ["哪两段之间补一句过渡"], "rewrite": ["哪句拆开或改成大白话"] }\n}`,
    user: `话题：${topic || '（没写话题）'}\n\n分段：\n${segmentLines}\n\n规则先数出来的信号（供你判断，不用复述）：\n${signalLines}\n\n正文：\n${body}`,
  }
}

// 源技能要求每条结论都关联具体文字、判定落在允许的三档内、问题能落到某一段；
// 对不上的整条丢掉，不替它编。fix 空着的也算数，但会被标出来让界面提示。
export function parseScriptFlowResponse(content, { signals } = {}) {
  const raw = text(content).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  let parsed = null
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const byId = new Map(scriptFlowAxes.map(item => [item.id, item]))
  const segmentCount = Array.isArray(signals?.segments) ? signals.segments.length : 0
  const findings = []
  for (const entry of Array.isArray(parsed.findings) ? parsed.findings : []) {
    const axis = byId.get(text(entry?.axis))
    const evidence = text(entry?.evidence)
    const verdict = text(entry?.verdict)
    const segment = Number(entry?.segment)
    if (!axis || !evidence || !axis.verdicts.includes(verdict)) continue
    if (!Number.isInteger(segment) || segment < 1 || (segmentCount && segment > segmentCount)) continue
    findings.push({ axis: axis.id, axis_label: axis.label, segment, verdict, evidence, detail: text(entry?.detail), fix: text(entry?.fix) })
  }
  const fixes = parsed.fixes && typeof parsed.fixes === 'object' ? parsed.fixes : {}
  const fixList = key => (Array.isArray(fixes[key]) ? fixes[key].map(text).filter(Boolean) : [])
  return {
    findings,
    axis_counts: scriptFlowAxes.reduce((counts, axis) => ({ ...counts, [axis.id]: findings.filter(item => item.axis === axis.id).length }), {}),
    fixes: { cut: fixList('cut'), merge: fixList('merge'), transition: fixList('transition'), rewrite: fixList('rewrite') },
    measured: signals || null,
  }
}
