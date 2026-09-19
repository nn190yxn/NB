// 形式判断判完必须真的用得上：判完存到选题上，生成草稿时按它写。
// 这条链路曾经断在「判了不存、生成时写死短视频」，判完只能等稿子出来再点重写返工。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildDraftBrief, draftBriefPrompt, draftGateRewritePrompt, draftLengthTargetFor, draftVideoFormats, resolveVideoFormat } from './draft-writing.mjs'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

const llmMock = await startSharedLlmMock()
const port = testPort(49200, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'form-to-draft-test-')), 'data.json')
writeFileSync(dataFile, JSON.stringify({
  topics: [
    { id: 21, owner_id: 'form-flow-owner', title: '这条选题要判形式', rationale: '', strategy_layer: 'trust', workflow_status: 'approved', goal_refs: [], source_refs: [] },
    { id: 22, owner_id: 'form-flow-owner', title: '另一条选题', rationale: '', strategy_layer: 'trust', workflow_status: 'approved', goal_refs: [], source_refs: [] },
  ],
}))

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...llmMock.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

const headers = owner => ({ 'x-user-id': owner, 'content-type': 'application/json' })
const generate = (owner, body) => fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers: owner, body: JSON.stringify(body) })

test('形式判断判完存在选题上，生成草稿就按它写', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = headers('form-flow-owner')

  // 没判过形式：生成只能落回平台默认的短视频。
  const before = await (await generate(owner, { topic_id: 22 })).json()
  assert.ok(before.every(item => item.content_format === '短视频'), '没判过就按平台默认')

  // 判「长视频」并带上选题 id：形式与理由直接落到那条选题上。
  const judged = await (await fetch(`${baseUrl}/api/skills/form`, { method: 'POST', headers: owner, body: JSON.stringify({ topic: '长视频：把一套打法完整讲完', topic_id: 21 }) })).json()
  assert.equal(judged.form, '长视频')
  assert.equal(judged.saved_topic_id, 21)
  const saved = (await (await fetch(`${baseUrl}/api/topics`, { headers: owner })).json()).find(item => item.id === 21)
  assert.equal(saved.content_format, '长视频')
  assert.equal(saved.content_format_reason, judged.reason)

  // 生成：形式和理由都不用再手抄一遍。
  const response = await generate(owner, { topic_id: 21 })
  assert.equal(response.status, 201)
  const drafts = await response.json()
  assert.ok(drafts.every(item => item.content_format === '长视频'), '两条草稿都该按选题上的形式写')
  // 提示词也得换成对应体裁，不能嘴上说长视频、提示词里还是短视频那一套。
  const prompt = llmMock.lastSystem()
  assert.ok(prompt.includes('长视频'), `提示词里要带形式：${prompt.slice(0, 120)}`)
  assert.ok(prompt.includes(draftVideoFormats.长视频.form.slice(0, 6)), '提示词里要带长视频的体裁说明')
})

test('生成时可以临时指定形式；范围外的形式落回短视频，不报错', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = headers('form-flow-owner')

  const overridden = await (await generate(owner, { topic_id: 22, content_format: '中视频' })).json()
  assert.ok(overridden.every(item => item.content_format === '中视频'), '临时指定的形式要生效')

  const fallback = await (await generate(owner, { topic_id: 22, content_format: '播客' })).json()
  assert.ok(fallback.every(item => item.content_format === '短视频'), '范围外的形式落回默认，不把生成打断')
})

test('形式解析只认写作层认得的三种，别的一律落回短视频', () => {
  assert.equal(resolveVideoFormat('中视频'), '中视频')
  assert.equal(resolveVideoFormat(' 长视频 '), '长视频')
  // 长文是形式判断的第四种，但它不是视频体裁，不能落进抖音/视频号草稿。
  assert.equal(resolveVideoFormat('长文'), '短视频')
  assert.equal(resolveVideoFormat('播客'), '短视频')
  assert.equal(resolveVideoFormat(''), '短视频')
  assert.equal(resolveVideoFormat(undefined), '短视频')
})

test('简报与提示词都按传入的形式写，字数取自该形式而不是短视频', () => {
  assert.equal(buildDraftBrief({ format: '中视频' }).content_format, '中视频')
  assert.equal(buildDraftBrief({}).content_format, '')

  const shorts = draftBriefPrompt({})
  assert.match(shorts, new RegExp(`${draftLengthTargetFor('抖音', '短视频').min}-${draftLengthTargetFor('抖音', '短视频').max} 字`))

  const mid = draftBriefPrompt({}, '中视频')
  assert.match(mid, /中视频/)
  assert.match(mid, new RegExp(`${draftLengthTargetFor('抖音', '中视频').min}-${draftLengthTargetFor('抖音', '中视频').max} 字`))
  assert.equal(mid.includes(`${draftLengthTargetFor('抖音', '短视频').max} 字`), false, '不能还留着短视频的字数')

  // 生成闸门没过时的重写提示词走的是另一条路径，同样得按形式写。
  assert.ok(draftGateRewritePrompt('两平台同一篇', '长视频').includes(draftVideoFormats.长视频.form.slice(0, 6)))
})
