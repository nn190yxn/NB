import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
})

test('闭环链路：适配、复盘入记忆、日历与匹配排序', async t => {
  const server = await startServer()
  t.after(() => server.kill())

  await put('/api/profile', { role: '帮本地生意老板做诊断', pillars: ['本地生意'], audiences: ['实体店老板'] })

  const drafts = await (await post('/api/drafts/generate', { topic: { title: '最好的一课', strategy_layer: 'trust', goal_refs: [] } })).json()
  const draft = drafts[0]

  const adapted = await (await post(`/api/drafts/${draft.id}/adapt`, { platform: '小红书' })).json()
  const xhs = adapted.adaptations['小红书']
  assert.ok(xhs)
  assert.ok(xhs.checklist.some(entry => entry.item === '无违禁词风险' && entry.status === '风险'))
  assert.ok(xhs.hashtags.some(tag => tag.startsWith('#')))

  const deai = await post(`/api/drafts/${draft.id}/deai`, {})
  assert.equal(deai.status, 422)
  assert.equal((await deai.json()).reason, 'llm_not_configured')

  const snapshot = await (await post('/api/performance-snapshots', { draft_id: draft.id, platform: '抖音', metrics: { 播放量: 2000, 点赞数: 120, 评论数: 60, 收藏数: 90 }, status: 'confirmed' })).json()
  const retro = await (await post(`/api/performance-snapshots/${snapshot.id}/retrospect`, {})).json()
  assert.ok(['winner', 'ok', 'underperformed'].includes(retro.snapshot.retrospect.verdict))
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
