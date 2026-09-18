// Requirement 14 第 3 条：标题与开头输出多个方案供用户选择，不给单一结论。
//
// 这一层只做三件事：拼提示词、解析模型输出、把结果交给溯源校验。
// 公式与方法的真值都在 title-formulas.mjs / hook-diagnosis.mjs，这里不复制一份。

import { contentCompleteness, hookMaterialPriorities, hookMethods, materialRichness, openingDiagnosis, suspenseRules, validateHookPlans } from './hook-diagnosis.mjs'
import { titleFormulaCatalog, titleFormulaSource, validateTitlePlans } from './title-formulas.mjs'

export const ideaKinds = ['title', 'hook']

// 标题方案。公式目录整份喂进去，模型只许从里面挑，并且必须报出编号。
export function titleIdeasPrompt({ platform, topic = '', body = '', currentTitle = '', count = 6 } = {}) {
  const system = [
    `你在给${platform}内容挑标题。只能从下面给出的公式里挑，不许自己发明公式。`,
    '每条方案都必须写明用了第几号公式，以及为什么这条公式配这个话题。',
    `公式里的「原始举例」来自${titleFormulaSource}，那是别的平台的爆款，只用来理解这条公式被验证过什么样，不要把举例里的行业词硬套到这个话题上。`,
    '给不同公式的方案，不要一条公式出好几条。',
  ].join('')
  const user = JSON.stringify({
    平台: platform,
    话题: topic,
    现在的标题: currentTitle,
    正文: String(body || '').slice(0, 1200),
    要几条方案: count,
    公式目录: titleFormulaCatalog(platform),
    输出格式: { plans: [{ formula_id: '公式编号（数字）', title: '标题', why: '为什么这条公式配这个话题' }] },
  })
  return { system, user }
}

// 开头方案。三种方法、Hook 优先级、悬念原则都照源技能给全。
export function hookIdeasPrompt({ platform, topic = '', body = '', diagnosis = null, count = 6 } = {}) {
  const system = [
    `你在给${platform}写开头。只能用这三种方法：${hookMethods.map(item => item.id).join('、')}。`,
    '每条方案都要写明用了哪种方法，以及这条开头用了或要补什么素材。',
    '方法二「素材增补」里出现的数字、案例、结果，都必须是用户已经提供的素材。用户没给过的一律不许编，写清该补什么、留给用户补。',
    '开头要能直接念出来：不要书面语，不要自问自答，单句不要超过 30 字。',
    `悬念制造要守这几条：${suspenseRules.principles.join('；')}。`,
  ].join('')
  const user = JSON.stringify({
    平台: platform,
    话题: topic,
    正文: String(body || '').slice(0, 1200),
    素材诊断: diagnosis ? { 判定: diagnosis.richness.verdict, 缺的维度: diagnosis.richness.missing, 现有维度: diagnosis.richness.dimensions.filter(item => item.found).map(item => item.label) } : null,
    三种方法: hookMethods,
    Hook类型优先级: hookMaterialPriorities,
    悬念正反例: { 这样不行: suspenseRules.bad, 这样才行: suspenseRules.good },
    要几条方案: count,
    输出格式: { plans: [{ method: hookMethods.map(item => item.id).join('|'), opening: '开头原文', note: '这条用了什么素材或者要补什么', used_material: '用到的素材原话' }] },
  })
  return { system, user }
}

const parseObject = content => {
  try {
    const match = String(content || '').match(/\{[\s\S]*\}/)
    return match ? JSON.parse(match[0]) : null
  } catch {
    return null
  }
}

// 模型输出不合规时返回空数组，不编兜底方案。校验规则在各自的 validate 里。
export const parseTitleIdeas = (content, platform) => validateTitlePlans(parseObject(content)?.plans, platform)
export const parseHookIdeas = content => validateHookPlans(parseObject(content)?.plans)

// 开头生成前的确定性地基：源技能 Phase 2 说停就停，不拿大模型去补一个没有素材的内容。
export function hookReadiness({ body = '', materialText = '' } = {}) {
  const completeness = contentCompleteness({ body })
  const richness = materialRichness({ body, materialText })
  const opening = openingDiagnosis({ body })
  const blocked = completeness.verdict === 'stop' ? completeness.message : richness.verdict === 'stop' ? richness.message : ''
  return { completeness, richness, opening, blocked, canGenerate: !blocked }
}
