// 提主张：移植 dbs-resonate 前两步——把素材里的主张提取干净，再找串起它们的核心机制。
// 产出三栏（核心判断 / 适用范围 / 为什么重要）+ 主张清单 + 核心机制。

import { parseClaimsOutput } from './claim-logic.mjs'
import { modelJson } from './model-json.mjs'

export const claimsSystemPrompt = [
  '你是主张提炼助手。从用户给的素材里把主张提取干净，只输出 JSON，不要任何解释文字。',
  '返回结构：{"claims":["素材里真说过的主张，逐条列出"],"mechanism":"把这些主张串起来的核心机制","judgement":"核心判断：一句话说清这篇要立什么","scope":"适用范围：什么情况下成立","why":"为什么重要"}。',
  'claims 只放素材里真说了的，没说的不要补。一条也提不出来就返回空数组，不要替它编一个。',
]
  .join('\n')

// 超过两条就该收窄，但只提示不拦——硬拦会逼着使用者删掉真主张。
export const recommendedClaimCount = 2

export function parseClaims(content, angles = []) {
  const parsed = modelJson(content)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('模型返回不是对象')
  const text = value => String(value ?? '').trim()
  // 每条主张带自己的角度：一次跑一对角度（如 老板 / 员工），两条线不能糊成一团。
  const items = parseClaimsOutput(content, angles)
  const claims = items.map(item => item.text)
  const judgement = text(parsed.judgement)
  // 只在「提到了主张却没给核心判断」时报错。
  // 一条都没提到时允许没有判断：反驳式的第二角度确实可能回答"这个角度提不出不同说法"，
  // 那不是模型坏了，是这条素材没有角度差异——之前这里一律抛错，接口就变成 502。
  const rawClaims = Array.isArray(parsed.claims) ? parsed.claims : []
  if (!judgement && rawClaims.length) throw new Error('模型返回缺少核心判断')
  const notice = !claims.length
    ? '这段素材里没有提取到可检验的主张，没有替它编一个。'
    : claims.length > recommendedClaimCount
      ? `提取到 ${claims.length} 条主张，超过建议的 ${recommendedClaimCount} 条：建议收窄到一两条再往下走，但仍可入库。`
      : null
  return { claims, claim_items: items, mechanism: text(parsed.mechanism), judgement, scope: text(parsed.scope), why: text(parsed.why), notice }
}

// 一对角度 = 两次模型调用（每次只问一个角度）。
// 为什么不在一次调用里要两个角度：真模型实测会把两条主张都标成第一个角度，
// 于是"反方"直接为空——这个设计的意义就没了。分开问，角度归属就不会串。
export function mergeClaimRuns(results, angles = []) {
  const items = []
  for (const result of results) {
    for (const item of result.claim_items || []) {
      if (!items.some(existing => existing.text === item.text)) items.push(item)
    }
  }
  const claims = items.map(item => item.text)
  const head = results[0] || { mechanism: '', judgement: '', scope: '', why: '' }
  const notice = !claims.length
    ? '这段素材里没有提取到可检验的主张，没有替它编一个。'
    : claims.length > recommendedClaimCount
      ? `提取到 ${claims.length} 条主张，超过建议的 ${recommendedClaimCount} 条：建议收窄到一两条再往下走，但仍可入库。`
      : null
  // 核心判断取主角度那一次的：它是「我要立的那个判断」，两个角度各给一条反而没法用。
  // 另一次的四段式全在 per_angle 里，界面上按角度分组显示，不丢信息。
  return {
    claims,
    claim_items: items,
    mechanism: head.mechanism,
    judgement: head.judgement,
    scope: head.scope,
    why: head.why,
    notice,
    per_angle: results.map((result, index) => ({ angle: angles[index] || '', judgement: result.judgement, mechanism: result.mechanism, scope: result.scope, why: result.why, claims: result.claims })),
  }
}
