import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const port = 44000 + Math.floor(Math.random() * 1000)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'draft-checks-test-')), 'data.json')
writeFileSync(dataFile, '{}')

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}
const headers = owner => ({ 'x-user-id': owner, 'content-type': 'application/json' })

async function json(response) { return response.json() }

test('draft checks enforce order, preserve isolation and block shooting after publish failure', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'checks-owner'
  const generatedResponse = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ topic: { title: '一次真实复盘', strategy_layer: 'trust', goal_refs: [], source_refs: [{ type: 'topic', id: 11 }] } }) })
  const drafts = await json(generatedResponse)
  const draft = drafts[0]
  const hooksResponse = await fetch(`${baseUrl}/api/drafts/${draft.id}/hooks`, { method: 'POST', headers: headers(owner), body: '{}' })
  const hooked = await json(hooksResponse)
  const selectedResponse = await fetch(`${baseUrl}/api/drafts/${draft.id}`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ selected_hook_id: hooked.hooks[0].id, version: hooked.version }) })
  const selected = await json(selectedResponse)

  const outOfOrder = await fetch(`${baseUrl}/api/drafts/${draft.id}/checks/quality`, { method: 'POST', headers: headers(owner), body: '{}' })
  assert.equal(outOfOrder.status, 409)
  const personaResponse = await fetch(`${baseUrl}/api/drafts/${draft.id}/checks/persona`, { method: 'POST', headers: headers(owner), body: '{}' })
  assert.equal(personaResponse.status, 200)
  const persona = await json(personaResponse)
  assert.equal(persona.workflow_status, 'persona_checked')
  assert.equal(persona.checks.persona.status, 'warning')
  const personaAgain = await fetch(`${baseUrl}/api/drafts/${draft.id}/checks/persona`, { method: 'POST', headers: headers(owner), body: '{}' })
  assert.equal(personaAgain.status, 200)
  const cachedPersona = await json(personaAgain)
  assert.deepEqual(cachedPersona.checks.persona, persona.checks.persona)
  const profileUpdate = await fetch(`${baseUrl}/api/profile`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ role: '创作者', audiences: ['真实'], pillars: ['过程'] }) })
  assert.equal(profileUpdate.status, 200)
  const stillCached = await json(await fetch(`${baseUrl}/api/drafts/${draft.id}/checks/persona`, { method: 'POST', headers: headers(owner), body: '{}' }))
  assert.deepEqual(stillCached.checks.persona, persona.checks.persona)
  const forcedPersona = await json(await fetch(`${baseUrl}/api/drafts/${draft.id}/checks/persona`, { method: 'POST', headers: headers(owner), body: JSON.stringify({ force: true }) }))
  assert.ok(forcedPersona.checks.persona.score > persona.checks.persona.score)
  assert.equal(forcedPersona.checks.persona.draft_version, selected.version)

  const qualityResponse = await fetch(`${baseUrl}/api/drafts/${draft.id}/checks/quality`, { method: 'POST', headers: headers(owner), body: '{}' })
  assert.equal(qualityResponse.status, 200)
  const quality = await json(qualityResponse)
  assert.equal(quality.checks.quality.status, 'passed')
  assert.equal(quality.workflow_status, 'quality_checked')
  const publishResponse = await fetch(`${baseUrl}/api/drafts/${draft.id}/checks/publish`, { method: 'POST', headers: headers(owner), body: '{}' })
  assert.equal(publishResponse.status, 200)
  const publish = await json(publishResponse)
  assert.equal(publish.checks.publish_checklist.status, 'blocked')
  assert.equal(publish.workflow_status, 'needs_revision')

  const blockedShooting = await fetch(`${baseUrl}/api/drafts/${draft.id}`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ status: 'ready_to_shoot', version: publish.version }) })
  assert.equal(blockedShooting.status, 409)
  const otherAccess = await fetch(`${baseUrl}/api/drafts/${draft.id}/checks/persona`, { method: 'POST', headers: headers('checks-other'), body: '{}' })
  assert.equal(otherAccess.status, 404)

  const changedResponse = await fetch(`${baseUrl}/api/drafts/${draft.id}`, { method: 'PUT', headers: headers(owner), body: JSON.stringify({ title: '修改后标题', version: publish.version }) })
  assert.equal(changedResponse.status, 200)
  const changed = await json(changedResponse)
  assert.equal(changed.workflow_status, 'content_ready')
  assert.equal(changed.checks.quality, null)
  assert.equal(changed.checks.publish_checklist, null)
  assert.equal(changed.source_refs[0].id, 11)
  assert.equal(selected.selected_hook_id, hooked.hooks[0].id)
})
