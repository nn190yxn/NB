import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { guideColdStartPaths, guideProgress, guideStages, guideState } from './guide.mjs'
import { testPort } from './test-port.mjs'

const llmMock = await startSharedLlmMock()
const coldStartPaths = guideColdStartPaths

test('单步路由：没做过就带他走一遍，做到一半指出下一步，走完转成任务后导航', () => {
  const empty = guideState({}, { coldStartPaths })
  assert.equal(empty.mode, '新手教程')
  assert.equal(empty.next.id, 'positioning')
  assert.equal(empty.next.index, 1)
  assert.equal(empty.done_count, 0)
  // 引导覆盖从定位到发布的完整链路：十一个环节，每个都给出一个动作。
  assert.equal(empty.total, 11)
  assert.deepEqual(empty.stages.map(stage => stage.id), guideStages.map(stage => stage.id))
  assert.ok(empty.stages.every(stage => stage.action && stage.needs && stage.label))
  assert.ok(empty.stages.some(stage => stage.id === 'publish'))
  assert.ok(empty.stages.some(stage => stage.id === 'shooting'))

  const halfway = guideState({ positioning: { positioning_statement: '服务做过内容但没成交的人' }, materials: [{ id: 1, content: '素材' }] }, { coldStartPaths })
  assert.equal(halfway.mode, '任务前路由')
  assert.equal(halfway.next.id, 'research')
  assert.deepEqual(halfway.completed, ['定位', '素材'])
  // 非强制线性：所有环节都带 done 状态摆出来，界面可以随便跳，不是必须顺着走。
  assert.equal(halfway.stages.filter(stage => stage.done).length, 2)

  const full = guideState({
    positioning: { positioning_statement: '定位' },
    materials: [{ id: 1, content: '素材' }],
    research: [{ id: 1 }],
    structures: [{ id: 1 }],
    topics: [{ id: 1 }],
    drafts: [{ id: 1, checks: { persona: { status: 'pass' } }, approval: { status: 'approved' } }],
    shooting: [{ id: 1, status: 'published' }],
    performance_snapshots: [{ id: 1, status: 'confirmed', metrics: { views: 100 } }],
  }, { coldStartPaths })
  assert.equal(full.mode, '任务后导航')
  assert.equal(full.next, null)
  assert.equal(full.done_count, 11)
})

test('冷启动降级：定位、素材、对标全空时给降级路径，并说清缺什么、补上能得到什么', () => {
  const state = guideState({}, { coldStartPaths })
  assert.equal(state.degraded.active, true)
  assert.deepEqual(state.degraded.missing, ['定位', '素材', '对标'])
  assert.deepEqual(state.degraded.paths.map(path => path.id), ['small_sample', 'narrow_scope', 'topic_only'])
  assert.match(state.degraded.gain, /补上/)

  // 只要补上任意一样，就不算冷启动，回到正常单步路由。
  const started = guideState({ materials: [{ id: 1, content: '素材' }] }, { coldStartPaths })
  assert.equal(started.degraded.active, false)
  assert.deepEqual(started.degraded.paths, [])
  // 空文档不算写过定位。
  assert.equal(guideProgress({ positioning: { updated_at: '2026-09-18' } }).positioning, false)
  assert.equal(guideProgress({ positioning: { positioning_statement: '服务做过内容但没成交的人' } }).positioning, true)
  // 软删的素材不算数。
  assert.equal(guideProgress({ materials: [{ id: 1, deleted_at: '2026-09-18' }] }).materials, false)
})

function startServer(listenPort, dataFile) {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...llmMock.env, PORT: String(listenPort), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务启动超时')), 15000)
    child.stdout.on('data', chunk => { if (String(chunk).includes('Content IP API listening')) { clearTimeout(timer); resolve(child) } })
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`服务退出：${code}`)) })
  })
}

test('新手进来只看到一个动作，冷启动降级路径一并给到', async t => {
  const port = testPort(41250, 150)
  const dir = mkdtempSync(join(tmpdir(), 'guide-'))
  const server = await startServer(port, join(dir, 'state.json'))
  t.after(() => { server.kill(); rmSync(dir, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${port}`
  const headers = { 'x-user-id': 'guide-newbie', 'content-type': 'application/json' }

  const response = await fetch(`${base}/api/guide`, { headers })
  const guide = await response.json()
  assert.equal(response.status, 200, `取路由失败：${JSON.stringify(guide).slice(0, 200)}`)
  assert.equal(guide.mode, '新手教程')
  assert.equal(guide.next.id, 'positioning')
  assert.equal(guide.next.index, 1)
  assert.equal(guide.degraded.active, true)
  assert.ok(guide.degraded.paths.length >= 1, '缺素材缺定位的时候要给出降级路径，而不是直接进重流程')
  assert.deepEqual(guide.degraded.missing, ['定位', '素材', '对标'])
  assert.deepEqual(guide.degraded.paths.map(path => path.id), ['small_sample', 'narrow_scope', 'topic_only'])
  assert.deepEqual(guide.degraded.paths.map(path => path.label), ['先做小样本', '先收缩边界', '直接用纯选题生成一版没有素材的初稿'])
  assert.equal(guide.stages.length, 11)

  // 补上定位之后降级提示消失，下一步顺着链路走到素材。
  const saved = await fetch(`${base}/api/positioning`, { method: 'PUT', headers, body: JSON.stringify({ positioning_statement: '服务做过内容但没成交的人' }) })
  assert.equal(saved.status, 200, '定位保存失败')
  const after = await (await fetch(`${base}/api/guide`, { headers })).json()
  assert.equal(after.degraded.active, false)
  assert.deepEqual(after.completed, ['定位'])
  assert.equal(after.next.id, 'materials')
})
