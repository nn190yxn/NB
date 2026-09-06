import test from 'node:test'
import assert from 'node:assert/strict'
import { createRedFoxAdapter, normalizeResearchItem, demoProhibitedCheck, parseHeatValue } from './redfox.mjs'

function captureAdapter(response, { status = 200 } = {}) {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', headers: options.headers || {}, body: options.body || '' })
    if (response instanceof Error) throw response
    return { ok: status >= 200 && status < 300, status, text: async () => typeof response === 'string' ? response : JSON.stringify(response) }
  }
  return { calls, adapter: createRedFoxAdapter({ baseUrl: 'https://redfox.hk', apiKey: 'test-key', fetchImpl }) }
}

test('RedFox 响应归一化并保留原始载荷', async () => {
  const item = normalizeResearchItem({ title: '测试热点', comments: 12, source_url: 'https://example.com/item' }, { platform: '抖音', query: '测试' })
  assert.deepEqual(item.metrics, { discussions: 12, growth: 0 })
  assert.equal(item.platform, '抖音')
  assert.equal(item.raw_payload.title, '测试热点')
})

test('聚合热点走官网 hotKeyword/list 并归一化各平台条目', async () => {
  const { calls, adapter } = captureAdapter({ code: 2000, msg: '成功', data: [{ hotSpotList: [{ platName: '快手', title: '热点A', maxHotScore: 9630519, url: 'https://example.com/a' }, { platName: '抖音', title: '热点B', maxHotScore: 409 }] }] })
  const items = await adapter.trending()
  const call = calls[0]
  assert.equal(call.url, 'https://redfox.hk/story/api/hotKeyword/list')
  assert.equal(call.method, 'POST')
  assert.equal(call.headers['REDFOX_API_KEY'], 'test-key')
  assert.equal(call.headers['content-type'], 'application/json')
  const body = JSON.parse(call.body)
  assert.match(body.startDate, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  assert.match(body.endDate, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  assert.equal(items.length, 2)
  assert.equal(items[0].platform, '快手')
  assert.equal(items[0].title, '热点A')
  assert.equal(items[0].metrics.discussions, 9630519)
  assert.equal(items[0].url, 'https://example.com/a')
  assert.equal(items[1].platform, '抖音')
})

test('平台热搜榜走官网 getListByPlatform 且平台编号正确', async () => {
  for (const [platform, code] of [['小红书', '6'], ['抖音', '2'], ['微博', '5'], ['B站', '8']]) {
    const { calls, adapter } = captureAdapter({ code: 2000, msg: '成功', data: [{ index: 1, title: '热搜第一名', hotCount: '11966636', url: 'https://example.com/1' }] })
    const result = await adapter.hotSearch({ platform })
    const url = new URL(calls[0].url)
    assert.equal(url.pathname, '/story/api/hotSpot/getListByPlatform')
    assert.equal(calls[0].method, 'GET')
    assert.equal(url.searchParams.get('platform'), code)
    assert.match(url.searchParams.get('startDate'), /^\d{4}-\d{2}-\d{2}$/)
    assert.match(url.searchParams.get('endDate'), /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(result.source, 'redfox')
    assert.deepEqual(result.items[0], { rank: 1, title: '热搜第一名', heat: 11966636, platform, url: 'https://example.com/1' })
  }
})

test('热度值支持官网的中文万/亿格式', () => {
  assert.equal(parseHeatValue('920.8w'), 9208000)
  assert.equal(parseHeatValue('11.9万'), 119000)
  assert.equal(parseHeatValue('2.3亿'), 230000000)
  assert.equal(parseHeatValue('11966636'), 11966636)
  assert.equal(parseHeatValue(''), 0)
  assert.equal(parseHeatValue(null), 0)
})

test('不支持的热搜平台返回明确错误', async () => {
  const { adapter } = captureAdapter({ code: 2000, data: [] })
  await assert.rejects(() => adapter.hotSearch({ platform: '视频号' }), error => error.code === 'UNSUPPORTED_PLATFORM' && error.message.includes('视频号'))
  await assert.rejects(() => adapter.hotSearch({ platform: 'X' }), error => error.code === 'UNSUPPORTED_PLATFORM')
})

test('关键词热搜走官网 getListByPlatformWithKeyword', async () => {
  const { calls, adapter } = captureAdapter({ code: 2000, msg: '成功', data: { bdList: [{ index: 1, title: '关键词热点', hotCount: '6657095', url: 'https://example.com/kw' }] } })
  const result = await adapter.keywordHotSearch({ keywords: ['三星'], days: 3 })
  const call = calls[0]
  assert.equal(call.url, 'https://redfox.hk/story/api/hotSpot/getListByPlatformWithKeyword')
  assert.equal(call.method, 'POST')
  const body = JSON.parse(call.body)
  assert.deepEqual(body.keywords, ['三星'])
  assert.deepEqual(body.platforms, [])
  assert.match(body.startDate, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(body.endDate, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(result.items[0].title, '关键词热点')
  assert.equal(result.items[0].platform, '百度')
})

test('各平台作品搜索按官网路径与请求体调用', async () => {
  const cases = [
    { platform: '小红书', path: '/story/api/xhsUser/searchArticle', body: { keyword: '副业', offset: 0, sortType: '_0', exactMatch: false } },
    { platform: '抖音', path: '/story/api/dyData/searchArticle', body: { keyword: '副业', offset: 0, sortType: 'default' } },
    { platform: '公众号', path: '/story/api/gzhData/searchArticle', body: { keyword: '副业', offset: 0, sortType: '_0', exactMatch: false } },
    { platform: '视频号', path: '/story/api/sphAllData/searchWork', body: { keyword: '副业', page: 1, size: 20 } },
    { platform: '快手', path: '/story/api/ksAllData/searchWork', body: { keyword: '副业', page: 1, size: 20, sort: '综合' } },
    { platform: 'B站', path: '/story/api/bili/data/workSearch', body: { keyword: '副业', page: '1', pageSize: 10, order: 'time' } },
    { platform: '今日头条', path: '/story/api/toutiao/searchWork', body: { keyword: '副业', offset: '0' } },
  ]
  for (const { platform, path, body } of cases) {
    const { calls, adapter } = captureAdapter({ code: 2000, msg: '成功', data: { list: [{ workTitle: '结果标题', workUrl: 'https://example.com/w', commentCount: 33, authorName: '作者甲' }] } })
    const result = await adapter.searchWork({ platform, keyword: '副业' })
    assert.equal(calls[0].url, `https://redfox.hk${path}`)
    assert.equal(calls[0].method, 'POST')
    assert.deepEqual(JSON.parse(calls[0].body), body)
    assert.equal(result.source, 'redfox')
    assert.equal(result.items[0].title, '结果标题')
    assert.equal(result.items[0].url, 'https://example.com/w')
    assert.equal(result.items[0].metrics.discussions, 33)
    assert.equal(result.items[0].author, '作者甲')
  }
})

test('B站搜索结果从 workList 提取并补全视频地址', async () => {
  const { adapter } = captureAdapter({ code: 2000, msg: '成功', data: { workList: [{ bvId: 'BV1abc', title: 'B站作品', description: '简介' }] } })
  const result = await adapter.searchWork({ platform: 'B站', keyword: '跑跑卡丁车' })
  assert.equal(result.items[0].url, 'https://www.bilibili.com/video/BV1abc')
  assert.equal(result.items[0].title, 'B站作品')
})

test('不支持搜索的平台返回明确错误', async () => {
  const { adapter } = captureAdapter({ code: 2000, data: [] })
  await assert.rejects(() => adapter.searchWork({ platform: 'X', keyword: '副业' }), error => error.code === 'UNSUPPORTED_PLATFORM')
})

test('对标账号走官网 xhsUser/searchUser 并映射账号字段', async () => {
  const { calls, adapter } = captureAdapter({ code: 2000, msg: '成功', data: { list: [{ accountName: '红狐对标号', accountFans: 25000, accountLikes: 88000, accountDesc: '内容支柱接近', accountId: '6712113999' }] } })
  const result = await adapter.similarAccounts({ platform: '小红书', account: '某某聊IP' })
  const call = calls[0]
  assert.equal(call.url, 'https://redfox.hk/story/api/xhsUser/searchUser')
  assert.equal(call.method, 'POST')
  assert.deepEqual(JSON.parse(call.body), { keyword: '某某聊IP', offset: 0, sortType: '_0' })
  assert.equal(result.source, 'redfox')
  assert.equal(result.items[0].nickname, '红狐对标号')
  assert.equal(result.items[0].followers, '25000')
  assert.equal(result.items[0].url, 'https://www.xiaohongshu.com/user/profile/6712113999')
})

test('对标账号仅支持小红书且关键词必填', async () => {
  const { adapter } = captureAdapter({ code: 2000, data: [] })
  await assert.rejects(() => adapter.similarAccounts({ platform: '抖音', account: '某某' }), error => error.code === 'UNSUPPORTED_PLATFORM')
  await assert.rejects(() => adapter.similarAccounts({ platform: '小红书', account: ' ' }), error => error.code === 'INVALID_INPUT')
})

test('违禁词检测使用本地词库且不发起任何上游请求', async () => {
  const { calls, adapter } = captureAdapter({ code: 2000, data: [] })
  const result = await adapter.prohibitedCheck({ text: '这是第一名的 100% 文案' })
  assert.deepEqual(calls, [])
  assert.equal(result.source, 'builtin')
  assert.ok(result.hits.some(hit => hit.word === '第一'))
  assert.ok(result.hits.some(hit => hit.word === '100%'))
  assert.equal(result.checked_length, '这是第一名的 100% 文案'.length)
  assert.equal(demoProhibitedCheck('最好').hits[0].word, '最好')
})

test('未配置 Key 返回 MISSING_CONFIG', async () => {
  const adapter = createRedFoxAdapter({ baseUrl: 'https://redfox.hk', apiKey: '', fetchImpl: async () => { throw new Error('不应发起请求') } })
  await assert.rejects(() => adapter.trending(), error => error.code === 'MISSING_CONFIG')
})

test('RedFox 额度不足返回可识别错误', async () => {
  const { adapter } = captureAdapter('', { status: 429 })
  await assert.rejects(() => adapter.trending(), error => error.code === 'QUOTA_EXCEEDED' && error.retryable === true && error.message.includes('额度不足'))
})

test('RedFox 鉴权失败不泄露 Key', async () => {
  const { adapter } = captureAdapter('', { status: 401 })
  await assert.rejects(() => adapter.trending(), error => {
    assert.equal(error.code, 'AUTH_FAILED')
    assert.equal(error.retryable, false)
    assert.doesNotMatch(error.message, /test-key/)
    return true
  })
})

test('RedFox 不可用返回可重试错误', async () => {
  const { adapter } = captureAdapter(new Error('连接失败'))
  await assert.rejects(() => adapter.trending(), error => error.code === 'UPSTREAM_UNAVAILABLE' && error.retryable === true)
})

test('RedFox 5xx 返回可重试错误，4xx 不可重试', async () => {
  const failing = captureAdapter('', { status: 502 })
  await assert.rejects(() => failing.adapter.trending(), error => error.code === 'UPSTREAM_ERROR' && error.retryable === true)
  const clientError = captureAdapter('', { status: 404 })
  await assert.rejects(() => clientError.adapter.trending(), error => error.code === 'UPSTREAM_ERROR' && error.retryable === false)
})

test('HTML 或非 JSON 响应返回可行动错误', async () => {
  const { adapter } = captureAdapter('<!DOCTYPE html><html><body>404</body></html>')
  await assert.rejects(() => adapter.trending(), error => error.code === 'UPSTREAM_ERROR' && /无法解析|Base URL/.test(error.message))
})

test('非 2000 业务码透传官网错误信息', async () => {
  const { adapter } = captureAdapter({ code: 3001, msg: '余额不足' })
  await assert.rejects(() => adapter.trending(), error => error.code === 'UPSTREAM_ERROR' && error.message.includes('3001') && error.message.includes('余额不足'))
})
