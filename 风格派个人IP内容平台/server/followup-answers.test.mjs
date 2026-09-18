import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { followupMaterialInput, unitTypeFromAnswer } from './followup-answers.mjs'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

test('回答里有经历就进 CAS，有判断就进 OPI', () => {
  assert.equal(unitTypeFromAnswer('我上个月带过一个学员，他一开始连选题都不会写。'), 'CAS')
  assert.equal(unitTypeFromAnswer('有个客户换了五个定位，最后还是回到本地老板。'), 'CAS')
  assert.equal(unitTypeFromAnswer('我觉得这件事关键是把过程讲清楚。'), 'OPI')
  assert.equal(unitTypeFromAnswer('其实不需要那么多技巧，说白了就是先做出来。'), 'OPI')
})

test('两类都像就看先说哪个，都判不出就留空等人工定', () => {
  assert.equal(unitTypeFromAnswer('我上个月试过，其实关键不是方法，是坚持。'), 'CAS')
  assert.equal(unitTypeFromAnswer('我觉得关键是坚持，我去年试过一次。'), 'OPI')
  // 分不出经历还是观点：不猜，留空等人工判定（对齐 unit-types 的既有原则）。
  assert.equal(unitTypeFromAnswer('坚持。'), null)
  assert.equal(unitTypeFromAnswer(''), null)
})

test('回写素材带上可信度、来源与草稿关联', () => {
  const input = followupMaterialInput({ draft: { id: 7, strategy_layer: 'trust', goal_refs: [{ type: 'goal', id: 1 }] }, entry: { code: 'ai_tone_phrase', label: '「不是 X 是 Y」高密度' }, answer: '我去年试过一次，先给结论反而有人问。' })
  assert.equal(input.material_trust, 'verified', '用户自己回答的直接是 verified')
  assert.equal(input.unit_type, 'CAS')
  assert.equal(input.source, '改稿追问')
  assert.equal(input.draft_id, 7)
  assert.ok(input.source_refs.some(ref => ref.type === 'draft' && ref.id === '7'))
  assert.ok(input.source_refs.some(ref => ref.type === 'ai_feature' && ref.id === 'ai_tone_phrase'))
  assert.match(input.name, /不是 X 是 Y/)
  assert.equal(followupMaterialInput({ draft: { id: 7 }, entry: { code: 'x' }, answer: '   ' }), null, '空回答不该写一条空素材')
})

const llmMock = await startSharedLlmMock()
const port = testPort(49300, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'followup-test-')), 'data.json')
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

test('回答要用户点了才入库，进去就是 verified 并挂着草稿', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const headers = { 'x-user-id': 'followup-owner', 'content-type': 'application/json' }
  const drafts = await (await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title: '内容要按成交写', strategy_layer: 'trust', goal_refs: [] } }) })).json()
  const draft = drafts[0]
  assert.ok(draft.id)

  // 空回答：拒绝，不写空素材。
  const empty = await fetch(`${baseUrl}/api/drafts/${draft.id}/followups`, { method: 'POST', headers, body: JSON.stringify({ code: 'ai_tone_phrase', label: '「不是 X 是 Y」高密度', answer: '  ' }) })
  assert.equal(empty.status, 422)

  const created = await fetch(`${baseUrl}/api/drafts/${draft.id}/followups`, { method: 'POST', headers, body: JSON.stringify({ code: 'ai_tone_phrase', label: '「不是 X 是 Y」高密度', answer: '我去年试过一次，先给结论反而有人来问。' }) })
  assert.equal(created.status, 201)
  const material = await created.json()
  assert.equal(material.material_trust, 'verified')
  assert.equal(material.unit_type, 'CAS', '带经历的回答进 CAS')
  assert.equal(material.source, '改稿追问')
  assert.equal(material.draft_id, draft.id)

  const listed = await (await fetch(`${baseUrl}/api/materials`, { headers })).json()
  const stored = listed.find(item => item.id === material.id)
  assert.ok(stored, '入库后要能在素材库查到')
  assert.equal(stored.material_trust, 'verified')
  assert.equal(stored.unit_type, 'CAS')

  // 同一个回答重复提交当幂等，不写第二条。
  const again = await fetch(`${baseUrl}/api/drafts/${draft.id}/followups`, { method: 'POST', headers, body: JSON.stringify({ code: 'ai_tone_phrase', label: '「不是 X 是 Y」高密度', answer: '我去年试过一次，先给结论反而有人来问。' }) })
  assert.equal(again.status, 200)
  assert.equal((await again.json()).duplicate, true)
  const after = await (await fetch(`${baseUrl}/api/materials`, { headers })).json()
  assert.equal(after.filter(item => item.source === '改稿追问').length, 1, '重复提交不能写第二条')
})
