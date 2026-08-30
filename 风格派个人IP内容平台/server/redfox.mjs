const defaultHeaders = { accept: 'application/json' }

export function normalizeResearchItem(payload, { platform = '未知平台', query = '' } = {}) {
  const item = payload?.item || payload || {}
  return {
    platform: item.platform || platform,
    title: item.title || item.name || '未命名研究条目',
    author: item.author || item.creator || '',
    url: item.url || item.source_url || null,
    metrics: item.metrics || { discussions: Number(item.discussions || item.comments || 0), growth: Number(item.growth || 0) },
    query,
    raw_payload: payload,
  }
}

export const prohibitedWordlist = [
  { word: '第一', level: '极限词', suggestion: '改为“头部/领先”等可举证表述' },
  { word: '最好', level: '极限词', suggestion: '改为“更适合”并给出对比证据' },
  { word: '最佳', level: '极限词', suggestion: '改为“优选”并列出选择标准' },
  { word: '国家级', level: '极限词', suggestion: '删除或替换为可查证的资质名称' },
  { word: '绝对', level: '绝对化', suggestion: '改为“大概率/多数情况下”' },
  { word: '100%', level: '绝对化', suggestion: '改为真实数据区间' },
  { word: '根治', level: '医疗风险', suggestion: '改为“改善/缓解”' },
  { word: '包赚', level: '金融风险', suggestion: '改为“历史案例参考，收益不承诺”' },
  { word: '稳赚', level: '金融风险', suggestion: '删除收益承诺表述' },
  { word: '史上最', level: '极限词', suggestion: '删除“史上最”前缀' },
]

function redfoxError(message, code, retryable) {
  const error = new Error(message)
  error.code = code
  error.retryable = retryable
  return error
}

async function redfoxFetch(fetchImpl, url, apiKey, options = {}) {
  const { headers: extraHeaders, ...rest } = options
  let response
  try {
    response = await fetchImpl(url, { headers: { accept: 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}), ...(extraHeaders || {}) }, ...rest })
  } catch {
    throw redfoxError('RedFox 服务暂时不可用', 'UPSTREAM_UNAVAILABLE', true)
  }
  if (!response.ok) {
    if (response.status === 429) throw redfoxError('RedFox 额度不足', 'QUOTA_EXCEEDED', true)
    throw redfoxError(`RedFox 请求失败: ${response.status}`, 'UPSTREAM_ERROR', response.status >= 500)
  }
  try {
    return await response.json()
  } catch {
    throw redfoxError('RedFox 返回了无效数据', 'UPSTREAM_ERROR', true)
  }
}

const demoHotSearchPool = {
  小红书: ['普通人做 IP 的第一性原理', '小而美账号的变现路径', '内容复利的真实案例', '知识博主的冷启动清单', '图文笔记的黄金结构'],
  抖音: ['口播账号的完播率公式', '创业复盘类内容为什么火', '打工人副业真实记录', '三天涨粉的方法论', '直播间信任感构建'],
  视频号: ['中年群体的内容消费迁移', '微信生态的信任转化', '视频号带货的真实数据'],
  公众号: ['长文时代的深度价值', '公众号爆款的结构拆解', '私域沉淀的内容钩子'],
  B站: ['中长视频的知识密度', '技术区作者的变现矩阵'],
  微博: ['热搜话题的选题迁移', '热点借势的合规边界'],
  X: ['出海创作者的定位选择', '英文内容的中国叙事'],
}

export function demoHotSearch(platform = '小红书') {
  const titles = demoHotSearchPool[platform] || demoHotSearchPool['小红书']
  return { source: 'demo', items: titles.map((title, index) => ({ rank: index + 1, title, heat: Math.round(960 - index * 87), platform })) }
}

export function demoTrending() {
  return normalizeResearchItem({
    platform: '小红书', title: '为什么越来越多创业者开始公开失败账本？', author: '创业观察室',
    metrics: { discussions: 2841, growth: 32 }, url: 'https://example.com/research/1',
    query: '个人 IP 商业创业', raw_payload: { source: 'mvp-sample' },
  }, { platform: '小红书', query: '个人 IP 商业创业' })
}

export function demoSearchWork(keyword, platform = '小红书') {
  const angles = ['真实过程记录', '一次失败的复盘', '方法拆解与步骤', '数据对比与结论', '常见误区澄清', '用户提问精选', '工具与效率', '长期主义观察']
  return {
    source: 'demo',
    items: angles.map((angle, index) => normalizeResearchItem({
      platform, title: `${keyword}：${angle}`, author: `示范作者 ${index + 1}`, url: null,
      metrics: { discussions: 1200 - index * 97, growth: 40 - index * 4 }, query: keyword,
    }, { platform, query: keyword })),
  }
}

export function demoProhibitedCheck(text = '') {
  const content = String(text || '')
  const hits = prohibitedWordlist.filter(entry => content.includes(entry.word)).map(entry => ({ ...entry }))
  return { source: 'demo', hits, checked_length: content.length }
}

export function demoSimilarAccounts(platform = '小红书', account = '') {
  const base = account || '你的领域'
  return {
    source: 'demo',
    items: [
      { nickname: `${base}观察室`, followers: '4.2w', pillar: '过程记录与复盘', similarity: 0.91, reason: '同样以真实经营数据建立信任，更新节奏稳定' },
      { nickname: `${base}方法论`, followers: '8.7w', pillar: '方法拆解教程', similarity: 0.84, reason: '内容支柱与你重合，粉丝体量高一档，适合作为标杆' },
      { nickname: `小城${base}日记`, followers: '1.1w', pillar: '个人故事叙事', similarity: 0.78, reason: '同价位对标，互动率高，评论区提问密度大' },
    ],
  }
}

export function createRedFoxAdapter({ baseUrl, apiKey, fetchImpl = fetch, paths = {} } = {}) {
  const endpoint = name => paths[name] || { hotSearch: '/v1/hot-search', searchWork: '/v1/search', prohibitedCheck: '/v1/prohibited-check', similarAccounts: '/v1/similar-accounts' }[name]
  const configured = Boolean(baseUrl && apiKey)
  const assertConfigured = () => {
    if (!configured) throw redfoxError('红狐 API 未配置', 'MISSING_CONFIG', false)
  }

  return {
    configured,
    async trending({ platform = '小红书', query = '个人 IP 商业创业', days = 7 } = {}) {
      assertConfigured()
      const url = new URL('/v1/trending', baseUrl)
      url.searchParams.set('platform', platform)
      url.searchParams.set('query', query)
      url.searchParams.set('days', String(days))
      const payload = await redfoxFetch(fetchImpl, url, apiKey)
      const rows = Array.isArray(payload) ? payload : payload.items || payload.data || []
      return rows.map(item => normalizeResearchItem(item, { platform, query }))
    },
    async hotSearch({ platform = '小红书' } = {}) {
      assertConfigured()
      const url = new URL(endpoint('hotSearch'), baseUrl)
      url.searchParams.set('platform', platform)
      const payload = await redfoxFetch(fetchImpl, url, apiKey)
      const rows = Array.isArray(payload) ? payload : payload.items || payload.data || []
      return { source: 'redfox', items: rows.map((item, index) => ({ rank: Number(item.rank || index + 1), title: item.title || item.name || '', heat: Number(item.heat || item.hot || 0), platform })) }
    },
    async searchWork({ platform = '小红书', keyword = '' } = {}) {
      assertConfigured()
      const url = new URL(endpoint('searchWork'), baseUrl)
      url.searchParams.set('platform', platform)
      url.searchParams.set('keyword', keyword)
      const payload = await redfoxFetch(fetchImpl, url, apiKey)
      const rows = Array.isArray(payload) ? payload : payload.items || payload.data || []
      return { source: 'redfox', items: rows.map(item => normalizeResearchItem(item, { platform, query: keyword })) }
    },
    async prohibitedCheck({ text = '' } = {}) {
      assertConfigured()
      const url = new URL(endpoint('prohibitedCheck'), baseUrl)
      const payload = await redfoxFetch(fetchImpl, url, apiKey, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
      const hits = Array.isArray(payload?.hits) ? payload.hits : []
      return { source: 'redfox', hits, checked_length: String(text).length }
    },
    async similarAccounts({ platform = '小红书', account = '' } = {}) {
      assertConfigured()
      const url = new URL(endpoint('similarAccounts'), baseUrl)
      url.searchParams.set('platform', platform)
      url.searchParams.set('account', account)
      const payload = await redfoxFetch(fetchImpl, url, apiKey)
      const rows = Array.isArray(payload) ? payload : payload.items || payload.data || []
      return { source: 'redfox', items: rows.map(item => ({ nickname: item.nickname || item.name || '', followers: String(item.followers || item.fans || ''), pillar: item.pillar || item.category || '', similarity: Number(item.similarity || item.score || 0), reason: item.reason || item.analysis || '' })) }
    },
  }
}
