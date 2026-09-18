// Requirement 13：结构层接入 dbs-script-flow 的逻辑延续检查。
//
// 三步照搬源技能：分段 → 逐段扫描三维 → 标注风险等级。
// 风险等级沿用同一套三档词汇（强 / 中 / 弱 = 源技能的 🔴 / 🟡 / 🟢）：
// 两层的等级含义一致，没必要在界面上给用户两套说法。
//
// 只做确定性可判的形态。源技能里的「段落主题」要读懂语义，规则判不出来，
// 这里留 null 不编一个像主题的字符串——占位比烂实现好。
export const structureDimensions = { transition: '逻辑衔接', density: '信息密度', fluency: '口播流畅度' }

// 段间承接信号：连接词、指代、回指。都没有就可能是跳跃。
const transitionPattern = /^(?:所以|但是|可是|不过|而且|然后|接下来|这就|这时候|因此|因为|另外|其实|说白了|问题是|结果|后来|最后|第一|第二|第三)|(?:前面|上面|刚刚|刚才|这一点|这件事)/
// 源技能：超过 30 字的单句要警惕（一口气念不出来）。
// 导出给 hook-diagnosis 用：口播友好是同一把尺子，不抄第二份。
export const longSentenceLimit = 30
// 源技能给的书面语例子。
export const writtenPhrasePattern = /(?:针对|鉴于|基于以上|综上所述|与此同时|值得注意的是|众所周知)/
// 自问自答：问句后紧跟一句解释。源技能说偶尔可以、连续用会烦，所以一段里出现两次才标。
const selfAnswerPattern = /[？?][^。？！?！\n]{0,40}(?:其实|而是|只因)/g
const sentenceSplit = /(?<=[。！？!?])/
const riskRank = { strong: 3, medium: 2, weak: 1 }

export const structureSentencesOf = text => String(text || '').split(sentenceSplit).map(item => item.trim()).filter(Boolean)

export const structureSegmentsOf = body => String(body || '').split(/\n\s*\n/).map(text => text.trim()).filter(Boolean)

// 段落功能：只有位置能确定的是开场与结尾。中间段在讲什么要读懂内容，不猜。
export function structureRoleOf(index, total) {
  if (total === 1) return '单项'
  if (index === 0) return '开场'
  if (index === total - 1) return '结尾'
  return null
}

function characterBigrams(text) {
  const clean = String(text || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
  const out = new Set()
  for (let index = 0; index + 1 < clean.length; index += 1) out.add(clean.slice(index, index + 2))
  return out
}

// 两句高度重叠 = 说的是同一件事。段间用它判「还在同一话题上」，段内用它判重复。
export function overlapsHeavily(left, right) {
  const a = characterBigrams(left)
  const b = characterBigrams(right)
  if (a.size < 4 || b.size < 4) return false
  let shared = 0
  for (const item of a) if (b.has(item)) shared += 1
  return shared / Math.min(a.size, b.size) >= 0.6
}

export function structureReport({ body } = {}) {
  const bodyText = String(body || '')
  const findings = []
  let cursor = 0
  const segments = structureSegmentsOf(body).map((text, index, all) => {
    const start = bodyText.indexOf(text, cursor)
    const position = start >= 0 ? start : cursor
    cursor = position + text.length
    return { index: index + 1, text, position, role: structureRoleOf(index, all.length), sentences: structureSentencesOf(text) }
  })

  segments.forEach((segment, index) => {
    // 维度 1：逻辑衔接（前后段之间）。
    if (index > 0) {
      const previous = segments[index - 1]
      const tail = previous.sentences[previous.sentences.length - 1] || previous.text
      const head = segment.sentences[0] || segment.text
      if (!transitionPattern.test(head) && !overlapsHeavily(tail, head)) {
        findings.push({ code: 'structure_jump', dimension: 'transition', risk: 'medium', segment: segment.index, position: segment.position, quote: head, note: `第 ${previous.index} 段和第 ${segment.index} 段之间没有承接信号，观众可能在这里跟不上`, fix: `在第 ${previous.index} 段末尾补一句过渡，或把这一段的开口改成承接上一段的说法` })
      }
    }
    // 维度 2：信息密度（段落内部）。
    for (let left = 0; left < segment.sentences.length; left += 1) {
      const duplicate = segment.sentences.slice(left + 1).find(sentence => overlapsHeavily(segment.sentences[left], sentence))
      if (!duplicate) continue
      findings.push({ code: 'structure_repeat', dimension: 'density', risk: 'medium', segment: segment.index, position: segment.position + Math.max(0, segment.text.indexOf(duplicate)), quote: duplicate, note: `第 ${segment.index} 段里这句和前面说的是同一件事，信息密度掉了`, fix: '删掉重复的表述，只留最有力的一种' })
      break
    }
    // 维度 3：口播流畅度（句子级别）。
    segment.sentences.forEach(sentence => {
      const length = sentence.replace(/\s/g, '').length
      const position = segment.position + Math.max(0, segment.text.indexOf(sentence))
      if (length > longSentenceLimit) findings.push({ code: 'structure_long_sentence', dimension: 'fluency', risk: 'weak', segment: segment.index, position, quote: sentence, note: `这句 ${length} 字，一口气念不完`, fix: '拆成两句，中间断一下' })
      const written = sentence.match(writtenPhrasePattern)
      if (written) findings.push({ code: 'structure_written_word', dimension: 'fluency', risk: 'weak', segment: segment.index, position, quote: sentence, note: `这句里有书面套语「${written[0]}」，念出来像在念稿`, fix: '换成平常会说的说法' })
    })
    const selfAnswers = segment.text.match(selfAnswerPattern) || []
    if (selfAnswers.length >= 2) findings.push({ code: 'structure_self_answer', dimension: 'fluency', risk: 'medium', segment: segment.index, position: segment.position, quote: selfAnswers[0], note: `这一段连续用了 ${selfAnswers.length} 次自问自答，观众会觉得烦`, fix: '留一次自问自答，其余改成直接说' })
  })

  const statusOf = index => findings.filter(item => item.segment === index).reduce((best, item) => ((riskRank[item.risk] || 0) > (riskRank[best] || 0) ? item.risk : best), 'passed')
  return {
    segments: segments.map(segment => ({ index: segment.index, role: segment.role, quote: segment.sentences[0] || segment.text, length: segment.text.length, status: statusOf(segment.index) })),
    findings,
  }
}
