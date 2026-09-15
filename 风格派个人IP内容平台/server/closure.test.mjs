import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startSharedLlmMock } from './generation-test-helper.mjs'
const llmMock = await startSharedLlmMock()
import { buildChecklist, deterministicAdaptation, fitScore, retrospectDeterministic } from './growth.mjs'

const port = 47000 + Math.floor(Math.random() * 200)
const baseUrl = `http://127.0.0.1:${port}`
const headers = { 'content-type': 'application/json', 'x-user-id': 'closure-user' }

function startServer(extraEnv = {}) {
  const testDataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-closure-')), 'data.json')
  writeFileSync(testDataFile, '{}')
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: testDataFile, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 5000)
    child.stdout.on('data', data => {
      if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) }
    })
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

const post = (path, body = {}) => fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
const put = (path, body = {}) => fetch(`${baseUrl}${path}`, { method: 'PUT', headers, body: JSON.stringify(body) })
const get = path => fetch(`${baseUrl}${path}`, { headers })

test('growth 纯函数：清单、适配、复盘与匹配评分', () => {
  const checklist = buildChecklist('抖音', '正文'.repeat(200), [{ word: '最好', level: '极限词' }])
  assert.ok(checklist.some(entry => entry.status === '风险' && entry.detail.includes('最好')))
  assert.ok(checklist.some(entry => entry.item.includes('口播') && entry.status === '注意'))

  const clean = buildChecklist('小红书', '短正文', [])
  assert.ok(clean.some(entry => entry.item === '无违禁词风险' && entry.status === '通过'))

  const adapted = deterministicAdaptation({ title: '一个超过二十个字需要被截断的标题'.repeat(2), body: '正文' }, '小红书', { pillars: ['本地生意'], audiences: [] })
  assert.ok(adapted.title.length <= 20)
  assert.deepEqual(adapted.hashtags, ['#本地生意'])

  const snapshot = { platform: '抖音', metrics: { 播放量: 1000, 点赞数: 80, 评论数: 40, 收藏数: 60, 转发数: 20 } }
  const retrospect = retrospectDeterministic(snapshot, { title: '测试内容' }, [])
  assert.equal(retrospect.verdict, 'winner')
  assert.ok(retrospect.lessons.length >= 1)
  assert.ok(retrospect.drivers.includes('收藏') || retrospect.drivers.includes('点赞') || retrospect.drivers.includes('评论'))

  const fit = fitScore({ title: '本地生意的副业复盘', platform: '小红书', captured_at: new Date().toISOString() }, { pillars: ['本地生意'], audiences: [], problems: [] }, { platform_preferences: ['小红书'] })
  assert.ok(fit.score >= 4)
  assert.ok(fit.matched.includes('本地生意'))

test('复盘用界面真实指标键名时，收藏必须算进互动率与判定', () => {
  // 界面（metricLabels）写入的键是 views/likes/comments/favorites/shares；
  // 旧写法只认 collect/收藏，收藏被当成 0：这条 600 收藏的笔记会被判成「表现持平」而不是「优于往常」。
  const snapshot = { platform: '小红书', metrics: { views: 10000, likes: 30, comments: 20, favorites: 600, shares: 10, followers: 12 } }
  const retrospect = retrospectDeterministic(snapshot, { title: '一条干货笔记' }, [])
  assert.equal(retrospect.drivers[0], '收藏', `收藏应成为首要驱动，实际 ${JSON.stringify(retrospect.drivers)}`)
  assert.ok(retrospect.rate > 0.06, `互动率应含收藏，实际 ${retrospect.rate}`)
  assert.equal(retrospect.verdict, 'winner')
  assert.ok(retrospect.lessons.some(lesson => lesson.includes('收藏占比突出')))
  // 基线随结果返回：无历史时 peer_count 0、peer_average null；有历史时给出均值
  assert.equal(retrospect.peer_count, 0)
  assert.equal(retrospect.peer_average, null)
  const withPeers = retrospectDeterministic({ platform: '抖音', metrics: { views: 1000, likes: 30 } }, { title: '第二条' }, [
    { retrospect: { rate: 0.01 } },
    { retrospect: { rate: 0.03 } },
  ])
  assert.equal(withPeers.peer_count, 2)
  assert.equal(withPeers.peer_average, 0.02)
  assert.equal(withPeers.verdict, 'winner', '3% 比 2% 的基线高 50%，按规则判 winner')
  // 同一份数据，没有基线时按绝对口径（互动率 3% < 5%）判 ok —— 说明基线确实参与了判定
  assert.equal(retrospectDeterministic({ platform: '抖音', metrics: { views: 1000, likes: 30 } }, { title: '第二条' }, []).verdict, 'ok')
  // 保留旧口径：中文键名的快照同样要能算对
  const chinese = retrospectDeterministic({ platform: '抖音', metrics: { 播放量: 1000, 点赞数: 80, 评论数: 40, 收藏数: 60, 转发数: 20 } }, { title: '测试内容' }, [])
  // 中文键同样要算对：点赞 80 / 收藏 60 / 评论 40 / 转发 20 / 播放 1000 → 互动率 20%，收藏排第二
  assert.equal(chinese.rate, 0.2)
  assert.ok(chinese.drivers.includes('收藏'), `中文键下收藏应进驱动，实际 ${JSON.stringify(chinese.drivers)}`)
})
})

test('闭环链路：适配、复盘入记忆、日历与匹配排序', async t => {
  const server = await startServer(llmMock.env)
  t.after(() => server.kill())

  await put('/api/profile', { role: '帮本地生意老板做诊断', pillars: ['本地生意'], audiences: ['实体店老板'] })

  const drafts = await (await post('/api/drafts/generate', { topic: { title: '最好的一课', strategy_layer: 'trust', goal_refs: [] } })).json()
  const draft = drafts[0]

  assert.equal(draft.body, '小红书正文：最好的一课')

  const adapted = await (await post(`/api/drafts/${draft.id}/adapt`, { platform: '小红书' })).json()
  const xhs = adapted.adaptations['小红书']
  assert.ok(xhs)
  assert.equal(xhs.provider, 'primary')
  assert.ok(xhs.checklist.some(entry => entry.item === '无违禁词风险'))
  assert.ok(xhs.hashtags.some(tag => tag.startsWith('#')))

  const deai = await post(`/api/drafts/${draft.id}/deai`, {})
  assert.equal(deai.status, 200)
  assert.equal((await deai.json()).content, '去 AI 感之后的正文')

  const snapshot = await (await post('/api/performance-snapshots', { draft_id: draft.id, platform: '抖音', metrics: { 播放量: 2000, 点赞数: 120, 评论数: 60, 收藏数: 90 }, status: 'confirmed' })).json()
  const retro = await (await post(`/api/performance-snapshots/${snapshot.id}/retrospect`, {})).json()
  assert.ok(['winner', 'ok', 'underperformed'].includes(retro.snapshot.retrospect.verdict))
  // 走大模型的复盘也必须记下 rate：peers 只认有 rate 的快照，缺了就等于永远没有「往常」可比
  assert.equal(retro.snapshot.retrospect.provider, 'primary')
  assert.ok(Number.isFinite(retro.snapshot.retrospect.rate), `模型路径也要有 rate，实际 ${retro.snapshot.retrospect.rate}`)
  assert.equal(retro.snapshot.retrospect.peer_count, 0)

  const secondSnapshot = await (await post('/api/performance-snapshots', { draft_id: draft.id, platform: '抖音', metrics: { 播放量: 4000, 点赞数: 40 }, status: 'confirmed' })).json()
  const secondRetro = await (await post(`/api/performance-snapshots/${secondSnapshot.id}/retrospect`, {})).json()
  assert.equal(secondRetro.snapshot.retrospect.peer_count, 1, '第一条复盘应成为第二条的基线')
  assert.equal(secondRetro.snapshot.retrospect.peer_average, retro.snapshot.retrospect.rate)
  assert.ok(retro.memories_added >= 1)
  const memories = await (await get('/api/memories')).json()
  assert.ok(memories.some(item => item.memory_type === 'feedback' && item.source === 'auto' && item.content.includes('复盘')))

  await put(`/api/drafts/${draft.id}`, { planned_date: '2026-09-10' })
  const badDate = await put(`/api/drafts/${draft.id}`, { planned_date: '09/10' })
  assert.equal(badDate.status, 422)
  const calendar = await (await get('/api/calendar?month=2026-09')).json()
  assert.ok(calendar.entries.some(entry => entry.type === 'draft' && entry.date === '2026-09-10' && entry.title === '最好的一课'))

  await post('/api/research/hot-search/collect', { entries: [{ title: '本地生意老板的副业突围', heat: 888 }], platform: '小红书' })
  await post('/api/research/hot-search/collect', { entries: [{ title: ' completely unrelated title about cooking pasta ', heat: 100 }], platform: '小红书' })
  const fitList = await (await get('/api/research?sort=fit')).json()
  assert.ok(Array.isArray(fitList.items) && fitList.items.length >= 2)
  assert.ok(fitList.items[0].fit.score >= fitList.items[fitList.items.length - 1].fit.score)
  assert.ok(fitList.items.some(item => item.fit && item.fit.score > 0 && item.title.includes('本地生意')))
})
