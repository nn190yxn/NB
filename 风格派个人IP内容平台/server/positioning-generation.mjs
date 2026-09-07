import { createHash } from 'node:crypto'

export function interviewInput(doc) {
  return { answers: Object.fromEntries(['0', '1', '2'].map(key => [key, String(doc.interview_answers?.[key] || '').trim()])), monetization_goals: doc.monetization_goals || [], acquisition_goals: doc.acquisition_goals || [] }
}
export function interviewDigest(doc) { return createHash('sha256').update(JSON.stringify(interviewInput(doc))).digest('hex') }
const text = (value, required = true) => {
  if (typeof value !== 'string' || value.length > 1000 || (required && !value.trim())) throw new Error('模型输出字段无效，请重试')
  return value.trim()
}
const list = value => {
  if (!Array.isArray(value) || value.length > 10) throw new Error('模型输出列表无效，请重试')
  return value.map(item => text(item))
}
export function parsePositioning(content, doc) {
  const result = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
  if (!Array.isArray(result) || result.length !== 3) throw new Error('模型必须返回三个定位建议')
  return result.map(item => {
    const evidence = list(item.answer_refs)
    if (!evidence.length || evidence.some(key => !['0', '1', '2'].includes(key) || !interviewInput(doc).answers[key])) throw new Error('定位建议缺少有效访谈依据')
    return { name: text(item.name), positioning_statement: text(item.positioning_statement), audiences: list(item.audiences), problems: list(item.problems), pillars: list(item.pillars), uncertainties: list(item.uncertainties), answer_refs: evidence }
  })
}
export function fillProfile(profile, candidate, now) {
  const updates = { role: candidate.name, audiences: candidate.audiences, problems: candidate.problems, pillars: candidate.pillars }
  const next = structuredClone(profile)
  const history = []
  for (const [field, value] of Object.entries(updates)) {
    const previous = next[field]
    const empty = previous == null || (typeof previous === 'string' && !previous.trim()) || (Array.isArray(previous) && !previous.length)
    if (empty && value?.length) { next[field] = value; history.push({ field, previous: previous ?? null, next: value, created_at: now, source_refs: candidate.source_refs }) }
  }
  if (history.length) { next.history = [...(next.history || []), ...history]; next.version = (next.version || 1) + 1; next.updated_at = now; next.source_refs = [...(next.source_refs || []), ...(candidate.source_refs || [])] }
  return next
}
export function parseTopics(content, refs) {
  const result = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
  if (!Array.isArray(result) || result.length < 1 || result.length > 5) throw new Error('模型选题数量无效')
  return result.map(item => {
    if (!['reach', 'trust', 'conversion'].includes(item.strategy_layer)) throw new Error('选题策略无效')
    if (!Array.isArray(item.source_indexes) || !item.source_indexes.length || item.source_indexes.some(index => !Number.isInteger(index) || !refs[index])) throw new Error('选题缺少有效来源')
    return { title: text(item.title), rationale: text(item.rationale), content_job: text(item.content_job), strategy_layer: item.strategy_layer, source_refs: [...new Set(item.source_indexes)].map(index => refs[index]) }
  })
}
