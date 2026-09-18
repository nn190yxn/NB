import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { activeFeatureReplacements, buildPreferenceRecords, draftVersions, finalDraftCandidates, performanceCandidates } from './return-flow.mjs'
import { testPort } from './test-port.mjs'

const llmMock = await startSharedLlmMock()

const makeWorkspace = () => {
  const dir = mkdtempSync(join(tmpdir(), 'return-flow-'))
  return { dir, dataFile: join(dir, 'state.json') }
}

function startServer(listenPort, dataFile) {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...llmMock.env, PORT: String(listenPort), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务启动超时')), 15000)
    child.stdout.on('data', chunk => { if (String(chunk).includes('Content IP API listening')) { clearTimeout(timer); resolve(child) } })
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`服务退出：${code}`)) })
  })
}

test('终稿回流只数得出来的差分：改短了提示少铺垫，删解释句提示少解释', () => {
  const longer = '其实流量不等于成交。因为后台的点赞和询盘是两回事，所以别盯着点赞看。总之要看询盘。'
  const shorter = '其实流量不等于成交。要看询盘。'
  const candidates = finalDraftCandidates({ id: 5, version: 3, body: shorter, history: [{ version: 1, body: longer }], approval: { status: 'approved', draft_version: 3 } })
  const byId = new Map(candidates.map(item => [item.local_id, item]))
  // 删两句（一句解释、一句总结），同时新出现一句「要看询盘。」算自己加的。
  assert.deepEqual([...byId.keys()], ['length', 'deleted', 'added'])
  assert.match(byId.get('length').observation, /改到/)
  assert.match(byId.get('length').proposal, /更短/)
  // 删掉的两句都是解释性的（因为…所以…），提议就该指向少解释。
  assert.match(byId.get('deleted').proposal, /少解释/)
  assert.equal(byId.get('deleted').source.draft_id, 5)
  assert.ok(byId.get('deleted').evidence.deleted.length >= 1)

  // 只有一版可比的时候不硬编差分。
  assert.equal(draftVersions({ id: 6, version: 1, body: '只有一版', history: [] }).changed, false)
  assert.deepEqual(finalDraftCandidates({ id: 6, version: 1, body: '只有一版', history: [] }), [])
  // 两版一样也不算改过。
  assert.equal(draftVersions({ id: 7, version: 2, body: '同一句。', history: [{ version: 1, body: '同一句。' }] }).changed, false)
})

test('数据回流只认确认过的快照，待确认的不参与', () => {
  const snapshots = [
    { id: 1, draft_id: 8, platform: '抖音', status: 'confirmed', metrics: { views: 9000 } },
    { id: 2, draft_id: 9, platform: '抖音', status: 'confirmed', metrics: { views: 300 } },
    { id: 3, draft_id: 10, platform: '抖音', status: 'pending_confirmation', metrics: { views: 99999 } },
    { id: 4, draft_id: 11, platform: '视频号', status: 'confirmed', metrics: { views: 500 } },
    { id: 5, draft_id: 12, platform: '抖音', status: 'confirmed', metrics: { views: null } },
  ]
  const candidates = performanceCandidates(snapshots)
  assert.equal(candidates.length, 1, '视频号只确认了一条，不够比')
  assert.match(candidates[0].observation, /9000/)
  assert.match(candidates[0].proposal, /抖音/)
  assert.deepEqual(candidates[0].source.snapshot_ids, [1, 2])
  assert.deepEqual(performanceCandidates([]), [])
})

test('候选默认待确认：同一条不重复产出，确认才生效，撤回留痕', () => {
  const candidates = [{ local_id: 'length', kind: '终稿回流', observation: '观察', proposal: '提议', source: { draft_id: 5 } }]
  const first = buildPreferenceRecords(candidates, { ownerId: 'u1', existing: [], now: '2026-09-18T00:00:00.000Z' })
  assert.equal(first.length, 1)
  assert.equal(first[0].status, 'pending')
  assert.equal(first[0].replaces_feature, null)
  assert.deepEqual(first[0].trace, [{ at: '2026-09-18T00:00:00.000Z', action: 'produced' }])

  // 同一条已经产出过（哪怕被拒了）就不再问第二遍。
  assert.deepEqual(buildPreferenceRecords(candidates, { ownerId: 'u1', existing: [{ ...first[0], id: 1, status: 'rejected' }] }), [])

  const preferences = [
    { id: 1, status: 'active', replaces_feature: 3, proposal: '偏好：更短', source: { draft_id: 5 } },
    { id: 2, status: 'pending', replaces_feature: 7, proposal: '待确认的不算' },
    { id: 3, status: 'rejected', replaces_feature: 9, proposal: '拒掉的不算' },
    { id: 4, status: 'active', replaces_feature: null, proposal: '没指定替换目标' },
  ]
  const replacements = activeFeatureReplacements(preferences)
  assert.equal(replacements.size, 1)
  assert.equal(replacements.get(3).preference_id, 1)
})

async function createApprovedDraft(base, headers, title) {
  const generated = await (await fetch(`${base}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title, strategy_layer: 'trust', goal_refs: ['trust'], source_refs: [{ type: 'topic', id: title }] } }) })).json()
  let draft = generated[0]
  await fetch(`${base}/api/structures`, { method: 'POST', headers, body: JSON.stringify({ title: '对标dbs·开头范式一：预测攻击式', steps: ['公式：反常识断言 + 能力反转'], content_type: '开头钩子' }) })
  const catalog = await (await fetch(`${base}/api/draft-slots?platform=${encodeURIComponent(draft.platform)}`, { headers })).json()
  await fetch(`${base}/api/drafts/${draft.id}/slots/opening`, { method: 'POST', headers, body: JSON.stringify({ option_id: catalog.options.opening[0].id }) })
  draft = (await (await fetch(`${base}/api/drafts`, { headers })).json()).find(item => item.id === draft.id)
  draft = await (await fetch(`${base}/api/drafts/${draft.id}`, { method: 'PUT', headers, body: JSON.stringify({ fact_check_status: 'verified', version: draft.version }) })).json()
  for (const check of ['persona', 'quality', 'publish']) draft = await (await fetch(`${base}/api/drafts/${draft.id}/checks/${check}`, { method: 'POST', headers, body: '{}' })).json()
  const approved = await (await fetch(`${base}/api/drafts/${draft.id}/approve`, { method: 'POST', headers, body: JSON.stringify({ version: draft.version }) })).json()
  return approved.draft
}

async function recheckAndApprove(base, headers, draft) {
  const step = async (url, init, label) => {
    const response = await fetch(url, init)
    const payload = await response.json()
    assert.equal(response.status, 200, `${label}失败：${JSON.stringify(payload).slice(0, 200)}`)
    assert.ok(payload.id, `${label}没返回草稿`)
    return payload
  }
  let next = await step(`${base}/api/drafts/${draft.id}`, { method: 'PUT', headers, body: JSON.stringify({ fact_check_status: 'verified', version: draft.version }) }, '重新核验事实')
  for (const check of ['persona', 'quality', 'publish']) next = await step(`${base}/api/drafts/${next.id}/checks/${check}`, { method: 'POST', headers, body: '{}' }, `${check} 检查`)
  // 定稿接口回的是 { status, draft, shooting } 这层包装，没有顶层 id。
  const approvedResponse = await fetch(`${base}/api/drafts/${next.id}/approve`, { method: 'POST', headers, body: JSON.stringify({ version: next.version }) })
  const approved = await approvedResponse.json()
  assert.equal(approvedResponse.status, 200, `第二次定稿失败：${JSON.stringify(approved).slice(0, 200)}`)
  assert.ok(approved.draft, '第二次定稿没返回草稿')
  return approved.draft
}

test('回流候选要用户确认才生效，确认过程不碰草稿', async t => {
  const port = testPort(51700, 150)
  const workspace = makeWorkspace()
  const server = await startServer(port, workspace.dataFile)
  t.after(() => { server.kill(); rmSync(workspace.dir, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${port}`
  const headers = { 'x-user-id': 'flow-owner', 'content-type': 'application/json' }

  // 先有一版定稿，再改一版重新定稿，才有两版可比。
  const first = await createApprovedDraft(base, headers, '回流用的稿子')
  const revised = await (await fetch(`${base}/api/drafts/${first.id}/revise`, { method: 'POST', headers, body: JSON.stringify({ note: '删掉解释，直接给判断', version: first.version }) })).json()
  assert.notEqual(revised.body, first.body)
  // 改稿接口只回改写结果（正文 + 备注），草稿 id 和版本还是从已知的那份拿。
  const second = await recheckAndApprove(base, headers, { id: first.id, version: revised.version })
  assert.equal(second.approval.status, 'approved')

  const before = await (await fetch(`${base}/api/drafts/${second.id}`, { headers })).json()
  const derivedResponse = await fetch(`${base}/api/drafts/${second.id}/preferences`, { method: 'POST', headers, body: '{}' })
  const derived = await derivedResponse.json()
  assert.equal(derivedResponse.status, 200, `产出候选失败：${JSON.stringify(derived).slice(0, 200)}`)
  assert.ok(derived.created.length >= 1, '改过一版应该至少能数出一条差分')
  assert.ok(derived.created.every(item => item.status === 'pending'), '候选默认待确认')
  assert.ok(derived.created.every(item => item.source?.draft_id === second.id))

  // 同一条不重复问第二遍。
  const again = await (await fetch(`${base}/api/drafts/${second.id}/preferences`, { method: 'POST', headers, body: '{}' })).json()
  assert.equal(again.created.length, 0)

  // 确认才生效；替换目标必须是真实存在的通用特征编号。
  const target = derived.created[0]
  const badFeature = await fetch(`${base}/api/preferences/${target.id}/confirm`, { method: 'POST', headers, body: JSON.stringify({ replaces_feature: 999 }) })
  assert.equal(badFeature.status, 422)
  const confirmedResponse = await fetch(`${base}/api/preferences/${target.id}/confirm`, { method: 'POST', headers, body: JSON.stringify({ replaces_feature: 1 }) })
  const confirmed = await confirmedResponse.json()
  assert.equal(confirmedResponse.status, 200)
  assert.equal(confirmed.status, 'active')
  assert.equal(confirmed.replaces_feature, 1)

  const rejectedResponse = await fetch(`${base}/api/preferences/${derived.created[1].id}/reject`, { method: 'POST', headers, body: JSON.stringify({ reason: '这条不是我' }) })
  assert.equal((await rejectedResponse.json()).status, 'rejected')

  const listed = await (await fetch(`${base}/api/preferences`, { headers })).json()
  assert.equal(listed.preferences.length, derived.created.length)
  assert.deepEqual(listed.replaced_features.map(item => item.feature_id), [1], '只有确认过的才算替换')
  assert.equal(listed.replaced_features[0].proposal, target.proposal)

  // 不自动改写判据：草稿正文、版本、检查、确认状态都没被动过。
  const after = await (await fetch(`${base}/api/drafts/${second.id}`, { headers })).json()
  assert.equal(after.body, before.body)
  assert.equal(after.version, before.version)
  assert.deepEqual(after.checks, before.checks)
  assert.deepEqual(after.approval, before.approval)
})
