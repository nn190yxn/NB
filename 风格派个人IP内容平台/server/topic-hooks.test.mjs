import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'
import { hookKindOf, layerOf, topicRequestNote } from './topic-hooks.mjs'

test('点名只认三层和四类钩子，认不出的当没点', () => {
  for (const layer of ['reach', 'trust', 'conversion']) assert.equal(layerOf(layer), layer)
  assert.equal(layerOf('别的'), '')
  assert.equal(layerOf(undefined), '')
  assert.equal(hookKindOf('identity'), 'identity')
  assert.equal(hookKindOf('打翻共识'), '', '只认内部标识，不认中文标签')
  assert.equal(hookKindOf(null), '')
})

test('点名了就写成指令，没点名就一个字都不往提示词里塞', () => {
  const both = topicRequestNote({ layer: 'conversion', hookKind: 'contrast_number' })
  assert.match(both, /「核心目标转化」层/)
  assert.match(both, /反差数字/)
  assert.equal(topicRequestNote({}), '', '什么都不选时不能塞废话进提示词')
  assert.equal(topicRequestNote({ layer: '乱填', hookKind: '乱填' }), '', '认不出的值等于没点')
  const onlyHook = topicRequestNote({ hookKind: 'identity' })
  assert.match(onlyHook, /身份代入/)
  assert.doesNotMatch(onlyHook, /层/, '只点了钩子就不该提到层级')
})

const llmMock = await startSharedLlmMock()
const port = testPort(49300, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'topic-hooks-test-')), 'data.json')
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

// 验收（任务 e5649799）：什么都不选也能生成；选了层级能带进草稿；无来源不再拦截。
// 桩模型固定回 strategy_layer: 'trust' 且不给 hook_kind——正好用来证明「你选的盖过模型自己判的」。
test('选题入口：什么都不选也能生成，选了层级和钩子就照你选的来', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const headers = { 'x-user-id': 'hook-owner', 'content-type': 'application/json' }
  const generate = body => fetch(`${baseUrl}/api/topics/generate`, { method: 'POST', headers, body: JSON.stringify(body) })

  // 1）什么都不选，连来源都不给——全新用户的必经之路。
  const bare = await generate({})
  assert.equal(bare.status, 201, '什么都不选、连来源都没有，也必须能生成')
  const bareTopics = await bare.json()
  assert.equal(bareTopics.length, 3)
  assert.ok(bareTopics.every(item => item.source_refs.length === 0), '没有来源不再被拦，照常出选题')
  assert.ok(bareTopics.every(item => item.strategy_layer === 'trust'), '没点名就用模型自己判的层级')
  assert.ok(bareTopics.every(item => item.hook_kind === ''), '模型没给钩子就留空，不替它编一个')

  // 2）点名层级：桩模型回的是 trust，用户说要 reach，存下来就必须是 reach。
  const layered = await (await generate({ strategy_layer: 'reach' })).json()
  assert.ok(layered.every(item => item.strategy_layer === 'reach'), '点名的层级要盖过模型自己判的')
  assert.equal(layered[0].generation_context.requested_layer, 'reach', '点名了什么要记在生成上下文里')
  assert.match(llmMock.lastSystem(), /全部做「泛流量触达」层/)
  // 点名了层级就不能再念配比账：两句话打架，模型会自己折中，最后哪边都不算数。
  assert.doesNotMatch(llmMock.lastSystem(), /配比/, '点名了层级就不该再念配比账')
  assert.ok(layered[0].generation_context.layer_ledger, '账本身仍然要落库，只是不进这一批的提示词')

  // 3）三层都要能点名，不能只有 reach 走得通。
  for (const layer of ['trust', 'conversion']) {
    const result = await (await generate({ strategy_layer: layer })).json()
    assert.ok(result.every(item => item.strategy_layer === layer), `${layer} 层要能点名`)
  }

  // 4）点名钩子。
  const hooked = await (await generate({ hook_kind: 'identity' })).json()
  assert.ok(hooked.every(item => item.hook_kind === 'identity'), '点名的钩子要带进选题')
  assert.match(llmMock.lastSystem(), /身份代入/)

  // 5）认不出的值当没点，不许因此报错——参数写错不该把人拦在门外。
  const bogus = await generate({ strategy_layer: '不存在的层', hook_kind: '不存在的钩子' })
  assert.equal(bogus.status, 201, '认不出的层级/钩子要当没点，不能报错')
  const bogusTopics = await bogus.json()
  assert.ok(bogusTopics.every(item => item.strategy_layer === 'trust'), '认不出就退回模型自己判的')

  // 6）选了层级要能带进草稿（验收第 2 条）——层级是接在草稿提示词上的。
  const topicId = layered[0].id
  const drafts = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic_id: topicId }) })
  assert.equal(drafts.status, 201, '点名层级的选题要能生成草稿')
  const list = await (await fetch(`${baseUrl}/api/drafts`, { headers })).json()
  assert.equal(list[0].generation_context.brief.strategy_layer, 'reach', '选的层级要一路带到草稿简报里')
  assert.match(llmMock.lastSystem(), /这条属于泛流量触达/, '层级要真的进草稿生成提示词')
})
