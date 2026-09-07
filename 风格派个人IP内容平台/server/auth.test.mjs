import { after } from 'node:test'
import { startGenerationMock } from './generation-test-helper.mjs'
const generationMock = await startGenerationMock()
after(() => generationMock.close())
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 3200 + Math.floor(Math.random() * 200)
const baseUrl = `http://127.0.0.1:${port}`
const testDataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-test-')), 'data.json')
writeFileSync(testDataFile, '{}')

function startServer({ serverPort = port, nodeEnv = 'test', extraEnv = {} } = {}) {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, ...generationMock.env, PORT: String(serverPort), NODE_ENV: nodeEnv, DATA_FILE: testDataFile, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 5000)
    child.stdout.on('data', data => {
      if (String(data).includes('Content IP API listening')) {
        clearTimeout(timeout)
        resolve(child)
      }
    })
    child.once('error', reject)
    child.once('exit', code => {
      if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`))
    })
  })
}

test('未配置模型时定位生成明确失败，不返回固定模板', async t => {
  const server = await startServer({ extraEnv: { PROJECT_LLM_BASE_URL: '', PROJECT_LLM_API_KEY: '', PROJECT_LLM_MODEL: '' } })
  t.after(() => server.kill())
  const headers = { 'x-user-id': 'no-model-user', 'content-type': 'application/json' }
  await fetch(`${baseUrl}/api/positioning`, { method: 'PUT', headers, body: JSON.stringify({ interview_answers: { 0: '真实经历' } }) })
  const result = await fetch(`${baseUrl}/api/positioning/candidates`, { method: 'POST', headers })
  assert.equal(result.status, 422)
  assert.equal((await result.json()).code, 'MISSING_CONFIG')
  assert.deepEqual(await (await fetch(`${baseUrl}/api/positioning/candidates`, { headers })).json(), [])
})

test('session 支持创建、复用和注销', async t => {
  const server = await startServer()
  t.after(() => server.kill())

  const missing = await fetch(`${baseUrl}/api/auth/session`)
  assert.equal(missing.status, 200)
  assert.deepEqual(await missing.json(), { auth_required: false })

  const health = await fetch(`${baseUrl}/healthz`, { method: 'HEAD' })
  assert.equal(health.status, 200)
  assert.equal(await health.text(), '')

  const apiHealth = await fetch(`${baseUrl}/api/health`)
  assert.equal(apiHealth.status, 200)
  assert.deepEqual(await apiHealth.json(), { status: 'ok', storage: 'json-mvp' })

  const forbiddenOrigin = await fetch(`${baseUrl}/api/auth/session`, { headers: { origin: 'https://unexpected.example.com' } })
  assert.equal(forbiddenOrigin.status, 403)
  assert.equal((await forbiddenOrigin.json()).error, '请求来源不被允许')

  const loopbackOrigin = await fetch(`${baseUrl}/api/auth/session`, { headers: { origin: 'http://127.0.0.1:5173' } })
  assert.equal(loopbackOrigin.status, 200)
  assert.equal(loopbackOrigin.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173')

  const created = await fetch(`${baseUrl}/api/auth/session`, {
    method: 'POST',
    headers: { 'x-user-id': 'integration-user' },
  })
  assert.equal(created.status, 200)
  assert.equal(created.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  assert.equal(created.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(created.headers.get('x-frame-options'), 'DENY')
  assert.equal(created.headers.get('cache-control'), 'no-store')
  assert.equal(created.headers.get('cross-origin-resource-policy'), 'same-origin')
  assert.equal(created.headers.get('cross-origin-opener-policy'), 'same-origin')
  assert.equal(created.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'")
  assert.equal(created.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(created.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()')
  const cookie = created.headers.get('set-cookie').split(';', 1)[0]
  assert.match(cookie, /^content_ip_session=.+/)
  assert.deepEqual(await created.json(), { user_id: 'integration-user', role: 'creator', expires_in: 30 * 24 * 3600 })

  const malformed = await fetch(`${baseUrl}/api/profile`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: '{invalid-json',
  })
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.json()).error, '请求体不是有效 JSON')

  const current = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie, 'x-user-id': 'different-user' } })
  assert.equal(current.status, 200)
  assert.equal((await current.json()).user_id, 'integration-user')

  const saved = await fetch(`${baseUrl}/api/positioning`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ interview_answers: { proof: 'owned-by-integration-user', 0: '我做过内容咨询项目', 1: '擅长拆解方法', 2: '创业者' } }),
  })
  assert.equal(saved.status, 200)

  const otherSession = await fetch(`${baseUrl}/api/auth/session`, {
    method: 'POST',
    headers: { 'x-user-id': 'other-integration-user' },
  })
  const otherCookie = otherSession.headers.get('set-cookie').split(';', 1)[0]
  const isolated = await fetch(`${baseUrl}/api/positioning`, { headers: { cookie: otherCookie } })
  assert.equal(isolated.status, 200)
  assert.equal((await isolated.json()).interview_answers.proof, undefined)

  const materialResponse = await fetch(`${baseUrl}/api/materials/import`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `隔离测试素材-${port}.txt`, format: 'txt', content: `仅属于 integration-user 的素材-${port}` }),
  })
  assert.equal(materialResponse.status, 201)
  const material = await materialResponse.json()
  assert.equal(material.owner_id, 'integration-user')
  assert.ok(material.extracted_fields.segments.length)

  const failedMaterialResponse = await fetch(`${baseUrl}/api/materials/import`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'needs-content.txt', content: '' }),
  })
  assert.equal(failedMaterialResponse.status, 201)
  const failedMaterial = await failedMaterialResponse.json()
  assert.equal(failedMaterial.status, 'failed')
  const retriedMaterialResponse = await fetch(`${baseUrl}/api/materials/${failedMaterial.id}/retry`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ content: '补充后的正文' }),
  })
  assert.equal(retriedMaterialResponse.status, 200)
  const retriedMaterial = await retriedMaterialResponse.json()
  assert.equal(retriedMaterial.status, 'ready')
  assert.equal(retriedMaterial.retry_count, 1)

  const syncResponse = await fetch(`${baseUrl}/api/materials/sync`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ device_id: 'desktop-test', files: [{ name: 'new-note.md', path: 'notes/new-note.md', checksum: 'sync-checksum-1' }, { name: material.name, checksum: material.checksum }] }),
  })
  assert.equal(syncResponse.status, 202)
  const syncResults = (await syncResponse.json()).results
  assert.equal(syncResults[0].status, 'queued')
  assert.equal(syncResults[1].status, 'duplicate')
  assert.ok(syncResults[0].job_id)

  const repeatedSync = await fetch(`${baseUrl}/api/materials/sync`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ device_id: 'desktop-test', files: [{ name: 'new-note.md', path: 'notes/new-note.md', checksum: 'sync-checksum-1' }] }),
  })
  assert.equal((await repeatedSync.json()).results[0].status, 'queued')

  const failedSync = await fetch(`${baseUrl}/api/materials/sync`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ device_id: 'desktop-test', files: [{ checksum: 'invalid-sync' }] }),
  })
  const failedResult = (await failedSync.json()).results[0]
  assert.equal(failedResult.status, 'failed')
  const retriedSync = await fetch(`${baseUrl}/api/materials/sync/${failedResult.job_id}/retry`, { method: 'POST', headers: { cookie } })
  assert.equal(retriedSync.status, 202)
  assert.equal((await retriedSync.json()).status, 'queued')

  const duplicateMaterial = await fetch(`${baseUrl}/api/materials/import`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: material.name, format: material.format, content: material.content }),
  })
  assert.equal(duplicateMaterial.status, 200)
  assert.equal((await duplicateMaterial.json()).duplicate, true)

  const otherMaterials = await fetch(`${baseUrl}/api/materials`, { headers: { cookie: otherCookie } })
  assert.equal(otherMaterials.status, 200)
  assert.equal((await otherMaterials.json()).some(item => item.id === material.id), false)

  const incompleteProfile = await fetch(`${baseUrl}/api/topics/generate`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ material_ids: [material.id] }),
  })
  assert.equal(incompleteProfile.status, 422)
  const incompleteProfileBody = await incompleteProfile.json()
  assert.equal(incompleteProfileBody.error, 'IP 档案资料不足')
  assert.deepEqual(incompleteProfileBody.missing_fields, ['role', 'audiences', 'pillars'])

  const profileResponse = await fetch(`${baseUrl}/api/profile`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ role: '创业顾问', audiences: ['个人 IP 创作者'], pillars: ['真实复盘'] }),
  })
  assert.equal(profileResponse.status, 200)

  const updatedProfile = await profileResponse.json()
  assert.ok(updatedProfile.history.some(item => item.field === 'role' && item.next === '创业顾问'))
  assert.equal(updatedProfile.version, 2)
  const emptyProfileField = await fetch(`${baseUrl}/api/profile`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ role: '   ' }),
  })
  assert.equal(emptyProfileField.status, 422)

  const profileImport = await fetch(`${baseUrl}/api/profile/import`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'profile.md', content: '角色：创业顾问\n受众：个人 IP 创作者、创业者\n支柱：真实复盘、方法拆解\n未知段落' }),
  })
  assert.equal(profileImport.status, 201)
  const review = await profileImport.json()
  assert.equal(review.status, 'pending')
  assert.deepEqual(review.fields.pillars, ['真实复盘', '方法拆解'])
  assert.equal(review.unrecognized.length, 1)
  const confirmedReview = await fetch(`${baseUrl}/api/profile/reviews/${review.id}`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'confirmed', fields: { role: '内容顾问', pillars: ['真实复盘', '方法拆解', '案例分析'] } }),
  })
  assert.equal(confirmedReview.status, 200)
  assert.equal((await (await fetch(`${baseUrl}/api/profile`, { headers: { cookie } })).json()).role, '内容顾问')

  const candidatesResponse = await fetch(`${baseUrl}/api/positioning/candidates`, { method: 'POST', headers: { cookie } })
  assert.equal(candidatesResponse.status, 201)
  const candidates = await candidatesResponse.json()
  assert.equal(candidates.length, 3)
  assert.ok(candidates.every(item => item.source_refs.length))
  for (const mode of ['failed', 'invalid']) {
    generationMock.setMode(mode)
    const failed = await fetch(`${baseUrl}/api/positioning/candidates`, { method: 'POST', headers: { cookie } })
    assert.equal(failed.status, 502)
    assert.deepEqual(await (await fetch(`${baseUrl}/api/positioning/candidates`, { headers: { cookie } })).json(), candidates)
  }
  generationMock.setMode('success')
  const confirmedCandidate = await fetch(`${baseUrl}/api/positioning/candidates/${candidates[0].id}`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'confirmed' }),
  })
  assert.equal(confirmedCandidate.status, 200)
  const filledProfile = await (await fetch(`${baseUrl}/api/profile`, { headers: { cookie } })).json()
  assert.equal(filledProfile.role, '内容顾问')
  const repeatConfirm = await fetch(`${baseUrl}/api/positioning/candidates/${candidates[0].id}`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'confirmed' }) })
  assert.equal(repeatConfirm.status, 200)
  assert.deepEqual(await (await fetch(`${baseUrl}/api/profile`, { headers: { cookie } })).json(), filledProfile)
  assert.equal((await (await fetch(`${baseUrl}/api/positioning/candidates`, { headers: { cookie } })).json()).length, 3)
  assert.deepEqual(await (await fetch(`${baseUrl}/api/positioning/candidates`, { headers: { cookie: otherCookie } })).json(), [])
  await fetch(`${baseUrl}/api/positioning`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ interview_answers: { 0: '更新的经历' } }) })
  const staleConfirm = await fetch(`${baseUrl}/api/positioning/candidates/${candidates[0].id}`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'confirmed' }) })
  assert.equal(staleConfirm.status, 409)

  const keywordResponse = await fetch(`${baseUrl}/api/positioning/generate-keywords`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(keywordResponse.status, 200)
  const generatedPositioning = await keywordResponse.json()
  assert.ok(generatedPositioning.keyword_groups.length)
  assert.ok(generatedPositioning.topic_groups.length)

  const uploadResponse = await fetch(`${baseUrl}/api/materials/upload`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'uploaded-note.md', path: 'notes/uploaded-note.md', content: '# 上传内容' }),
  })
  assert.equal(uploadResponse.status, 201)
  const uploadedMaterial = await uploadResponse.json()
  assert.equal(uploadedMaterial.format, 'markdown')

  const deleteSyncResponse = await fetch(`${baseUrl}/api/materials/sync`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ device_id: 'desktop-test', files: [{ type: 'deleted', name: uploadedMaterial.name, path: uploadedMaterial.source_path, checksum: 'deleted-checksum' }] }),
  })
  assert.equal(deleteSyncResponse.status, 202)
  assert.equal((await deleteSyncResponse.json()).results[0].status, 'withdrawn')
  const visibleMaterials = await fetch(`${baseUrl}/api/materials`, { headers: { cookie } })
  assert.equal((await visibleMaterials.json()).some(item => item.id === uploadedMaterial.id), false)

  const topicResponse = await fetch(`${baseUrl}/api/topics/generate`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ material_ids: [material.id] }),
  })
  assert.equal(topicResponse.status, 201)
  const topics = await topicResponse.json()
  assert.equal(new Set(topics.map(item => JSON.stringify(item.source_refs))).size, 1)
  assert.equal(topics[0].source_refs[0].type, 'material')
  assert.equal(topics[0].source_refs[0].id, material.id)
  assert.equal(topics[0].owner_id, 'integration-user')
  assert.equal(topics[0].fact_risk, 'needs_review')
  assert.equal(topics[0].generation_context.source_count, 1)

  const missingSources = await fetch(`${baseUrl}/api/topics/generate`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ material_ids: [] }),
  })
  assert.equal(missingSources.status, 422)

  const draftResponse = await fetch(`${baseUrl}/api/drafts/generate`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ topic_id: topics[0].id }),
  })
  assert.equal(draftResponse.status, 201)
  const drafts = await draftResponse.json()
  assert.deepEqual(drafts.map(item => item.platform), ['小红书', '抖音', '视频号', '公众号'])
  assert.equal(new Set(drafts.map(item => item.topic_id)).size, 1)
  assert.equal(new Set(drafts.map(item => JSON.stringify(item.source_refs))).size, 1)
  assert.deepEqual(drafts[0].source_refs, topics[0].source_refs)
  assert.equal(drafts[0].owner_id, 'integration-user')

  const copiedDraftResponse = await fetch(`${baseUrl}/api/drafts/${drafts[0].id}/copy`, { method: 'POST', headers: { cookie } })
  assert.equal(copiedDraftResponse.status, 201)
  assert.match((await copiedDraftResponse.json()).title, /（副本）$/)

  const inconsistentDraft = await fetch(`${baseUrl}/api/drafts/${drafts[0].id}`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ source_refs: [] }),
  })
  assert.equal(inconsistentDraft.status, 422)

  const unverifiedPublish = await fetch(`${baseUrl}/api/drafts/${drafts[0].id}`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'published' }),
  })
  assert.equal(unverifiedPublish.status, 409)

  const verifiedPublish = await fetch(`${baseUrl}/api/drafts/${drafts[0].id}`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'published', fact_check_status: 'verified', version: drafts[0].version }),
  })
  assert.equal(verifiedPublish.status, 409)
  assert.equal((await verifiedPublish.json()).code, 'invalid_transition')

  const otherDrafts = await fetch(`${baseUrl}/api/drafts`, { headers: { cookie: otherCookie } })
  assert.equal(otherDrafts.status, 200)
  assert.equal((await otherDrafts.json()).some(item => item.id === drafts[0].id), false)

  const updatedDraft = await fetch(`${baseUrl}/api/drafts/${drafts[0].id}`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ title: '已更新标题', owner_id: 'other-integration-user' }),
  })
  assert.equal(updatedDraft.status, 200)
  const updated = await updatedDraft.json()
  assert.equal(updated.owner_id, 'integration-user')
  assert.equal(updated.title, '已更新标题')
  const historyResponse = await fetch(`${baseUrl}/api/drafts/${drafts[0].id}/history`, { headers: { cookie } })
  assert.equal(historyResponse.status, 200)
  assert.ok((await historyResponse.json()).length)

  const staleDraft = await fetch(`${baseUrl}/api/drafts/${drafts[0].id}`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ title: '过期版本', version: 1 }),
  })
  assert.equal(staleDraft.status, 409)
  const staleDraftPayload = await staleDraft.json()
  assert.equal(staleDraftPayload.conflict.status, 'open')
  const conflicts = await fetch(`${baseUrl}/api/sync/conflicts`, { headers: { cookie } })
  assert.equal(conflicts.status, 200)
  const openConflicts = await conflicts.json()
  assert.ok(openConflicts.some(item => item.id === staleDraftPayload.conflict.id))
  const resolvedConflict = await fetch(`${baseUrl}/api/sync/conflicts/${staleDraftPayload.conflict.id}`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ resolution: 'local' }),
  })
  assert.equal(resolvedConflict.status, 200)
  assert.equal((await resolvedConflict.json()).conflict.status, 'resolved')

  const invalidDraftStatus = await fetch(`${baseUrl}/api/drafts/${drafts[0].id}`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'unknown' }),
  })
  assert.equal(invalidDraftStatus.status, 422)

  let shootingDraft = await fetch(`${baseUrl}/api/drafts/${drafts[1].id}/hooks`, {
    headers: { cookie, 'content-type': 'application/json' },
    method: 'POST',
    body: '{}',
  })
  assert.equal(shootingDraft.status, 200)
  const jsonHeaders = { cookie, 'content-type': 'application/json' }
  shootingDraft = await shootingDraft.json()
  shootingDraft = await (await fetch(`${baseUrl}/api/drafts/${shootingDraft.id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ selected_hook_id: shootingDraft.hooks[0].id, version: shootingDraft.version }) })).json()
  shootingDraft = await (await fetch(`${baseUrl}/api/drafts/${shootingDraft.id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ fact_check_status: 'verified', version: shootingDraft.version }) })).json()
  shootingDraft = await (await fetch(`${baseUrl}/api/drafts/${shootingDraft.id}/checks/persona`, { method: 'POST', headers: jsonHeaders, body: '{}' })).json()
  shootingDraft = await (await fetch(`${baseUrl}/api/drafts/${shootingDraft.id}/checks/quality`, { method: 'POST', headers: jsonHeaders, body: '{}' })).json()
  shootingDraft = await (await fetch(`${baseUrl}/api/drafts/${shootingDraft.id}/checks/publish`, { method: 'POST', headers: jsonHeaders, body: '{}' })).json()
  const approvedDraft = await fetch(`${baseUrl}/api/drafts/${shootingDraft.id}/approve`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ version: shootingDraft.version }) })
  assert.equal(approvedDraft.status, 200)

  const shooting = await fetch(`${baseUrl}/api/shooting/today`, { headers: { cookie } })
  assert.equal(shooting.status, 200)
  const shootingItems = await shooting.json()
  const shootingItem = shootingItems.find(item => item.draft_id === shootingDraft.id)
  assert.equal(shootingItem.owner_id, 'integration-user')
  assert.equal(shootingItem.version, 1)

  const otherShooting = await fetch(`${baseUrl}/api/shooting/today`, { headers: { cookie: otherCookie } })
  assert.equal(otherShooting.status, 200)
  assert.equal((await otherShooting.json()).some(item => item.id === shootingItem.id), false)

  const otherUpdate = await fetch(`${baseUrl}/api/shooting/${shootingItem.id}`, {
    method: 'PUT',
    headers: { cookie: otherCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'done' }),
  })
  assert.equal(otherUpdate.status, 404)

  const invalidShootingStatus = await fetch(`${baseUrl}/api/shooting/${shootingItem.id}`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'unknown' }),
  })
  assert.equal(invalidShootingStatus.status, 422)

  const staleShooting = await fetch(`${baseUrl}/api/shooting/${shootingItem.id}`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'in_progress', version: 0 }),
  })
  assert.equal(staleShooting.status, 409)

  const withdrawnMaterial = await fetch(`${baseUrl}/api/materials/${material.id}`, {
    method: 'DELETE',
    headers: { cookie },
  })
  assert.equal(withdrawnMaterial.status, 200)
  const withdrawn = await withdrawnMaterial.json()
  assert.equal(withdrawn.status, 'withdrawn')
  assert.match(withdrawn.deleted_at, /^20/)

  const remainingMaterials = await fetch(`${baseUrl}/api/materials`, { headers: { cookie } })
  assert.equal((await remainingMaterials.json()).some(item => item.id === material.id), false)

  const withdrawnTopic = await fetch(`${baseUrl}/api/topics/generate`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ material_ids: [material.id] }),
  })
  assert.equal(withdrawnTopic.status, 422)

  const researchResponse = await fetch(`${baseUrl}/api/research/refresh`, { method: 'POST', headers: { cookie } })
  assert.equal(researchResponse.status, 200)
  const researchItems = (await researchResponse.json()).items
  const analysisResponse = await fetch(`${baseUrl}/api/research/${researchItems[0].id}/analyze`, { method: 'POST', headers: { cookie } })
  assert.equal(analysisResponse.status, 200)
  const analyzed = await analysisResponse.json()
  assert.ok(analyzed.analysis.thesis)
  assert.deepEqual(analyzed.analysis.evidence_refs, analyzed.source_refs)
  assert.ok(analyzed.analysis.transferable_patterns.length)

  const loggedOut = await fetch(`${baseUrl}/api/auth/session`, { method: 'DELETE', headers: { cookie } })
  assert.equal(loggedOut.status, 204)

  const afterLogout = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie } })
  assert.equal(afterLogout.status, 200)
  assert.deepEqual(await afterLogout.json(), { auth_required: false })
})

test('API 超过配置限额后返回 429 并携带请求追踪 ID', async t => {
  const serverPort = port + 1
  const server = await startServer({ serverPort, extraEnv: { API_RATE_LIMIT_MAX: '1', API_RATE_LIMIT_WINDOW_MS: '60000' } })
  t.after(() => server.kill())
  const first = await fetch(`http://127.0.0.1:${serverPort}/api/profile`)
  assert.equal(first.status, 200)
  assert.match(first.headers.get('x-request-id'), /^[0-9a-f-]{36}$/)
  const second = await fetch(`http://127.0.0.1:${serverPort}/api/profile`)
  assert.equal(second.status, 429)
  assert.equal(second.headers.get('retry-after'), '60')
  assert.match(second.headers.get('x-request-id'), /^[0-9a-f-]{36}$/)
})

test('生产模式默认账号制：未登录拦截、注册、登录与数据隔离', async t => {
  const productionPort = port + 1000
  const server = await startServer({ serverPort: productionPort, nodeEnv: 'production' })
  t.after(() => server.kill())
  const prodBase = `http://127.0.0.1:${productionPort}`

  const probe = await fetch(`${prodBase}/api/auth/session`)
  assert.equal(probe.status, 401)
  assert.deepEqual(await probe.json(), { error: '需要登录', auth_required: true, registration_open: true })

  const gatedProfile = await fetch(`${prodBase}/api/profile`)
  assert.equal(gatedProfile.status, 401)

  const registerA = await fetch(`${prodBase}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'AliceBeta', password: 'password-123' }) })
  assert.equal(registerA.status, 200)
  assert.equal((await registerA.json()).user_id, 'alicebeta')
  const cookieA = registerA.headers.get('set-cookie').split(';', 1)[0]

  const registerDuplicate = await fetch(`${prodBase}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alicebeta', password: 'password-456' }) })
  assert.equal(registerDuplicate.status, 409)

  const registerShortPassword = await fetch(`${prodBase}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'bobby', password: 'short' }) })
  assert.equal(registerShortPassword.status, 422)

  const registerB = await fetch(`${prodBase}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'bobby', password: 'password-456' }) })
  assert.equal(registerB.status, 200)
  const cookieB = registerB.headers.get('set-cookie').split(';', 1)[0]

  const profileA = await fetch(`${prodBase}/api/profile`, { method: 'PUT', headers: { cookie: cookieA, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'A 的身份定位' }) })
  assert.equal(profileA.status, 200)

  const memoryA = await fetch(`${prodBase}/api/memories`, { method: 'POST', headers: { cookie: cookieA, 'content-type': 'application/json' }, body: JSON.stringify({ memory_type: 'style', content: 'A 的风格记忆' }) })
  assert.equal(memoryA.status, 201)

  const profileB = await fetch(`${prodBase}/api/profile`, { headers: { cookie: cookieB } }).then(response => response.json())
  assert.equal(profileB.role, '')
  const memoriesB = await fetch(`${prodBase}/api/memories`, { headers: { cookie: cookieB } }).then(response => response.json())
  assert.equal(memoriesB.length, 0)

  const badLogin = await fetch(`${prodBase}/api/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alicebeta', password: 'wrong-pass-1' }) })
  assert.equal(badLogin.status, 401)

  const goodLogin = await fetch(`${prodBase}/api/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'AliceBeta', password: 'password-123' }) })
  assert.equal(goodLogin.status, 200)
  assert.equal((await goodLogin.json()).user_id, 'alicebeta')
})

test('production access password gates the session', async t => {
  const prodPort = 3700 + Math.floor(Math.random() * 200)
  const prodBaseUrl = `http://127.0.0.1:${prodPort}`
  const prodDataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-prod-')), 'data.json')
  writeFileSync(prodDataFile, '{}')
  const server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(prodPort),
      NODE_ENV: 'production',
      APP_ORIGIN: 'http://localhost:5173',
      DATA_FILE: prodDataFile,
      PRODUCT_ACCESS_PASSWORD: 'test-access-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => server.kill())
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('生产 API 启动超时')), 5000)
    server.stdout.on('data', data => {
      if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(null) }
    })
    server.once('exit', code => { if (code !== null) reject(new Error(`生产 API 异常退出: ${code}`)) })
  })

  const wrongPassword = await fetch(`${prodBaseUrl}/api/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) })
  assert.equal(wrongPassword.status, 401)
  assert.equal((await wrongPassword.json()).error, '访问密码不正确')

  const correctPassword = await fetch(`${prodBaseUrl}/api/auth/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-access-secret' }) })
  assert.equal(correctPassword.status, 200)
  const created = await correctPassword.json()
  assert.equal(created.user_id, 'owner')
  assert.equal(created.expires_in, 30 * 24 * 3600)
  const cookie = correctPassword.headers.get('set-cookie').split(';', 1)[0]
  assert.match(cookie, /^content_ip_session=.+/)
  assert.match(correctPassword.headers.get('set-cookie'), /; Secure/)

  const withSession = await fetch(`${prodBaseUrl}/api/structures`, { headers: { cookie } })
  assert.equal(withSession.status, 200)

  const withoutSession = await fetch(`${prodBaseUrl}/api/structures`)
  assert.equal(withoutSession.status, 401)
})
