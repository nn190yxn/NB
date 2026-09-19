import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

const llmMock = await startSharedLlmMock()
const port = testPort(49100, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'cold-start-test-')), 'data.json')
writeFileSync(dataFile, '{}')

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...llmMock.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

// 角色约定（README 第 0 节）：门槛只设在技术做不到的事上，不设在「你还没录入」的事上。
// 缺定位、没来源都照常生成，只把缺口作为提示带回来。
test('冷启动：缺定位不拦停，改成照常生成 + 提示，而且降级路径真的能走通', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'cold-start-owner'
  const headers = { 'x-user-id': owner, 'content-type': 'application/json' }

  // 新用户：定位、素材库、对标都是空的。先建一条来源，好让请求走到「缺定位」这一步。
  const material = await (await fetch(`${baseUrl}/api/materials/atoms`, { method: 'POST', headers, body: JSON.stringify({ kind: 'insight', text: '一个还没成型的想法', name: '临时来源' }) })).json()
  assert.ok(material.id)

  // 第 1 条：缺定位时必须照常生成——不知道做什么号的人，正是最需要系统给方向的人。
  const generated = await fetch(`${baseUrl}/api/topics/generate`, { method: 'POST', headers, body: JSON.stringify({ material_ids: [material.id] }) })
  assert.equal(generated.status, 201, '缺定位必须照常生成，不能拦停')
  const topics = await generated.json()
  assert.ok(topics.length > 0)
  const coldStart = topics[0].generation_context.cold_start
  assert.equal(coldStart.code, 'COLD_START')
  assert.deepEqual(coldStart.missing_fields, ['role', 'audiences', 'pillars'])
  assert.ok(coldStart.gain, '第 3 条：要说清补上之后能得到什么')
  assert.deepEqual(coldStart.paths.map(path => path.key), ['small_sample', 'narrow_scope', 'bare_draft'], '第 2 条：降级路径三条都要在')
  assert.equal(topics[0].generation_context.layer_ledger.total, 0, '第一批生成时本期还没有内容，账上应该是空的')

  // 一道全新用户最常撞上的门：一条来源都没有。同样不该拦。
  const noSource = await fetch(`${baseUrl}/api/topics/generate`, { method: 'POST', headers, body: JSON.stringify({}) })
  assert.equal(noSource.status, 201, '一条来源都没有也必须能生成选题')
  const secondTopics = await noSource.json()
  // 通电：第一批出的选题要进第二批的配比账，而且账必须真的进到给模型的提示词里，不能只算不喂。
  assert.ok(secondTopics.every(topic => topic.created_at), '选题要带生成时间，否则配比账没有周期口径')
  assert.equal(secondTopics[0].generation_context.layer_ledger.total, 3, '第二批要看见第一批出的 3 条')
  assert.match(llmMock.lastSystem(), /本期配比：泛流量触达 50% \/ 垂直信任 30% \/ 核心目标转化 20%/, '配比账要进提示词')
  assert.match(llmMock.lastSystem(), /本期已出：.+（共 3 条）/, '提示词要说清本期已出多少条')

  // 第 2 条里最硬的一条：纯选题生成无素材初稿。这条路必须是通的，不是只写在提示里。
  const bare = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title: '第一次做内容该从哪开始', strategy_layer: 'trust', goal_refs: [] } }) })
  assert.equal(bare.status, 201, '纯选题无素材初稿这条路必须真能走')
  const drafts = await bare.json()
  assert.ok(drafts.length > 0)
  // 第 4 条：缺素材时不许静默编造，简报必须明确说明在裸写。
  assert.match(drafts[0].generation_context.brief.material_gap, /没有可用素材/)

  // 通电：草稿生成要真按层级调写法，不能只把层级记在简报里。
  assert.equal(drafts[0].generation_context.brief.strategy_layer, 'trust', '简报要带上层级')
  assert.match(llmMock.lastSystem(), /这条属于垂直信任：/, '层级要进草稿生成提示词')
  assert.doesNotMatch(llmMock.lastSystem(), /这条属于泛流量触达：/, '选了信任层就不该同时下触达层的指令')
})
