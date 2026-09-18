// Requirement 18：新手单步路由。不知道下一步做什么的人，界面只该给他一个动作。
//
// 链路是从定位到回流的十一个环节，每个环节回答一个问题。这里只做一件事：
// 看用户手上已有什么，算出现在该做哪一步、还缺什么、补上能得到什么。
//
// 非强制线性：所有环节都算状态、都能点，路由只管「下一步建议」，不管「必须按顺序」。
// 三种模式照 dbs 主入口：
//   新手教程 = 一条都还没做，先带他走一遍链路；
//   任务前路由 = 做到一半，指出下一个动作；
//   任务后导航 = 链路走完，往回接新一轮选题。

export const guideStages = [
  { id: 'positioning', label: '定位', question: '你的账号打给谁、凭什么', action: '生成定位候选，选一个', needs: '定位', gain: '后面所有诊断都拿它当尺子' },
  { id: 'materials', label: '素材', question: '有什么是你自己经历过的', action: '录一条素材，或导入一段录音', needs: '至少一条素材', gain: '初稿才写得出别人写不出的细节' },
  { id: 'research', label: '对标', question: '你在和谁比', needs: '至少一条对标', action: '存一条对标研究', gain: '判断标准来自真实对手，不是凭空定的' },
  { id: 'structures', label: '结构库', question: '开头和正文照哪个范式', needs: '至少一条结构', action: '建一条结构，或导入现成模板', gain: '改稿时能按槽位换开头、换结构' },
  { id: 'topics', label: '选题', question: '这一条要讲什么', needs: '至少一个选题', action: '定一个选题，过一次选题把关', gain: '先筛掉不值得写的，再花时间写' },
  { id: 'draft', label: '初稿', question: '把选题写成初稿', needs: '至少一份初稿', action: '从选题生成初稿', gain: '有了能改的东西' },
  { id: 'diagnosis', label: '诊断改稿', question: '这一稿哪里不对', needs: '至少跑过一轮诊断', action: '跑诊断，按标记逐处改', gain: '知道每一处该怎么改，而不是整篇重写' },
  { id: 'approval', label: '定稿', question: '这一版可以拍了', needs: '至少一份定稿', action: '过完检查后确认定稿', gain: '拍摄稿冻结，改稿不会漏进现场' },
  { id: 'shooting', label: '拍摄', question: '对着提词器拍', needs: '至少一条拍摄项', action: '打开提词器拍完', gain: '拍完就能发，不用再翻草稿' },
  { id: 'publish', label: '发布', question: '发布前核对一遍', needs: '至少一条已发布记录', action: '生成平台版本，核对清单后复制发布', gain: '违禁词和平台差异在发出去之前拦住' },
  { id: 'return_flow', label: '回流', question: '平台表现怎么样', needs: '至少一条确认过的表现数据', action: '录一次表现数据，回来复盘', gain: '下一轮选题有数据支撑，判据也从你自己的稿子里长' },
]

export const guideMods = ['新手教程', '任务前路由', '任务后导航']

// Requirement 19：定位、素材、对标全空时给这三条，不拿选题生成那套「缺身份定位」文案顶上来。
export const guideColdStartPaths = [
  { id: 'small_sample', label: '先做小样本', detail: '只对一个小问题连着发 3 条' },
  { id: 'narrow_scope', label: '先收缩边界', detail: '把话题收窄到你自己今年真正做过的一件事' },
  { id: 'topic_only', label: '直接用纯选题生成一版没有素材的初稿', detail: '初稿里缺细节的地方会标出来' },
]

const count = (list, predicate = () => true) => (Array.isArray(list) ? list.filter(predicate).length : 0)

// 定位这类是按用户分的文档，空文档也算存在。只有真写过内容才算做过这一步。
const metaKeys = new Set(['id', 'owner_id', 'created_at', 'updated_at'])
export function hasContent(doc) {
  if (!doc || typeof doc !== 'object') return false
  return Object.entries(doc).some(([key, value]) => {
    if (metaKeys.has(key)) return false
    if (Array.isArray(value)) return value.length > 0
    if (value && typeof value === 'object') return Object.keys(value).length > 0
    return Boolean(value)
  })
}

// 每个环节「做没做」只看用户手上真实存在的东西，不看他自己说做到哪一步了。
export function guideProgress(data = {}) {
  const drafts = data.drafts || []
  const shooting = data.shooting || []
  const done = {
    positioning: hasContent(data.positioning) || hasContent(data.positioning_candidates),
    materials: count(data.materials, item => !item.deleted_at) > 0,
    research: count(data.research) > 0,
    structures: count(data.structures) > 0,
    topics: count(data.topics) > 0,
    draft: drafts.length > 0,
    diagnosis: count(drafts, item => item.checks?.persona || item.checks?.quality) > 0,
    approval: count(drafts, item => item.approval?.status === 'approved') > 0,
    shooting: shooting.length > 0,
    publish: count(shooting, item => item.status === 'published') > 0,
    return_flow: count(data.performance_snapshots, item => item.status === 'confirmed') > 0 || count(data.preferences, item => item.status === 'active') > 0,
  }
  return done
}

export function guideState(data = {}, { coldStartPaths = guideColdStartPaths } = {}) {
  const done = guideProgress(data)
  const next = guideStages.find(stage => !done[stage.id]) || null
  const doneCount = guideStages.filter(stage => done[stage.id]).length
  const mode = doneCount === 0 ? '新手教程' : next ? '任务前路由' : '任务后导航'

  // 冷启动降级：定位、素材、对标三样全空的时候，不走重流程。
  const emptyStart = !done.positioning && !done.materials && !done.research
  const degraded = emptyStart
    ? { active: true, missing: ['定位', '素材', '对标'], paths: coldStartPaths, gain: '先补上任意一样，链路就会从对应的环节开始带你走' }
    : { active: false, missing: [], paths: [], gain: '' }

  return {
    mode,
    stages: guideStages.map(stage => ({ ...stage, done: done[stage.id] })),
    done_count: doneCount,
    total: guideStages.length,
    // 单步：只把这个动作摆到最前面；其余环节仍然可点，不强制线性。
    next: next ? { ...next, index: guideStages.findIndex(stage => stage.id === next.id) + 1 } : null,
    completed: guideStages.filter(stage => done[stage.id]).map(stage => stage.label),
    degraded,
  }
}
