import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { daysLeft, hotMaterialExpiry, hotMaterialShelfDays, materialExpired, materialPoolOf, materialPoolSummary, materialUsable, poolFieldsForNew, useTagOf, withPoolFields } from './material-pools.mjs'
import { testPort } from './test-port.mjs'

const now = new Date('2026-09-19T00:00:00.000Z')
const inDays = days => new Date(now.getTime() + days * 86400000).toISOString()

test('分池只看会不会过期：有保鲜期是热点池，没有是自建池', () => {
  assert.equal(materialPoolOf({ expires_at: inDays(5) }), 'hot')
  assert.equal(materialPoolOf({ expires_at: null }), 'built')
  assert.equal(materialPoolOf({}), 'built')
  assert.equal(materialPoolOf({ expires_at: '不是时间' }), 'built', '认不出的时间当没有，落到自建池')
})

test('用途签：只认戳人的和证明的，没填或乱填都是留空，不拦存', () => {
  assert.equal(useTagOf({ use_tag: 'pierce' }), 'pierce')
  assert.equal(useTagOf({ use_tag: 'proof' }), 'proof')
  assert.equal(useTagOf({ use_tag: '' }), null)
  assert.equal(useTagOf({}), null)
  assert.equal(useTagOf({ use_tag: '别的' }), null)
})

test('剩几天向上取整，过期返回 0 或负数', () => {
  assert.equal(daysLeft(inDays(3), now), 3)
  assert.equal(daysLeft(inDays(2.5), now), 3, '半天算一天，界面说「剩 3 天」不会提前过期')
  assert.equal(daysLeft(inDays(-1), now), -1)
  assert.equal(daysLeft(null, now), null)
})

test('能不能用：删了不能用，热点过期不能用，自建和没过期的热点都能用', () => {
  assert.equal(materialUsable({ expires_at: null }, now), true)
  assert.equal(materialUsable({ expires_at: inDays(3) }, now), true)
  assert.equal(materialUsable({ expires_at: inDays(-1) }, now), false)
  assert.equal(materialUsable({ expires_at: inDays(3), deleted_at: '2026-09-18T00:00:00.000Z' }, now), false, '撤回的素材不能用')
  assert.equal(materialExpired({ expires_at: inDays(-1) }, now), true)
  assert.equal(materialExpired({ expires_at: null }, now), false, '自建素材不会过期')
})

test('新建素材定池：热点类自动带保鲜期，其余不过期，显式给了就以显式为准', () => {
  const hot = poolFieldsForNew({ kind: 'hotspot', now })
  assert.equal(daysLeft(hot.expires_at, now), hotMaterialShelfDays, '默认保鲜期就是 30 天')
  assert.equal(poolFieldsForNew({ kind: 'insight', now }).expires_at, null)
  assert.equal(poolFieldsForNew({ kind: 'experience', now }).expires_at, null)
  assert.equal(poolFieldsForNew({ kind: 'hotspot', expiresAt: null, now }).expires_at, null, '显式传 null 表示不过期')
  assert.equal(poolFieldsForNew({ kind: 'hotspot', expiresAt: '不是时间', now }).expires_at, null, '显式给了无效时间也不写进坏值')
  assert.equal(poolFieldsForNew({ kind: 'insight', useTag: 'pierce', now }).use_tag, 'pierce')
  assert.equal(poolFieldsForNew({ kind: 'insight', now }).use_tag, null)
})

test('料台三个数：过期的热点不算能拍，戳人的和证明的各数各的', () => {
  const summary = materialPoolSummary([
    { id: 1, expires_at: inDays(3), use_tag: 'pierce' },
    { id: 2, expires_at: inDays(9), use_tag: 'proof' },
    { id: 3, expires_at: inDays(-2), use_tag: 'pierce' },
    { id: 4, expires_at: null, use_tag: 'pierce' },
    { id: 5, expires_at: null },
    { id: 6, expires_at: null, deleted_at: '2026-09-18T00:00:00.000Z', use_tag: 'proof' },
  ], now)
  assert.equal(summary.hot, 2, '只剩两条没过期的热点；过期那条沉底不再算在能拍里')
  assert.equal(summary.soonest_days, 3, '最快的几天后过期要能报出来')
  assert.equal(summary.pierce, 2, '过期的那条不算能起角度，撤回的那条也不算')
  assert.equal(summary.proof, 1)
  assert.equal(materialPoolSummary([], now).soonest_days, null, '一条热点都没有时不编天数')
})

test('列表读出来的每条素材都带分池结果', () => {
  const item = withPoolFields({ id: 1, expires_at: inDays(4), use_tag: 'proof' }, now)
  assert.equal(item.material_pool, 'hot')
  assert.equal(item.days_left, 4)
  assert.equal(item.expired, false)
  assert.equal(item.use_tag, 'proof')
  const built = withPoolFields({ id: 2 }, now)
  assert.equal(built.material_pool, 'built')
  assert.equal(built.days_left, null)
  assert.equal(built.use_tag, null)
})

const port = testPort(49200, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'material-pools-test-')), 'data.json')
writeFileSync(dataFile, '{}')

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 20000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

test('料台：老素材一条不丢地落进自建池，用途签留空；不填用途签也能存', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const headers = { 'x-user-id': 'pool-owner', 'content-type': 'application/json' }
  const post = (path, body) => fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })

  // 第 1 条：不填用途签——验收要求「不填也能存」。
  const drawn = await post('/api/materials/atoms', { kind: 'experience', text: '我自己踩过的坑' })
  assert.equal(drawn.status, 201, '不填用途签必须也能存')
  const drawnItem = await drawn.json()
  assert.equal(drawnItem.use_tag, null, '没填就是留空，不塞默认值')
  assert.equal(drawnItem.material_pool, 'built', '经历是自建素材，不会过期')
  assert.equal(drawnItem.expires_at, null)

  // 第 2 条：填了用途签。
  const tagged = await (await post('/api/materials/atoms', { kind: 'insight', text: '一个判断', use_tag: 'pierce' })).json()
  assert.equal(tagged.use_tag, 'pierce')

  // 第 3 条：热点类素材自动带保鲜期，落进热点池。
  const hot = await (await post('/api/materials/atoms', { kind: 'hotspot', text: '这周的一个由头' })).json()
  assert.equal(hot.material_pool, 'hot', '热点类素材要落进热点池')
  assert.ok(hot.expires_at, '热点素材必须带保鲜期')
  assert.equal(daysLeft(hot.expires_at), hotMaterialShelfDays, '默认保鲜期 30 天')

  // 分池筛选：两个池各只能看到自己那池，老素材一条不丢。
  const hotList = await (await fetch(`${baseUrl}/api/materials?pool=hot`, { headers })).json()
  assert.deepEqual(hotList.items.map(item => item.id), [hot.id], '热点池只列热点素材')
  const builtList = await (await fetch(`${baseUrl}/api/materials?pool=built`, { headers })).json()
  assert.deepEqual(builtList.items.map(item => item.id).sort((a, b) => a - b), [drawnItem.id, tagged.id].sort((a, b) => a - b), '自建池只列自建素材')

  const counts = await (await fetch(`${baseUrl}/api/materials?kind_counts=1`, { headers })).json()
  assert.equal(counts.pool_summary.hot, 1)
  assert.equal(counts.pool_summary.pierce, 1, '戳人的只数打了这个签的')
  assert.equal(counts.pool_summary.proof, 0)

  // 用途签要能改：用过一阵子才判得出这条是戳人的还是证明的，不该在录入那一刻就定死。
  const patch = body => fetch(`${baseUrl}/api/materials/${drawnItem.id}`, { method: 'PATCH', headers, body: JSON.stringify(body) })
  const patched = await patch({ use_tag: 'proof' })
  assert.equal(patched.status, 200)
  assert.equal((await patched.json()).use_tag, 'proof')
  assert.equal((await patch({ use_tag: '乱填的' })).status, 422, '乱填要拦')
  assert.equal((await (await patch({ use_tag: null })).json()).use_tag, null, '签要能撤掉')
  assert.equal((await patch({})).status, 200, '什么都不传也要能过，不能把没传的字段清掉')

  // 不带查询参数时（界面主列表走这条路）也要带分池结果，否则界面还得自己再算一遍口径。
  const all = await (await fetch(`${baseUrl}/api/materials`, { headers })).json()
  assert.equal(all.length, 3, '老素材一条不丢')
  assert.ok(all.every(item => ['hot', 'built'].includes(item.material_pool)))
  assert.ok(all.every(item => item.use_tag === null || ['pierce', 'proof'].includes(item.use_tag)))
})
