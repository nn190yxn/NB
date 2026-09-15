// 草稿正文由大模型撰写：这里只负责组装写作简报、构造指令、解析模型返回，方便单独测试。
// 简报里必须分开三件事：style 是创作者本人的表达习惯；mechanisms 是对标账号可照用的机制；quotes 是对标原话（只能当引用且要标来源）。

export const draftPlatforms = ['小红书', '抖音', '视频号', '公众号']

// 平台长度目标：提示词与发布前检查共用这一份，避免两处数字各说各话。
// 修改这里的数字后，draft-writing.test.mjs 会让提示词文案不同步这件事直接挂掉。
export const draftLengthTargets = {
  小红书: { min: 400, max: 800 },
  抖音: { min: 0, max: 250 },
  视频号: { min: 0, max: 250 },
  公众号: { min: 600, max: 1200 },
}
export function draftLengthRange(platform) {
  const target = draftLengthTargets[platform]
  if (!target) return ''
  return target.min ? `${target.min}-${target.max}` : `不超过 ${target.max}`
}

export function buildDraftBrief({ topic, structure, quotes, experiences, memories, mechanisms, hookText }) {
  return {
    title: String(topic?.title || '').trim(),
    strategy_layer: String(topic?.strategy_layer || 'trust'),
    hook: String(hookText || '').trim(),
    structure: Array.isArray(structure?.steps) ? structure.steps.map(step => String(step)) : [],
    quotes: (quotes || []).map(item => ({ text: String(item.content || ''), source: String(item.name || '') })).filter(item => item.text),
    experiences: (experiences || []).map(item => String(item.content || '')).filter(Boolean),
    style: (memories || []).map(item => String(item.content || '')).filter(Boolean),
    mechanisms: (mechanisms || []).map(item => ({ content: String(item.content || ''), source: String(item.source_label || '对标账号') })).filter(item => item.content),
    platforms: draftPlatforms,
  }
}

export function draftBriefPrompt(profile = {}) {
  const profileFacts = [
    profile.role ? `身份：${profile.role}` : '',
    profile.audiences?.length ? `受众：${profile.audiences.join('、')}` : '',
    profile.pillars?.length ? `内容支柱：${profile.pillars.join('、')}` : '',
    profile.problems?.length ? `受众问题：${profile.problems.join('、')}` : '',
  ].filter(Boolean).join('；')
  return [
    '你是个人 IP 的文案写手。根据写作简报，为每个平台写一条可以直接拍摄或发布的完整正文（不是提纲，不要写"请补充"之类的占位）。',
    '要求：开头第一句直给冲突或结论；正文用具体经历、场景、数字或证据支撑；结尾给可执行的一步或一个明确判断。',
    '长度：小红书 400-800 字；抖音、视频号是口播稿且不超过 250 字；公众号 600-1200 字且分段短。',
    '只使用简报里的事实和素材，不编造成绩、客户或数据；简报里没有的信息就略过。',
    '简报字段的边界不能混：style 是创作者本人的表达习惯，必须遵守。',
    'mechanisms 是对标账号的可复制机制（结构骨架、钩子公式、节奏配比、选题公式）：结构和节奏可以照用，但不能写成“这是创作者本人的习惯”。',
    'quotes 是对标账号的原话：只能当引用用，而且必须在正文里写出 source 字段给的来源（例如「对标dbs」）；不得把对方原话改写成创作者本人说过的话。',
    'mechanisms 与 quotes 为空时，不要提对标、也不要虚构对标来源。',
    profileFacts ? `IP 档案：${profileFacts}。` : '',
    '只输出 JSON，不要解释：{"master":"母版正文","小红书":"...","抖音":"...","视频号":"...","公众号":"..."}。四个平台键都必须有正文。',
  ].filter(Boolean).join('\n')
}

export function parseDraftBodies(content) {
  const matched = String(content || '').match(/\{[\s\S]*\}/)
  if (!matched) throw new Error('模型未返回 JSON')
  let parsed
  try { parsed = JSON.parse(matched[0]) } catch { throw new Error('模型返回的 JSON 无法解析') }
  const master = String(parsed.master || '').trim()
  if (!master) throw new Error('模型未返回母版正文')
  const bodies = {}
  for (const platform of draftPlatforms) bodies[platform] = String(parsed[platform] || '').trim() || master
  return bodies
}
