// 红狐官网 API（https://redfox.hk）适配层。
// 接口路径、请求体与响应结构以官网文档系统 /story/web/api/doc/detail/no/* 为准（2026-09-06 核对）：
//   POST /story/api/hotKeyword/list                      全网聚合热点TOP10
//   GET  /story/api/hotSpot/getListByPlatform            各平台热点榜（platform: 1快手 2抖音 5微博 6小红书 7百度 8B站 9知乎 10今日头条）
//   POST /story/api/hotSpot/getListByPlatformWithKeyword 全网热搜查询（关键词，时间跨度≤30天）
//   POST /story/api/xhsUser/searchUser                   搜索关键词获取小红书账号
//   POST /story/api/xhsUser/searchArticle                搜索关键词获取小红书作品
//   POST /story/api/dyData/searchArticle                 搜索关键词获取抖音作品
//   POST /story/api/gzhData/searchArticle                搜索关键词获取公众号作品
//   POST /story/api/sphAllData/searchWork                搜索关键词获取视频号作品
//   POST /story/api/ksAllData/searchWork                 快手按关键词搜索作品
//   POST /story/api/bili/data/workSearch                 搜索关键词获取哔哩哔哩作品
//   POST /story/api/toutiao/searchWork                   搜索今日头条作品
// 官网未提供违禁词检测接口，多平台违禁词检测保持本地词库（prohibitedWordlist）。
// 鉴权请求头为 REDFOX_API_KEY（官网文档唯一必填头），成功响应统一为 { code: 2000, msg, data }。

export const redfoxDefaultBaseUrl = 'https://redfox.hk'

const hotBoardPlatformCodes = { 快手: 1, 抖音: 2, 微博: 5, 小红书: 6, 百度: 7, B站: 8, 知乎: 9, 今日头条: 10 }

// 官网文档示例确认的响应分组键（bdList 为百度热搜，含 baidu.com 链接）；其余分组键待真实联调后补充
const keywordHotPlatformLabels = { bdList: '百度' }

const searchEndpoints = {
  小红书: { path: '/story/api/xhsUser/searchArticle', body: keyword => ({ keyword, offset: 0, sortType: '_0', exactMatch: false }) },
  抖音: { path: '/story/api/dyData/searchArticle', body: keyword => ({ keyword, offset: 0, sortType: 'default' }) },
  公众号: { path: '/story/api/gzhData/searchArticle', body: keyword => ({ keyword, offset: 0, sortType: '_0', exactMatch: false }) },
  视频号: { path: '/story/api/sphAllData/searchWork', body: keyword => ({ keyword, page: 1, size: 20 }) },
  快手: { path: '/story/api/ksAllData/searchWork', body: keyword => ({ keyword, page: 1, size: 20, sort: '综合' }) },
  B站: { path: '/story/api/bili/data/workSearch', body: keyword => ({ keyword, page: '1', pageSize: 10, order: 'time' }) },
  今日头条: { path: '/story/api/toutiao/searchWork', body: keyword => ({ keyword, offset: '0' }) },
}

const pad = value => String(value).padStart(2, '0')
const ymd = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const ymdHms = date => `${ymd(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`

// 官网部分平台返回"920.8w/11.9万/2.3亿"格式的热度值
export function parseHeatValue(value) {
  const text = String(value ?? '').trim().replace(/,/g, '')
  if (!text) return 0
  const wan = text.match(/^([\d.]+)\s*(?:万|w|W)$/)
  if (wan) return Math.round(Number(wan[1]) * 10000)
  const yi = text.match(/^([\d.]+)\s*(?:亿)$/)
  if (yi) return Math.round(Number(yi[1]) * 100000000)
  const num = Number(text)
  return Number.isFinite(num) ? num : 0
}

export function normalizeResearchItem(payload, { platform = '未知平台', query = '' } = {}) {
  const item = payload?.item || payload || {}
  const discussions = Number(item.discussions ?? item.comments ?? item.commentCount ?? item.readCount ?? 0)
  return {
    platform: item.platform || platform,
    title: item.title || item.name || item.workTitle || item.caption || '未命名研究条目',
    author: item.author || item.authorName || item.nickname || item.creator || '',
    url: item.url || item.workUrl || item.source_url || item.opusUrl || null,
    metrics: item.metrics || { discussions, growth: Number(item.growth || 0) },
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

function extractList(data) {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []
  for (const key of ['list', 'workList', 'items', 'records']) if (Array.isArray(data[key])) return data[key]
  return []
}

async function redfoxFetch(fetchImpl, url, apiKey, options = {}) {
  const { headers: extraHeaders, ...rest } = options
  let response
  try {
    response = await fetchImpl(url, { headers: { accept: 'application/json', ...(apiKey ? { REDFOX_API_KEY: apiKey } : {}), ...(extraHeaders || {}) }, ...rest })
  } catch {
    throw redfoxError('RedFox 服务暂时不可用', 'UPSTREAM_UNAVAILABLE', true)
  }
  if (!response.ok) {
    if (response.status === 429) throw redfoxError('RedFox 额度不足或请求过于频繁', 'QUOTA_EXCEEDED', true)
    if (response.status === 401 || response.status === 403) throw redfoxError(`RedFox 鉴权失败（HTTP ${response.status}），请检查 API Key 是否有效`, 'AUTH_FAILED', false)
    throw redfoxError(`RedFox 请求失败: HTTP ${response.status}`, 'UPSTREAM_ERROR', response.status >= 500)
  }
  let payload
  try { payload = JSON.parse(await response.text()) } catch {
    throw redfoxError('RedFox 返回了无法解析的内容，请确认 Base URL 与接口路径是否正确', 'UPSTREAM_ERROR', false)
  }
  if (payload && typeof payload === 'object' && 'code' in payload && payload.code !== 2000) {
    const message = String(payload.msg || payload.message || '').trim()
    throw redfoxError(`RedFox 业务错误（code ${payload.code}）${message ? `：${message}` : ''}`, 'UPSTREAM_ERROR', false)
  }
  return payload
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

export function createRedFoxAdapter({ baseUrl, apiKey, fetchImpl = fetch } = {}) {
  const base = String(baseUrl || '').trim() || redfoxDefaultBaseUrl
  const configured = Boolean(apiKey)
  const assertConfigured = () => {
    if (!configured) throw redfoxError('红狐 API 未配置', 'MISSING_CONFIG', false)
  }

  return {
    configured,
    async trending() {
      assertConfigured()
      const now = new Date()
      const start = new Date(now.getTime() - 24 * 3_600_000)
      const payload = await redfoxFetch(fetchImpl, new URL('/story/api/hotKeyword/list', base), apiKey, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ startDate: ymdHms(start), endDate: ymdHms(now) }),
      })
      const groups = Array.isArray(payload?.data) ? payload.data : []
      const rows = groups.flatMap(group => Array.isArray(group?.hotSpotList) ? group.hotSpotList : [])
      return rows.map(item => normalizeResearchItem({ platform: item.platName || '多平台', title: item.title, url: item.url, source_url: item.url, comments: Number(item.maxHotScore || 0) }, { query: '全网聚合热点' }))
    },
    async hotSearch({ platform = '小红书' } = {}) {
      assertConfigured()
      const code = hotBoardPlatformCodes[platform]
      if (!code) throw redfoxError(`红狐热搜榜暂不支持平台：${platform}`, 'UNSUPPORTED_PLATFORM', false)
      const start = new Date()
      const end = new Date(start.getTime() + 24 * 3_600_000)
      const url = new URL('/story/api/hotSpot/getListByPlatform', base)
      url.searchParams.set('platform', String(code))
      url.searchParams.set('startDate', ymd(start))
      url.searchParams.set('endDate', ymd(end))
      const payload = await redfoxFetch(fetchImpl, url, apiKey)
      const rows = Array.isArray(payload?.data) ? payload.data : []
      return { source: 'redfox', items: rows.map((item, index) => ({ rank: Number(item.index || index + 1), title: item.title || '', heat: parseHeatValue(item.hotCount), platform, url: item.url || null })) }
    },
    async keywordHotSearch({ keywords = [], platforms = [], days = 7 } = {}) {
      assertConfigured()
      const words = (Array.isArray(keywords) ? keywords : [keywords]).map(item => String(item || '').trim()).filter(Boolean)
      if (!words.length) throw redfoxError('关键词为必填项', 'INVALID_INPUT', false)
      const now = new Date()
      const start = new Date(now.getTime() - Math.min(Math.max(Number(days) || 7, 1), 30) * 24 * 3_600_000)
      const payload = await redfoxFetch(fetchImpl, new URL('/story/api/hotSpot/getListByPlatformWithKeyword', base), apiKey, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platforms, keywords: words, startDate: ymd(start), endDate: ymd(now) }),
      })
      const data = payload?.data
      const items = []
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        for (const [key, rows] of Object.entries(data)) {
          if (!Array.isArray(rows)) continue
          for (const row of rows) items.push({ platform: keywordHotPlatformLabels[key] || key, rank: Number(row.index || 0), title: row.title || '', heat: parseHeatValue(row.hotCount), url: row.url || null })
        }
      } else if (Array.isArray(data)) {
        for (const row of data) items.push({ rank: Number(row.index || 0), title: row.title || '', heat: Number(row.hotCount || 0), url: row.url || null })
      }
      return { source: 'redfox', items }
    },
    async searchWork({ platform = '小红书', keyword = '' } = {}) {
      assertConfigured()
      const endpoint = searchEndpoints[platform]
      if (!endpoint) throw redfoxError(`红狐作品搜索暂不支持平台：${platform}`, 'UNSUPPORTED_PLATFORM', false)
      const payload = await redfoxFetch(fetchImpl, new URL(endpoint.path, base), apiKey, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(endpoint.body(String(keyword || '').trim())),
      })
      const rows = extractList(payload?.data)
      return { source: 'redfox', items: rows.map(item => {
        const extra = platform === 'B站' && item.bvId && !item.workUrl && !item.url ? { url: `https://www.bilibili.com/video/${item.bvId}` } : {}
        return normalizeResearchItem({ ...item, ...extra }, { platform, query: keyword })
      }) }
    },
    async prohibitedCheck({ text = '' } = {}) {
      const content = String(text || '')
      const hits = prohibitedWordlist.filter(entry => content.includes(entry.word)).map(entry => ({ ...entry }))
      return { source: 'builtin', hits, checked_length: content.length }
    },
    async similarAccounts({ platform = '小红书', account = '' } = {}) {
      assertConfigured()
      if (platform !== '小红书') throw redfoxError('红狐对标账号搜索目前仅支持小红书', 'UNSUPPORTED_PLATFORM', false)
      const keyword = String(account || '').trim()
      if (!keyword) throw redfoxError('对标账号关键词不能为空', 'INVALID_INPUT', false)
      const payload = await redfoxFetch(fetchImpl, new URL('/story/api/xhsUser/searchUser', base), apiKey, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keyword, offset: 0, sortType: '_0' }),
      })
      const rows = extractList(payload?.data)
      return { source: 'redfox', items: rows.map(item => ({
        nickname: item.accountName || '',
        followers: String(item.accountFans ?? ''),
        pillar: '',
        similarity: null,
        reason: String(item.accountDesc || '').slice(0, 120),
        url: item.accountId ? `https://www.xiaohongshu.com/user/profile/${item.accountId}` : null,
      })) }
    },
  }
}
