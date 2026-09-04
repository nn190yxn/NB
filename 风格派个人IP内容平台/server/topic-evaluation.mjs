const DIMENSIONS = [
  { key: 'traffic_potential', label: '流量潜力' },
  { key: 'account_fit', label: '账号匹配' },
  { key: 'competitive_differentiation', label: '竞争差异化' },
  { key: 'timeliness', label: '时效价值' },
  { key: 'monetization', label: '变现空间' },
  { key: 'production_cost', label: '制作成本' },
  { key: 'compliance_risk', label: '合规风险' },
]

const riskyTerms = ['第一', '最好', '最佳', '国家级', '绝对', '100%', '根治', '包赚', '稳赚', '史上最']

const clamp = value => Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)))
const text = value => String(value || '').trim()
const termsOf = value => (Array.isArray(value) ? value : []).map(text).filter(Boolean)
const matches = (title, terms) => terms.filter(term => title.includes(term))
const hasRecent = (items, days) => items.some(item => item.captured_at && Date.now() - new Date(item.captured_at).getTime() <= days * 86_400_000)

function dimension(key, score, evidence, suggestions = []) {
  return { key, score: clamp(score), evidence: evidence.filter(Boolean), suggestions: suggestions.filter(Boolean) }
}

export function scoreTopic(topic, context) {
  const title = text(topic.title)
  const research = context.research || []
  const materials = context.materials || []
  const structures = context.structures || []
  const profile = context.profile || {}
  const positioningTerms = [...termsOf(profile.pillars), ...termsOf(profile.problems), ...termsOf(profile.viewpoints), ...termsOf(profile.audiences)]
  const matchedPositioning = matches(title, positioningTerms)
  const researchMetrics = research.map(item => item.metrics || {}).filter(metrics => Number(metrics.discussions) > 0 || Number(metrics.growth) !== 0)
  const maxDiscussions = Math.max(0, ...researchMetrics.map(metrics => Number(metrics.discussions) || 0))
  const maxGrowth = Math.max(0, ...researchMetrics.map(metrics => Number(metrics.growth) || 0))
  const trafficEvidence = researchMetrics.length
    ? [`已选 ${researchMetrics.length} 条研究含热度数据：最高讨论 ${maxDiscussions}，最高增长 ${maxGrowth}%`]
    : ['当前来源没有可用的讨论量或增长数据，未推断热度']
  const trafficSuggestions = researchMetrics.length ? [] : ['补充带讨论量或增长数据的研究来源后重新评估']

  const fitScore = positioningTerms.length ? 45 + Math.min(45, matchedPositioning.length * 20) : 20
  const fitEvidence = positioningTerms.length
    ? [`IP 档案已提供 ${positioningTerms.length} 个定位相关词，标题命中 ${matchedPositioning.length} 个`]
    : ['IP 档案缺少可用于匹配的内容支柱、问题、观点或受众']

  const researchTitles = research.map(item => text(item.title)).filter(Boolean)
  const similarTitles = researchTitles.filter(other => other !== title && [...title].some(char => char.length > 0 && other.includes(char)))
  const differentiationScore = researchTitles.length ? 70 - Math.min(45, similarTitles.length * 15) : 45
  const differentiationEvidence = researchTitles.length
    ? [`已对比 ${researchTitles.length} 条研究标题，发现 ${similarTitles.length} 条可能相近的来源`]
    : ['没有竞品或同类研究标题，差异化只能做初步判断']

  const recent = hasRecent(research, 7)
  const datedResearch = research.filter(item => item.captured_at)
  const timelinessScore = recent ? 90 : datedResearch.length ? 55 : 30
  const timelinessEvidence = recent
    ? ['存在最近 7 天内捕获的研究来源']
    : datedResearch.length ? ['已有研究来源，但没有最近 7 天内的捕获记录'] : ['没有带捕获时间的研究来源']

  const goals = termsOf(context.strategy?.monetization_goals).concat(termsOf(context.strategy?.acquisition_goals), termsOf(profile.monetization_goals))
  const monetizationScore = goals.length && topic.strategy_layer === 'conversion' ? 90 : goals.length ? 70 : 35
  const monetizationEvidence = goals.length
    ? [`已读取 ${goals.length} 项变现或获客目标，当前策略层为 ${text(topic.strategy_layer) || '未设置'}`]
    : ['当前账号没有变现或获客目标记录']

  const productionScore = materials.length && structures.length ? 85 : materials.length || structures.length ? 65 : 40
  const productionEvidence = [`已选 ${materials.length} 条素材、${structures.length} 个方法模板`]
  const productionSuggestions = materials.length && structures.length ? [] : ['补充可复用素材或方法模板，降低实际制作成本']

  const prohibited = termsOf(profile.prohibited_patterns).concat(riskyTerms)
  const matchedRisk = matches(title, prohibited)
  const complianceScore = matchedRisk.length ? 10 : 90
  const complianceEvidence = matchedRisk.length ? [`标题命中风险表述：${matchedRisk.join('、')}`] : ['标题未命中当前风险词表']
  const complianceSuggestions = matchedRisk.length ? ['修改或删除风险表述，并在发布前再次检查'] : []

  return [
    dimension('traffic_potential', researchMetrics.length ? 45 + Math.min(50, Math.log10(maxDiscussions + 1) * 20 + Math.min(30, maxGrowth)) : 20, trafficEvidence, trafficSuggestions),
    dimension('account_fit', fitScore, fitEvidence, positioningTerms.length && !matchedPositioning.length ? ['把选题明确连接到已有内容支柱、受众问题或个人观点'] : []),
    dimension('competitive_differentiation', differentiationScore, differentiationEvidence, researchTitles.length && similarTitles.length ? ['增加个人经历、独家数据或不同结论，避免复述同类标题'] : []),
    dimension('timeliness', timelinessScore, timelinessEvidence, !recent ? ['补充最新研究或明确长期有效的 evergreen 价值'] : []),
    dimension('monetization', monetizationScore, monetizationEvidence, goals.length ? [] : ['补充变现目标或获客路径，明确内容承接动作']),
    dimension('production_cost', productionScore, productionEvidence, productionSuggestions),
    dimension('compliance_risk', complianceScore, complianceEvidence, complianceSuggestions),
  ]
}

export function evaluateTopic(topic, context, now = new Date().toISOString()) {
  const dimensions = scoreTopic(topic, context)
  const score = clamp(dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length)
  const decision = score >= 70 ? 'do' : score >= 50 ? 'revise' : 'defer'
  const evidence = dimensions.flatMap(item => item.evidence.map(message => ({ dimension: item.key, message })))
  const suggestions = [...new Set(dimensions.flatMap(item => item.suggestions))]
  return {
    score,
    decision,
    dimensions: Object.fromEntries(dimensions.map(item => [item.key, { score: item.score, evidence: item.evidence, suggestions: item.suggestions }])),
    evidence,
    suggestions,
    evaluated_at: now,
  }
}

export function defaultTopicFields(topic) {
  return {
    ...topic,
    workflow_status: topic.workflow_status || 'candidate',
    evaluation: topic.evaluation || null,
    decision: topic.decision || null,
    decision_reason: topic.decision_reason || '',
    evidence: Array.isArray(topic.evidence) ? topic.evidence : [],
    suggestions: Array.isArray(topic.suggestions) ? topic.suggestions : [],
  }
}

export { DIMENSIONS }
