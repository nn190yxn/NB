import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
const llmMock = await startSharedLlmMock()

const port = 45000 + Math.floor(Math.random() * 1000)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'draft-slot-test-')), 'data.json')
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

const jsonHeaders = owner => ({ 'x-user-id': owner, 'content-type': 'application/json' })

async function seedStructure(owner, body) {
  const response = await fetch(`${baseUrl}/api/structures`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify(body) })
  assert.equal(response.status, 201)
  return response.json()
}

test('槽位目录按平台与用途给出选项并标注来源', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'slot-catalog'
  await seedStructure(owner, { title: '对标dbs·开头范式一：预测攻击式', steps: ['公式：反常识断言 + 能力反转'], content_type: '开头钩子' })
  await seedStructure(owner, { title: '对标dbs·结尾范式：金句复现', steps: ['做法：把开头断言再说一遍'], content_type: '结尾引导' })
  await seedStructure(owner, { title: '对标dbs·爆款四段式骨架', steps: ['① 钩子', '② 痛点'], content_type: '母模板' })
  await seedStructure(owner, { title: '对标dbs·拆解：某爆款', steps: ['钩子'], content_type: '拆解' })

  const catalog = await (await fetch(`${baseUrl}/api/draft-slots?platform=抖音`, { headers: { 'x-user-id': owner } })).json()
  assert.equal(catalog.labels.opening, '开头句')
  assert.deepEqual(catalog.group_scoped, ['title'])
  assert.equal(catalog.options.title.length, 8)
  assert.equal(catalog.options.opening.length, 1)
  assert.equal(catalog.options.ending.length, 1)
  assert.ok(catalog.options.opening[0].name.startsWith('开头范式一'))
  assert.equal(catalog.options.opening[0].source, '对标dbs')
  assert.ok(!catalog.options.opening[0].name.startsWith('对标dbs'))
  const structureIds = catalog.options.structure.map(item => item.id)
  assert.ok(structureIds.includes('genre-douyin'))
  assert.ok(structureIds.includes(`structure-${catalog.options.structure.at(-1).structure_id}`))
  assert.equal(structureIds.length, 2, '拆解类结构不应进入正文结构选择器')
})

test('标题改法作用于整组，其余槽位只改当前草稿且保留版本可回退', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'slot-owner'
  const other = 'slot-other'
  const generated = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ topic: { title: '槽位用例', strategy_layer: 'trust', goal_refs: [] } }) })
  assert.equal(generated.status, 201)
  const drafts = await generated.json()
  assert.equal(drafts.length, 4)
  const target = drafts.find(item => item.platform === '抖音')
  const richBody = '标题：旧标题\n\n正文：\n原来的第一段\n\n中间段落不能动。\n\n原来的结尾段'
  const saved = await (await fetch(`${baseUrl}/api/drafts/${target.id}`, { method: 'PUT', headers: jsonHeaders(owner), body: JSON.stringify({ title: '旧标题', body: richBody, version: target.version }) })).json()
  assert.equal(saved.title, '旧标题')

  const opening = await seedStructure(owner, { title: '对标dbs·开头范式一：预测攻击式', steps: ['公式：反常识断言 + 能力反转'], content_type: '开头钩子' })
  const ending = await seedStructure(owner, { title: '自有·我的收尾习惯', steps: ['做法：直接给下一步'], content_type: '结尾引导' })
  const catalog = await (await fetch(`${baseUrl}/api/draft-slots?platform=抖音`, { headers: { 'x-user-id': owner } })).json()
  const openingOption = catalog.options.opening[0]
  const endingOption = catalog.options.ending[0]
  assert.equal(openingOption.structure_id, opening.id)
  assert.equal(endingOption.structure_id, ending.id)
  assert.equal(endingOption.source, '自有')

  // 标题是整组共用：改一次要改四条平台草稿。
  const titleResult = await fetch(`${baseUrl}/api/drafts/${target.id}/slots/title`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ option_id: 'title-contrast' }) })
  assert.equal(titleResult.status, 200)
  const titlePayload = await titleResult.json()
  assert.equal(titlePayload.updated_count, 4)
  assert.equal(titlePayload.option.source, '对标dbs')
  const afterTitle = await (await fetch(`${baseUrl}/api/drafts`, { headers: { 'x-user-id': owner } })).json()
  assert.deepEqual(afterTitle.map(item => item.title), Array.from({ length: 4 }, () => '对标改法之后的新标题'))
  assert.equal(afterTitle.find(item => item.id === target.id).version, 3, '目标草稿经历过一次 PUT，再叠加标题改写')
  assert.ok(afterTitle.filter(item => item.id !== target.id).every(item => item.version === 2), '其余三个平台应只被标题改写递增一次')
  assert.ok(afterTitle.every(item => item.workflow_status === 'content_ready'))
  assert.ok(afterTitle.every(item => item.history.length >= 1), '每个平台都应留下可回退的旧版本')

  // 开头只改当前草稿的那一段，不动标题行、中间段与结尾。
  const openingResult = await fetch(`${baseUrl}/api/drafts/${target.id}/slots/opening`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ option_id: openingOption.id }) })
  assert.equal(openingResult.status, 200)
  const openingPayload = await openingResult.json()
  assert.equal(openingPayload.updated_count, 1)
  const afterOpening = (await (await fetch(`${baseUrl}/api/drafts`, { headers: { 'x-user-id': owner } })).json()).find(item => item.id === target.id)
  assert.match(afterOpening.body, /^标题：旧标题\n\n正文：\n改写后的开头段：真实过程比技巧更重要。\n\n中间段落不能动。/)
  assert.match(afterOpening.body, /原来的结尾段$/)
  assert.equal(afterOpening.version, 4)
  const untouched = afterTitle.find(item => item.id !== target.id)
  assert.match(untouched.body, /抖音口播|小红书正文|视频号口播|公众号正文/, '其余平台正文不应被开头改写影响')

  // 结尾只改最后一段。
  const endingResult = await fetch(`${baseUrl}/api/drafts/${target.id}/slots/ending`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ option_id: endingOption.id }) })
  assert.equal(endingResult.status, 200)
  const afterEnding = (await (await fetch(`${baseUrl}/api/drafts`, { headers: { 'x-user-id': owner } })).json()).find(item => item.id === target.id)
  assert.match(afterEnding.body, /改写后的开头段：真实过程比技巧更重要。\n\n中间段落不能动。/)
  assert.match(afterEnding.body, /改写后的结尾段$/)

  // 正文结构重排整篇。
  const structureResult = await fetch(`${baseUrl}/api/drafts/${target.id}/slots/structure`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ option_id: 'genre-douyin' }) })
  assert.equal(structureResult.status, 200)
  assert.equal((await structureResult.json()).updated_count, 1)
  const afterStructure = (await (await fetch(`${baseUrl}/api/drafts`, { headers: { 'x-user-id': owner } })).json()).find(item => item.id === target.id)
  assert.equal(afterStructure.body, '整篇重排后的正文')
  assert.equal(afterStructure.history.length, 5)

  // 参数与归属校验。
  const badOption = await fetch(`${baseUrl}/api/drafts/${target.id}/slots/opening`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ option_id: 'structure-99999' }) })
  assert.equal(badOption.status, 422)
  const badSlot = await fetch(`${baseUrl}/api/drafts/${target.id}/slots/body`, { method: 'POST', headers: jsonHeaders(owner), body: JSON.stringify({ option_id: 'title-contrast' }) })
  assert.equal(badSlot.status, 404)
  const otherUser = await fetch(`${baseUrl}/api/drafts/${target.id}/slots/title`, { method: 'POST', headers: jsonHeaders(other), body: JSON.stringify({ option_id: 'title-contrast' }) })
  assert.equal(otherUser.status, 404)
})
