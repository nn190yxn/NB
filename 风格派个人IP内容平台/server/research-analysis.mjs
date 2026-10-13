// 热点拆解成可复用的爆款方法（批次 5 / 取代之前写死的那份假分析）。
//
// 之前这个接口不管收到什么条目，都返回同一份写死的分析——连置信度都是固定的 0.86。
// 那不是"没数据"，那是伪装成数据：用户点一下按钮，拿到一份看起来很专业的结论，
// 而它跟这条热点没有任何关系。现在改成：真让模型看这条热点，没配模型就直接失败说清楚。

export const researchAnalysisPrompt = [
  '你是爆款方法拆解助手。根据给到的一条热点，拆出可复用的写法结构。只输出 JSON，不要解释。',
  '返回结构：{"hook":"这条为什么能让人停下","audience":"它在对谁说话","pain_point":"它戳中的具体问题","thesis":"它立的那个判断","structure":["按文本顺序的段落功能，3 到 6 条"],"quotes":["它里面真出现过或能从素材里读出的说法，没有就给空数组"],"cta":"它结尾要人做的事","transferable_patterns":["换个账号也能照抄的写法，不是它的话题"],"confidence":0 到 1 之间的小数}。',
  '只能依据给到的标题、作者、平台与热度数据。素材里没有的引语不要编，quotes 给空数组比编一条好。',
  'confidence 表示你有多确信这份拆解对得上这条热点，而不是这条热点有多好。信息太少就给低值，不要一律 0.86。',
].join('\n')

const list = value => (Array.isArray(value) ? value.map(item => String(item ?? '').trim()).filter(Boolean).slice(0, 8) : [])

export function researchAnalysisVariables(item) {
  return {
    title: String(item?.title || '').slice(0, 300),
    platform: String(item?.platform || '').slice(0, 40),
    author: String(item?.author || '').slice(0, 80),
    metrics: item?.metrics || { discussions: 0, growth: 0 },
    url: item?.url || null,
  }
}

import { modelJson } from './model-json.mjs'

export function parseResearchAnalysis(content) {
  const parsed = modelJson(content)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('拆解结果不是对象')
  const text = value => String(value ?? '').trim()
  const thesis = text(parsed.thesis)
  if (!thesis) throw new Error('拆解结果缺少它立的那个判断')
  const structure = list(parsed.structure)
  if (!structure.length) throw new Error('拆解结果没有段落结构，这样的分析对写稿没用')
  const raw = Number(parsed.confidence)
  // 越界一律夹到 0–1：0 是合法值（模型如实说没把握），所以不能用 `||` 兜底。
  const confidence = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : null
  return {
    hook: text(parsed.hook),
    audience: text(parsed.audience),
    pain_point: text(parsed.pain_point),
    thesis,
    structure,
    quotes: list(parsed.quotes),
    cta: text(parsed.cta),
    transferable_patterns: list(parsed.transferable_patterns),
    confidence,
    analyzed_by: 'model',
  }
}
