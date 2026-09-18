import { draftVideoFormats } from './draft-writing.mjs'

// 形式集合从写作层导入，避免诊断说「长视频」、写作层只认另外几个词这种漂移。
export const contentForms = [...Object.keys(draftVideoFormats), '长文']

export const contentFormSystemPrompt = [
  '你是形式匹配助手。给一个选题挑一种形式，只输出 JSON，不要任何解释文字。',
  `返回结构：{"form":"...","reason":"..."}。form 只能从这几个里选：${contentForms.join('、')}。`,
  '匹配表：只讲一个判断、要快速触达的用短视频；需要两三个场面或判断撑起信任的用中视频；要完整拆一层逻辑、值得看完的用长视频；需要长篇论证给搜索和转发看的用长文。',
  'reason 一句话，说清为什么是这个形式而不是别的。',
]
  .join('\n')

export function parseFormJudgement(content) {
  const parsed = JSON.parse(content)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('模型返回不是对象')
  const form = String(parsed.form ?? '').trim()
  if (!contentForms.includes(form)) throw new Error(`模型返回的形式不在可用范围内：${form || '空'}`)
  const reason = String(parsed.reason ?? '').trim()
  if (!reason) throw new Error('模型返回缺少推荐理由')
  return { form, reason }
}
