import { after } from 'node:test'
import { startGenerationMock } from './generation-test-helper.mjs'
const generationMock = await startGenerationMock()
after(() => generationMock.close())
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { testPort } from './test-port.mjs'

const port = testPort(41000, 1000)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'topic-evaluation-test-')), 'data.json')
writeFileSync(dataFile, '{}')

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...generationMock.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 5000)
    child.stdout.on('data', data => {
      if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) }
    })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

const headers = owner => ({ 'x-user-id': owner, 'content-type': 'application/json' })

test('topic evaluation and decision are isolated, bounded and idempotent', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'topic-owner'
  const other = 'topic-other'

  const profile = await fetch(`${baseUrl}/api/profile`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ role: '创业顾问', audiences: ['创业者'], pillars: ['真实复盘'], problems: ['不会持续创作'] }) })
  assert.equal(profile.status, 200)
  const material = await fetch(`${baseUrl}/api/materials/import`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ name: 'evidence.txt', format: 'txt', content: '创业者失败复盘与持续创作方法' }) })
  assert.equal(material.status, 201)
  const materialBody = await material.json()
  const generated = await fetch(`${baseUrl}/api/topics/generate`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ material_ids: [materialBody.id] }) })
  assert.equal(generated.status, 201)
  const topic = (await generated.json())[0]

  const evaluated = await fetch(`${baseUrl}/api/topics/${topic.id}/evaluate`, { method: 'POST', headers: headers(owner), body: '{}' })
  assert.equal(evaluated.status, 200)
  const evaluatedBody = await evaluated.json()
  assert.equal(evaluatedBody.workflow_status, 'evaluated')
  assert.equal(Object.keys(evaluatedBody.evaluation.dimensions).length, 7)
  assert.ok(evaluatedBody.evaluation.evidence.length)

  const repeated = await fetch(`${baseUrl}/api/topics/${topic.id}/evaluate`, { method: 'POST', headers: headers(owner), body: '{}' })
  assert.equal(repeated.status, 200)
  assert.equal((await repeated.json()).evaluation.evaluated_at, evaluatedBody.evaluation.evaluated_at)

  const deferred = await fetch(`${baseUrl}/api/topics/${topic.id}/decision`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ decision: 'defer' }) })
  assert.equal(deferred.status, 200)
  const revision = await fetch(`${baseUrl}/api/topics/${topic.id}/revision`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ title: '修改后的选题', rationale: '补充真实案例' }) })
  assert.equal(revision.status, 200)
  assert.equal((await revision.json()).evaluation, null)
  const resumed = await fetch(`${baseUrl}/api/topics/${topic.id}/evaluate`, { method: 'POST', headers: headers(owner), body: '{}' })
  assert.equal(resumed.status, 200)
  const history = await (await fetch(`${baseUrl}/api/topics`, { headers: headers(owner) })).json()
  assert.equal(history.find(item => item.id === topic.id).title, '修改后的选题')
  const invalidDecision = await fetch(`${baseUrl}/api/topics/${topic.id}/decision`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ decision: 'approved' }) })
  assert.equal(invalidDecision.status, 422)
  assert.equal((await invalidDecision.json()).code, 'validation_failed')

  const decision = await fetch(`${baseUrl}/api/topics/${topic.id}/decision`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ decision: 'do' }) })
  assert.equal(decision.status, 200)
  assert.equal((await decision.json()).workflow_status, 'approved')

  const repeatedDecision = await fetch(`${baseUrl}/api/topics/${topic.id}/decision`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ decision: 'do' }) })
  assert.equal(repeatedDecision.status, 200)

  const crossAccount = await fetch(`${baseUrl}/api/topics/${topic.id}/evaluate`, { method: 'POST', headers: headers(other), body: '{}' })
  assert.equal(crossAccount.status, 404)
  assert.equal((await crossAccount.json()).code, 'resource_not_found')
  const crossAccountDecision = await fetch(`${baseUrl}/api/topics/${topic.id}/decision`, { method: 'PUT', headers: headers(other), body: JSON.stringify({ decision: 'do' }) })
  assert.equal(crossAccountDecision.status, 404)
  assert.equal((await crossAccountDecision.json()).code, 'resource_not_found')

  const invalidTransition = await fetch(`${baseUrl}/api/topics/${topic.id}/decision`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ decision: 'defer' }) })
  assert.equal(invalidTransition.status, 409)
  assert.equal((await invalidTransition.json()).code, 'invalid_transition')
})

test('选题会挂上用户选中的经历，不因模型只点了研究而丢掉', async t => {
  const port = testPort(41300, 150)
  const dataFile = join(mkdtempSync(join(tmpdir(), 'topic-source-test-')), 'data.json')
  writeFileSync(dataFile, '{}')
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...generationMock.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve() } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
  t.after(() => child.kill())
  const owner = 'topic-source-owner'
  const base = `http://127.0.0.1:${port}`
  await fetch(`${base}/api/profile`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ role: '创业顾问', audiences: ['创业者'], pillars: ['真实复盘'] }) })
  const material = await (await fetch(`${base}/api/materials/atoms`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ kind: 'experience', unit_type: 'CAS', name: '询盘', text: '去年发了半年没人问，改完第一条讲询盘就有人来问价。' }) })).json()
  const research = await (await fetch(`${base}/api/research/refresh`, { method: 'POST', headers: headers(owner), body: '{}' })).json()
  const researchId = research.items[0].id
  const generated = await fetch(`${base}/api/topics/generate`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ material_ids: [material.id], research_ids: [researchId] }) })
  assert.equal(generated.status, 201)
  const topic = (await generated.json())[0]
  assert.ok(topic.source_refs.some(ref => ref.type === 'research' && ref.id === researchId), '研究来源要在')
  assert.ok(topic.source_refs.some(ref => ref.type === 'material' && ref.id === material.id), '用户选中的经历不能丢')
})
