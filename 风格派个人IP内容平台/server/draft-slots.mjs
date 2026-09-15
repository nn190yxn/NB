// 草稿槽位：生成后再选结构。选中一个槽位选项 → 只重写对应片段，不重写全篇。
// 这里的函数保持纯函数，方便单独测试。

export const slotIds = ['title', 'opening', 'structure', 'ending']

export const slotLabels = { title: '标题改法', opening: '开头句', structure: '正文结构', ending: '结尾' }

// 选题标题由四条平台草稿共用，改一次要改整组。
export const groupScopedSlots = ['title']

// 标题改法：用户已确认的 8 种。前 5 种来自对标 dbs 的句式，后 3 种是自有判断。
export const titleMethods = [
  { id: 'title-contrast', name: '反差', source: '对标dbs', formula: '把预期反过来：你以为缺 X，其实是缺 Y' },
  { id: 'title-number', name: '数字冲击', source: '对标dbs', formula: '前半句放结果数字，后半句给反常识结论' },
  { id: 'title-question', name: '设问反转', source: '对标dbs', formula: '先问一个大多数人会答错的问题' },
  { id: 'title-loss', name: '量化损失', source: '对标dbs', formula: '把代价折算成可感的数字和时间' },
  { id: 'title-experience', name: '经历翻转', source: '对标dbs', formula: '用第一人称经历起头，落到认知翻转' },
  { id: 'title-pain', name: '痛点直击', source: '自有', formula: '直接说出受众正在经历的那一幕' },
  { id: 'title-minimal', name: '极简判断', source: '自有', formula: '一个短句判断，不加修饰' },
  { id: 'title-result', name: '结果前置', source: '自有', formula: '先给结果，再留悬念说明怎么做到' },
]

// 平台体裁：来自现有的分平台生成约束（长度、口播/书面、分段要求），不是新造的写法。
export const platformGenres = [
  { id: 'genre-douyin', name: '抖音口播三段', platform: '抖音', source: '自有', formula: '≤250 字口播：冲突开场 → 一段经历或案例 → 一句可执行的收尾' },
  { id: 'genre-xhs', name: '小红书清单体', platform: '小红书', source: '自有', formula: '400-800 字：痛点场景 → 编号清单 → 一句金句 → 互动提问' },
  { id: 'genre-shipinhao', name: '视频号口播', platform: '视频号', source: '自有', formula: '≤250 字口播：观点起头 → 一个案例支撑 → 明确判断' },
  { id: 'genre-gzh', name: '公众号论证体', platform: '公众号', source: '自有', formula: '600-1200 字且分段短：现象 → 拆解原因 → 方法 → 收束' },
]

function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim() }

function structureSource(structure) {
  return /对标/.test(String(structure?.title || '')) ? '对标dbs' : '自有'
}

function toOption(structure) {
  const steps = Array.isArray(structure?.steps) ? structure.steps : []
  return {
    id: `structure-${structure.id}`,
    structure_id: structure.id,
    name: String(structure.title || '').replace(/^对标dbs·/, ''),
    source: structureSource(structure),
    formula: steps.length ? String(steps[0]) : '',
    steps: steps.map(step => String(step)),
  }
}

// 按槽位给出可选项：开头与结尾来自爆款方法库，正文结构分「平台体裁」与「内容骨架」两组。
export function buildSlotOptions({ structures = [], platform = '' } = {}) {
  const byType = type => structures.filter(item => item?.content_type === type && Array.isArray(item.steps) && item.steps.length)
  const genres = platformGenres.filter(genre => !platform || genre.platform === platform)
  return {
    title: titleMethods.map(method => ({ ...method, steps: [method.formula] })),
    opening: byType('开头钩子').map(toOption),
    structure: [...genres.map(genre => ({ ...genre, steps: [genre.formula] })), ...byType('母模板').map(toOption)],
    ending: byType('结尾引导').map(toOption),
  }
}

export function findSlotOption(options, slot, optionId) {
  const list = Array.isArray(options?.[slot]) ? options[slot] : []
  return list.find(item => item.id === optionId) || null
}

const slotTasks = {
  title: '只重写标题。输出一个标题，不超过 30 个汉字，不要引号、不要句末标点、不要解释。',
  opening: '只重写正文的第一段（视频前 3 秒要说的话）。输出这一段本身，不要带「开头」「第几段」之类的标签，不要解释。',
  ending: '只重写正文的最后一段。输出这一段本身，不要带「结尾」之类的标签，不要解释。',
  structure: '按目标结构重排整篇正文。保留正文里已有的具体经历、数字和案例，不要替换成通用套话；缺的部分按结构补齐。只输出重排后的完整正文，不要解释。',
}

export function slotRewriteMessages({ slot, option, draft, styleMemories = [] }) {
  const task = slotTasks[slot]
  if (!task) throw new Error(`不支持的槽位：${slot}`)
  const payload = {
    slot,
    目标写法: option?.name || '',
    公式或步骤: Array.isArray(option?.steps) ? option.steps : [String(option?.formula || '')],
    平台: String(draft?.platform || ''),
    当前标题: String(draft?.title || ''),
    当前正文: String(draft?.body || '').slice(0, 4000),
    对标打法: styleMemories.map(item => String(item.content || '')).filter(Boolean).slice(0, 6),
  }
  return [
    { role: 'system', content: `你是个人 IP 的文案改稿助手。${task}` },
    { role: 'user', content: JSON.stringify(payload) },
  ]
}

// 正文可能是「标题：… 空行 正文：… 第一段 …」的形态，所以按行定位：
// 开头的「标题：」「正文：」行属头部不参与替换，开头段与结尾段各自成区间。
export function bodySegments(body) {
  const lines = String(body || '').split('\n')
  let start = 0
  while (start < lines.length) {
    const line = lines[start].trim()
    if (!line || /^(标题|正文)[:：]/.test(line)) { start += 1; continue }
    break
  }
  const rest = lines.slice(start)
  if (!rest.length) return { head: lines.join('\n'), opening: '', ending: '', openingRange: null, endingRange: null, firstEnd: 0, lastStart: 0, start }
  let firstEnd = rest.findIndex((line, index) => index > 0 && !line.trim())
  if (firstEnd === -1) firstEnd = rest.length
  let lastStart = 0
  for (let index = rest.length - 1; index > 0; index -= 1) { if (!rest[index].trim()) { lastStart = index + 1; break } }
  return {
    head: lines.slice(0, start).join('\n'),
    opening: rest.slice(0, firstEnd).join('\n'),
    ending: rest.slice(lastStart).join('\n'),
    openingRange: [start, start + firstEnd],
    endingRange: [start + lastStart, lines.length],
    firstEnd,
    lastStart,
    start,
  }
}

export function replaceBodySegment(body, position, replacement) {
  const text = String(replacement || '').trim()
  if (!text) throw new Error('改写结果为空')
  const lines = String(body || '').split('\n')
  const segments = bodySegments(body)
  if (!segments.openingRange || !segments.endingRange) return text
  const [from, to] = position === 'opening' ? segments.openingRange : segments.endingRange
  return [...lines.slice(0, from), ...text.split('\n'), ...lines.slice(to)].join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// 把模型返回的片段套回草稿：标题改 draft.title，其余改 draft.body。
export function applySlotRewrite({ slot, option, draft, rewritten }) {
  const text = String(rewritten || '').trim()
  if (!text) throw new Error('改写结果为空')
  if (slot === 'title') return { title: clean(text).replace(/^["'「]|["'」]$/g, '').slice(0, 40) }
  if (slot === 'opening') return { body: replaceBodySegment(draft?.body, 'opening', text) }
  if (slot === 'ending') return { body: replaceBodySegment(draft?.body, 'ending', text) }
  if (slot === 'structure') return { body: text }
  throw new Error(`不支持的槽位：${slot}`)
}
