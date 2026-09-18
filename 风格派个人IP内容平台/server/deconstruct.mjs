// 拆概念：移植 dbs-deconstruct 的维特根斯坦式审查。
// 四段式产出（你以为它是什么 / 不同场景的用法 / 概念还原 / 大白话）+ 判定 Question 还是 Problem。

export const deconstructSystemPrompt = [
  '你是概念拆解助手。对用户给的概念词做维特根斯坦式审查，只输出 JSON，不要任何解释文字。',
  '返回结构：{"assumed":"你以为它是什么","usages":["不同场景下这个词各自的用法"],"restored":"概念还原：去掉误用之后它真正指什么","plain":"用大白话说给完全外行听","kind":"question|problem"}。',
  'usages 至少两条，必须是具体场景里的用法，不能是词典释义。',
  'kind 只能二选一：概念不清、不同人说的其实不是同一件事的，判 question；边界清楚、能直接动手解决的，判 problem。',
]
  .join('\n')

export const deconstructionKinds = ['question', 'problem']

// Question 是概念没对齐，产出物是还原后的概念（CON）；Problem 是边界清楚的具体问题（QST）。
const unitTypeOfKind = { question: 'CON', problem: 'QST' }

export function parseDeconstruction(content) {
  const parsed = JSON.parse(content)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('模型返回不是对象')
  const text = value => String(value ?? '').trim()
  const usages = (Array.isArray(parsed.usages) ? parsed.usages : []).map(text).filter(Boolean)
  if (!text(parsed.restored)) throw new Error('模型返回缺少概念还原')
  const kind = deconstructionKinds.includes(parsed.kind) ? parsed.kind : 'question'
  return {
    assumed: text(parsed.assumed),
    usages,
    restored: text(parsed.restored),
    plain: text(parsed.plain),
    kind,
    unit_type: unitTypeOfKind[kind],
  }
}
