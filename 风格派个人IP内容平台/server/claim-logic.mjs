// 主张的角度与逻辑判定（批次 2 / Requirement 5、7）。
//
// 用户的产品模型：一个主题按不同角度看（市场 / 经营 / 管理 / 老板 / 员工……），
// 不同角度长出不同主张，每条主张自带它的逻辑；逻辑要逐条查，查完才拿去成文。
//
// 判定为什么**不拦**：判据来自模型，实测同文同提示词跑 6 次只有 3 次抓到问题。
// 拿不稳的东西不配当闸门。它的作用是把断点当场摊开给人看，留不留这条主张由人定。
// 用户 2026-09-21 说得很直接：逻辑可能不成立，但它的利观点还能用。

import { modelJson, normalizeVerdictStatus } from './model-json.mjs'

export const angleSuggestions = ['市场', '经营', '管理', '财务', '老板', '员工', '客户', '同行', '平台']

// 角度是自由文本（词表只是建议），所以这里只校验"能当角度用"，不做枚举。
export function normalizeAngles(input) {
  const list = Array.isArray(input) ? input : input ? [input] : []
  const seen = []
  for (const item of list) {
    const angle = String(item || '').trim().slice(0, 20)
    if (angle && !seen.includes(angle)) seen.push(angle)
  }
  // 一次只跑一对：三个以上角度是多次运行，不是一次运行。
  return seen.slice(0, 2)
}

export const logicStatuses = ['passed', 'conditional', 'failed']
export const logicStatusLabels = { passed: '逻辑成立', conditional: '有条件成立', failed: '逻辑不成立' }

// 判定结果绑在正文上：正文一改，旧判定立刻退回未判定，不给人"这条已经查过"的错觉。
export function logicStateOf(material) {
  if (!material?.logic_status) return 'unchecked'
  if (material.logic_source_checksum && material.logic_source_checksum !== material.checksum) return 'stale'
  return logicStatuses.includes(material.logic_status) ? material.logic_status : 'unchecked'
}

// 一次运行的配对信息存回素材：立选题时知道哪条主张是 stance、同 run 的另一角度就是反方。
export function claimRunOf(material) {
  return { run_id: material?.claims_run || null, angle: String(material?.angle || '').trim() || null }
}

export function claimsAngleNote(angles, already = [], secondTry = false) {
  const [first] = normalizeAngles(angles)
  if (first) {
    const listed = (Array.isArray(already) ? already : []).map(item => String(item ?? '').trim()).filter(Boolean)
    // 真模型实测：第二个角度常常把第一个角度的那句话原样再说一遍，
    // 于是"同一句话的两个角度"根本不存在，反方就是空的。这里把已说过的摆出来，要求换个说法。
    // 只说「别说同样的话」挡不住：真模型实测会把第一个角度那句原样再交一遍。
    // 改成让它反驳——角度不同本来就该产生立场冲突，这是用户说的「不同角度形成不同文案」。
    const rebuttal = listed.length ? `已经有人说过了：${listed.map(item => `「${item}」`).join('')}。现在从「${first}」的立场看，这些话哪里说错了、漏了什么、或者根本是反的：claims 只写这个立场自己的说法，与上面任何一句同义改写（换个词、加个限定）都算没回答。这个立场实在提不出不同说法，就给空数组，不要复述别人的话。` : ''
    // 交白卷时再逼问一次，且把「站谁的立场、在乎什么」说具体：真模型第一轮常常是懒得换位，不是这份素材真没有角度差。
    const push = secondTry && listed.length ? `上一次这个角度什么也没提。这一次先想清楚：「${first}」在这件事里真正在乎的是什么、最怕失去什么、会被什么坑到，再只说这一方自己的话。还是提不出不同于上面的说法，才给空数组。` : ''
    return `这次只从「${first}」这个角度提主张。claims 每一项写成 {"text":"主张原文","angle":"${first}"}。要的是这个立场会怎么说这件事。${rebuttal}${push}`
  }
  return ''
}

export function parseClaimsOutput(content, angles = []) {
  const parsed = modelJson(content)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('模型返回不是对象')
  const allowed = normalizeAngles(angles)
  const items = []
  for (const raw of Array.isArray(parsed.claims) ? parsed.claims : []) {
    const text = String(typeof raw === 'string' ? raw : raw?.text ?? '').trim()
    if (!text) continue
    const declared = String(typeof raw === 'string' ? '' : raw?.angle ?? '').trim()
    // 角度认不出的一律落回第一个角度：宁可能见地错一个标签，也不让模型编出一个新分类。
    const angle = allowed.includes(declared) ? declared : allowed[0] || declared || ''
    if (items.some(item => item.text === text)) continue
    items.push({ text, angle })
  }
  return items
}

export const claimLogicPrompt = [
  '你是主张的逻辑检查员。检查的对象是一条主张自己站不站得住：它的结论能不能从它给出的依据推出来，说的范围配不配得上这个结论。',
  '不检查文笔、不检查观点讨不讨喜、不判断立场对错。一条主张完全可以是错的立场但逻辑成立。',
  '只输出 JSON：{"status":"passed|conditional|failed","breakpoint":"断在哪一步，引用主张里的原词；成立就给空字符串","note":"一句人话说清为什么这么判"}。',
  '三档只认这三个值。判定为 conditional 时必须能说清在什么条件下才成立，条件写进 note。',
  '指不到原文的断点不要编：找不到确切断点就判 passed 或 conditional，并在 note 里说明依据。',
].join('\n')

export function claimLogicVariables({ text, scope, why }) {
  return {
    claim: String(text || '').slice(0, 2000),
    declared_scope: String(scope || '').slice(0, 500),
    declared_reason: String(why || '').slice(0, 1000),
  }
}

export function parseClaimLogicVerdict(content) {
  const parsed = modelJson(content)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('逻辑判定返回不是对象')
  const raw = String(parsed.status ?? '').trim()
  const status = normalizeVerdictStatus(raw)
  // 认不出档位就报错：把「读不懂」当成「查过没问题」是最坏的一种失败。
  if (!status) throw new Error(`逻辑判定只认 ${logicStatuses.join(' / ')}（也认「成立 / 有条件成立 / 不成立」），返回的是「${raw || '空'}」`)
  return { status, breakpoint: String(parsed.breakpoint || '').trim(), note: String(parsed.note || '').trim() }
}
