// Requirement 14 第 2 条：移植 dbs-hook 的开头多维诊断、素材丰富度检查与多种生成方法。
// 抄自 C:\Users\Alex\.agents\skills\dbs-hook\SKILL.md，判据与文案照源技能。
//
// 判据分两类，不混：
// - 规则判得出的照抄源技能判据（素材丰富度五维、开头六维里判得出的四维）
// - 规则判不出的（独立性、匹配度要读懂语义）如实标 judged:false 交给人和模型，不猜一个结论出来
//
// 源技能 Phase 2 的「停止优化」也照搬：素材为零时不生成开头方案，先让用户补素材。

import { longSentenceLimit, structureSentencesOf, writtenPhrasePattern } from './structure-flow.mjs'

export const hookMethodSource = 'dbs-hook：短视频开头优化'

// 三种生成方法。方法二特别标注：真素材只能由用户提供，模型不替他编数字。
export const hookMethods = [
  { id: '素材提取', label: '方法一：素材提取', note: '从正文已有素材里提取，按下面的 Hook 类型优先级排。' },
  { id: '素材增补', label: '方法二：素材增补', note: '正文素材不够时，先说清该补什么素材。真数据、真案例只能由你提供，模型不替你编。', needsUserMaterial: true },
  { id: '悬念制造', label: '方法三：悬念制造', note: '把结论改成问题：不直接给答案，用「为什么」而不是「证明」。' },
]

export const hookMethodsOf = () => hookMethods.map(item => item.id)
export const findHookMethod = id => hookMethods.find(item => item.id === id) || null

// 源技能给的 Hook 类型优先级表，方法一按这个排序。
export const hookMaterialPriorities = [
  { type: '晒结果 + 反转', stars: 5, example: '去年我发了 1 万多条推文，很多人问我执行力怎么这么强，其实我只是搞清楚了一件事' },
  { type: '数据冲击', stars: 4, example: '80 亿、400 栋、13000 条' },
  { type: '反差/转变', stars: 4, example: '从攒首付到管理 80 亿' },
  { type: '金句', stars: 4, example: '不能持有 10 年，就不要持有 10 分钟' },
  { type: '权威+观点', stars: 3, example: '犹太富豪教我一句话' },
  { type: '痛点+悬念', stars: 3, example: '研究 3 个月，焦虑 3 年，后悔 30 年' },
]

// 悬念制造的原则与源技能给的一对正反例。
export const suspenseRules = {
  principles: ['不要直接给答案', '用「为什么」而不是「证明」', '用「问题」而不是「结论」'],
  bad: '李亚鹏 30 年干黄十几个项目，证明人脉不等于赚钱',
  good: '善良的李亚鹏，认识半个娱乐圈，30 年为什么赚不到钱',
}

// 五个维度的近似判据。都是词面判据，不是语义理解——判出来的「有」是真有，「没有」不等于真没有。
const dataPattern = /\d{2,}|\d+\s*(?:%|万|亿|倍|天|年|月|条|个|次|人|块|元)/
const turnPattern = /(?:以前|后来|之前|之后|起初|一开始|第一年|去年|从.{0,12}到|转变|反而)/
const quotePattern = /(?:其实|不是.{1,12}而是|关键是|本质上|说到底|真正的)/
const authorityPattern = /(?:老师|教练|专家|顾问|老板|创始人|协会|机构|大学|研究|报告|白皮书|榜单)/
const painPattern = /(?:焦虑|卡住|做不起来|没人问|没人看|白费|踩坑|后悔|最难|痛点|卡点|瓶颈)/

export const materialDimensions = [
  { id: 'data', label: '冲击力数据', hint: '大数字、对比数字、百分比', pattern: dataPattern },
  { id: 'turn', label: '转变故事', hint: '之前 vs 之后，反差越大越好', pattern: turnPattern },
  { id: 'quote', label: '金句', hint: '能独立成立的观点', pattern: quotePattern },
  { id: 'authority', label: '权威背书', hint: '人物或机构', pattern: authorityPattern },
  { id: 'pain', label: '痛点共鸣', hint: '目标人群的焦虑、常见错误做法', pattern: painPattern },
]

const materialMessages = {
  stop: '这五类素材一个都没有，写不出好开头。先回去补数据、故事、金句、权威或痛点。',
  limited: '素材不够丰富，开头的冲击力会受限。建议补更多素材，尤其缺的那几类。',
  ready: '素材够用，可以出方案。',
}

// 源技能素材丰富度检查：0 个停，1-2 个能优化但效果有限，3 个以上可以继续。
export function materialRichness({ body = '', materialText = '' } = {}) {
  const text = `${body}\n${materialText}`
  const dimensions = materialDimensions.map(item => ({ id: item.id, label: item.label, hint: item.hint, found: item.pattern.test(text) }))
  const count = dimensions.filter(item => item.found).length
  const verdict = count === 0 ? 'stop' : count >= 3 ? 'ready' : 'limited'
  return { dimensions, count, missing: dimensions.filter(item => !item.found).map(item => item.label), verdict, message: materialMessages[verdict] }
}

// 源技能内容完整性检查。源技能还有一条「正文没有价值」，要读懂语义，规则判不了，这里不做。
export function contentCompleteness({ body = '' } = {}) {
  const length = String(body || '').trim().length
  if (!length) return { verdict: 'stop', length, message: '开头是内容的试用装，你连内容都没有，优化开头没有意义。先把正文写出来。' }
  if (length < 200) return { verdict: 'warn', length, message: '正文太短，可能撑不起一个好开头。建议先丰富正文内容。' }
  return { verdict: 'ok', length, message: '' }
}

// 开头六维诊断。前四项判得出，后两项如实留白。
export const openingDimensions = [
  { id: 'independence', label: '独立性', question: '不看标题能理解吗？', judged: false, note: '要读懂语义，规则判不了' },
  { id: 'hook', label: 'Hook', question: '前 5 秒有抓手吗？', judged: true },
  { id: 'suspense', label: '悬念', question: '有没有直接给答案？', judged: true },
  { id: 'credibility', label: '可信度', question: '为什么听你讲？', judged: true },
  { id: 'spoken', label: '口播友好', question: '能直接念出来吗？', judged: true },
  { id: 'match', label: '匹配度', question: '开头承诺的，正文能兑现吗？', judged: false, note: '要读懂语义，规则判不了' },
]

export function openingDiagnosis({ body = '' } = {}) {
  const first = structureSentencesOf(body)[0] || ''
  const hasHandhold = dataPattern.test(first) || turnPattern.test(first) || quotePattern.test(first)
  // 悬念：第一句既给完判断又没有问句，等于没留好奇心。
  const givesAnswerAway = quotePattern.test(first) && !/[？?]/.test(first)
  const hasCredibility = /(?:我|我们|自己|客户|学员|团队)/.test(first) && (dataPattern.test(first) || turnPattern.test(first))
  const spokenFriendly = Boolean(first) && first.length <= longSentenceLimit && !writtenPhrasePattern.test(first)
  const problems = {
    hook: hasHandhold ? '' : '第一句没有数据、反差或金句，前 5 秒没有抓手。',
    suspense: givesAnswerAway ? '第一句就把结论说完了，也没有问句，没留好奇心。' : '',
    credibility: hasCredibility ? '' : '第一句没说清为什么听你讲：没有身份、经历或数字。',
    spoken: spokenFriendly ? '' : `第一句 ${first.length} 字，超了 ${longSentenceLimit} 字或带书面语，念不顺。`,
  }
  const judged = [
    { id: 'hook', problem: Boolean(problems.hook), message: problems.hook },
    { id: 'suspense', problem: Boolean(problems.suspense), message: problems.suspense },
    { id: 'credibility', problem: Boolean(problems.credibility), message: problems.credibility },
    { id: 'spoken', problem: !spokenFriendly, message: problems.spoken },
  ]
  const dimensions = openingDimensions.map(item => {
    if (!item.judged) return { ...item, problem: null, message: '' }
    const hit = judged.find(entry => entry.id === item.id)
    return { ...item, problem: hit.problem, message: hit.message }
  })
  // 核心问题：源技能要最严重的 1-2 个，这里按正文顺序取前两条，不排优先级（规则判不出谁更严重）。
  const core = dimensions.filter(item => item.problem).slice(0, 2).map(item => `${item.label}：${item.message}`)
  return { first, dimensions, core, summary: core.length ? `开头有 ${dimensions.filter(item => item.problem).length} 项待改` : '开头四项判得出的都没有明显问题' }
}

// Requirement 14 第 4 条：每个方案必须溯源到三种方法之一。
// 方法名不认识、开头为空、同一条重复，三者都丢掉——不给编的，也不给重样的。
export function validateHookPlans(plans) {
  const seen = new Set()
  return (Array.isArray(plans) ? plans : []).reduce((kept, plan) => {
    const method = findHookMethod(plan?.method)
    const opening = String(plan?.opening || '').trim()
    if (!method || !opening || seen.has(opening)) return kept
    seen.add(opening)
    kept.push({
      method: method.id,
      method_label: method.label,
      opening,
      note: String(plan?.note || '').trim(),
      used_material: String(plan?.used_material || '').trim(),
      needs_user_material: Boolean(method.needsUserMaterial),
    })
    return kept
  }, [])
}
