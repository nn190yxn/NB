// 提主张：移植 dbs-resonate 前两步——把素材里的主张提取干净，再找串起它们的核心机制。
// 产出三栏（核心判断 / 适用范围 / 为什么重要）+ 主张清单 + 核心机制。

export const claimsSystemPrompt = [
  '你是主张提炼助手。从用户给的素材里把主张提取干净，只输出 JSON，不要任何解释文字。',
  '返回结构：{"claims":["素材里真说过的主张，逐条列出"],"mechanism":"把这些主张串起来的核心机制","judgement":"核心判断：一句话说清这篇要立什么","scope":"适用范围：什么情况下成立","why":"为什么重要"}。',
  'claims 只放素材里真说了的，没说的不要补。一条也提不出来就返回空数组，不要替它编一个。',
]
  .join('\n')

// 超过两条就该收窄，但只提示不拦——硬拦会逼着使用者删掉真主张。
export const recommendedClaimCount = 2

export function parseClaims(content) {
  const parsed = JSON.parse(content)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('模型返回不是对象')
  const text = value => String(value ?? '').trim()
  const claims = (Array.isArray(parsed.claims) ? parsed.claims : []).map(text).filter(Boolean)
  const judgement = text(parsed.judgement)
  if (!judgement) throw new Error('模型返回缺少核心判断')
  const notice = !claims.length
    ? '这段素材里没有提取到可检验的主张，没有替它编一个。'
    : claims.length > recommendedClaimCount
      ? `提取到 ${claims.length} 条主张，超过建议的 ${recommendedClaimCount} 条：建议收窄到一两条再往下走，但仍可入库。`
      : null
  return { claims, mechanism: text(parsed.mechanism), judgement, scope: text(parsed.scope), why: text(parsed.why), notice }
}
