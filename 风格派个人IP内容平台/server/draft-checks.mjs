import { prohibitedWordlist } from './redfox.mjs'
import { validateSourceRefs } from './validation.mjs'

const riskWords = prohibitedWordlist.map(item => item.word)
const qualityKeys = ['hook_clarity', 'audience_fit', 'core_point', 'evidence', 'structure_and_risk']

function text(value) { return String(value || '').replace(/\s+/g, ' ').trim() }
function list(value) { return Array.isArray(value) ? value.map(text).filter(Boolean) : [] }
function hitsFor(value, words) { const body = text(value); return words.filter(word => body.includes(word)) }
function evidenceItem(code, message, severity = 'warning') { return { code, message, severity } }
function result(status, { score = null, dimensions = {}, evidence = [], suggestions = [], draftVersion = 1 } = {}) {
  return { status, score, dimensions, evidence, suggestions, draft_version: draftVersion, checked_at: new Date().toISOString() }
}
function sourceCount(draft) { return Array.isArray(draft?.source_refs) ? draft.source_refs.length : 0 }
function currentVersion(draft) { return Number(draft?.version || 1) }

export function checkPersona(draft, profile = {}) {
  const body = text(draft?.body)
  const audiences = list(profile.audiences)
  const pillars = list(profile.pillars)
  const prohibited = list(profile.prohibited_patterns)
  const evidence = []
  const suggestions = []
  const matchedAudience = audiences.find(value => body.includes(value))
  const matchedPillar = pillars.find(value => body.includes(value))
  const prohibitedHits = hitsFor(body, prohibited)
  if (!text(profile.role)) { evidence.push(evidenceItem('missing_role', 'IP 档案缺少角色定位')); suggestions.push('补充角色定位后重新检查') }
  if (!audiences.length) { evidence.push(evidenceItem('missing_audience', 'IP 档案尚未配置受众')); suggestions.push('补充目标受众') }
  if (audiences.length && !matchedAudience) { evidence.push(evidenceItem('audience_mismatch', '正文未明显对应当前受众')) ; suggestions.push('在正文中写出受众正在面对的具体问题') }
  if (pillars.length && !matchedPillar) { evidence.push(evidenceItem('pillar_mismatch', '正文未明显对应内容支柱')); suggestions.push('补充一个与内容支柱直接相关的观点或案例') }
  if (prohibitedHits.length) { evidence.push(evidenceItem('prohibited_pattern', `命中档案表达边界：${prohibitedHits.join('、')}`)); suggestions.push('替换为符合个人表达边界的说法') }
  const firstPerson = /我|我的|我们|亲自|经历|复盘/.test(body)
  if (!firstPerson) { evidence.push(evidenceItem('low_personal_signal', '正文缺少明显的个人经历或第一人称信号')); suggestions.push('加入一个本人经历、过程或明确判断') }
  const score = Math.max(0, 100 - evidence.reduce((sum, item) => sum + (item.severity === 'warning' ? 15 : 10), 0))
  return result(evidence.length ? 'warning' : 'passed', { score, evidence, suggestions, draftVersion: currentVersion(draft) })
}

export function checkQuality(draft, profile = {}) {
  const body = text(draft?.body)
  const hook = draft?.selected_hook
  const hookPassed = Boolean(hook && hook.validation?.status === 'passed' && text(hook.text))
  const sourceValid = validateSourceRefs(draft?.source_refs)
  const riskHits = hitsFor(body, riskWords)
  const audienceValues = list(profile.audiences)
  const pillarValues = [...list(profile.pillars), ...list(profile.viewpoints), ...list(profile.problems)]
  const audienceScore = audienceValues.length && audienceValues.some(value => body.includes(value)) ? 100 : audienceValues.length ? 50 : 40
  const pointScore = pillarValues.length && pillarValues.some(value => body.includes(value)) ? 100 : pillarValues.length ? 55 : 45
  const structureScore = body.length >= 120 && body.split(/\n\s*\n/).length >= 2 ? 100 : body.length >= 60 ? 65 : 20
  const dimensions = {
    hook_clarity: hookPassed ? 100 : 0,
    audience_fit: audienceScore,
    core_point: pointScore,
    evidence: sourceValid && sourceCount(draft) > 0 ? 100 : 0,
    structure_and_risk: riskHits.length ? 0 : structureScore,
  }
  const score = Math.round(qualityKeys.reduce((sum, key) => sum + dimensions[key], 0) / qualityKeys.length)
  const evidence = []
  const suggestions = []
  if (!body) { evidence.push(evidenceItem('body_missing', '正文不能为空', 'blocked')); suggestions.push('补充正文内容') }
  if (!hookPassed) { evidence.push(evidenceItem('hook_missing', '尚未选择通过校验的 Hook', 'blocked')); suggestions.push('先生成并选择一个有效 Hook') }
  if (!sourceValid || sourceCount(draft) === 0) { evidence.push(evidenceItem('source_missing', '草稿缺少有效来源引用', 'blocked')); suggestions.push('补回选题、素材或方法来源') }
  if (riskHits.length) { evidence.push(evidenceItem('risk_words', `正文命中风险表达：${riskHits.join('、')}`, 'blocked')); suggestions.push('修改风险表达后重新检查') }
  if (body && structureScore < 100) { evidence.push(evidenceItem('structure_weak', '正文长度或段落结构仍需加强')); suggestions.push('补充真实过程、证据和可执行步骤') }
  if (audienceScore < 100) { evidence.push(evidenceItem('audience_weak', '正文与当前受众问题的连接不够明确')); suggestions.push('明确读者是谁以及正在解决什么问题') }
  if (pointScore < 100) { evidence.push(evidenceItem('point_weak', '核心观点或内容支柱不够明确')); suggestions.push('用一句话写出你的判断，再用过程或案例支撑') }
  const scoreBlocked = score < 60
  if (scoreBlocked) evidence.push(evidenceItem('score_low', '质量综合分低于 60 分', 'blocked'))
  const blocked = evidence.some(item => item.severity === 'blocked') || scoreBlocked
  return result(blocked ? 'blocked' : 'passed', { score, dimensions, evidence, suggestions, draftVersion: currentVersion(draft) })
}

export function checkPublishChecklist(draft) {
  const body = text(draft?.body)
  const hookPassed = Boolean(draft?.selected_hook && draft.selected_hook.validation?.status === 'passed')
  const riskHits = hitsFor(body, riskWords)
  const checks = {
    title: Boolean(text(draft?.title)),
    body: Boolean(body),
    platform: Boolean(text(draft?.platform)),
    source_refs: validateSourceRefs(draft?.source_refs) && sourceCount(draft) > 0,
    fact_check: draft?.fact_check_status === 'verified',
    selected_hook: hookPassed,
    risk_free: riskHits.length === 0,
    variant_group: Boolean(draft?.variant_group_id || draft?.variant_type === 'legacy'),
  }
  const evidence = Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => evidenceItem(key, {
    title: '缺少标题', body: '正文不能为空', platform: '未指定目标平台', source_refs: '缺少有效来源引用', fact_check: '发布前必须完成事实核验', selected_hook: '必须选择通过校验的 Hook', risk_free: `存在风险表达：${riskHits.join('、')}`, variant_group: '缺少有效的平台版本组',
  }[key], 'blocked'))
  const suggestions = evidence.map(item => ({ source_refs: '补回来源引用', fact_check: '完成事实核验', selected_hook: '选择有效 Hook', risk_free: '修改风险表达' }[item.code] || '补齐发布清单项'))
  const passed = Object.values(checks).filter(Boolean).length
  return result(evidence.length ? 'blocked' : 'passed', { score: Math.round(passed / Object.keys(checks).length * 100), dimensions: checks, evidence, suggestions, draftVersion: currentVersion(draft) })
}

export function hasBlockedCheck(draft) {
  return ['persona', 'quality', 'publish_checklist'].some(key => draft?.checks?.[key]?.status === 'blocked')
}

export { qualityKeys }
