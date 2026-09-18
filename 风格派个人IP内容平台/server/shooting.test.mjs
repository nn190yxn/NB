import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

// Requirement 15：定稿之后能直接拍，提词器只读定稿版本。
// 定稿进拍摄这件事由「确认定稿」这一步完成：确认时把那一版正文冻进拍摄项，
// 之后再改草稿也不动拍摄项里的 script。这个文件把这个既有行为钉住，防止哪天被改漏。
const llmMock = await startSharedLlmMock()

const makeWorkspace = () => {
  const dir = mkdtempSync(join(tmpdir(), 'shooting-'))
  return { dir, dataFile: join(dir, 'state.json') }
}

function startServer(listenPort, dataFile) {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...llmMock.env, PORT: String(listenPort), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务启动超时')), 15000)
    child.stdout.on('data', chunk => { if (String(chunk).includes('Content IP API listening')) { clearTimeout(timer); resolve(child) } })
    child.stderr.on('data', chunk => { if (String(chunk).includes('Error')) { clearTimeout(timer); reject(new Error(String(chunk))) } })
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`服务退出：${code}`)) })
  })
}

async function createCheckedDraft(base, headers, title) {
  const generated = await (await fetch(`${base}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title, strategy_layer: 'trust', goal_refs: ['trust'], source_refs: [{ type: 'topic', id: title }] } }) })).json()
  let draft = generated[0]
  // 开头句槽位是开头的唯一入口，发布前检查要求它有记录；槽位选项来自结构库，先建一条。
  await fetch(`${base}/api/structures`, { method: 'POST', headers, body: JSON.stringify({ title: '对标dbs·开头范式一：预测攻击式', steps: ['公式：反常识断言 + 能力反转'], content_type: '开头钩子' }) })
  const slotResponse = await fetch(`${base}/api/draft-slots?platform=${encodeURIComponent(draft.platform)}`, { headers })
  const catalog = await slotResponse.json()
  assert.ok(catalog.options?.opening?.length, `槽位目录取不到：${slotResponse.status}`)
  await fetch(`${base}/api/drafts/${draft.id}/slots/opening`, { method: 'POST', headers, body: JSON.stringify({ option_id: catalog.options.opening[0].id }) })
  draft = (await (await fetch(`${base}/api/drafts`, { headers })).json()).find(item => item.id === draft.id)
  draft = await (await fetch(`${base}/api/drafts/${draft.id}`, { method: 'PUT', headers, body: JSON.stringify({ fact_check_status: 'verified', version: draft.version }) })).json()
  draft = await (await fetch(`${base}/api/drafts/${draft.id}/checks/persona`, { method: 'POST', headers, body: '{}' })).json()
  draft = await (await fetch(`${base}/api/drafts/${draft.id}/checks/quality`, { method: 'POST', headers, body: '{}' })).json()
  draft = await (await fetch(`${base}/api/drafts/${draft.id}/checks/publish`, { method: 'POST', headers, body: '{}' })).json()
  return draft
}

const approve = (base, headers, draft) => fetch(`${base}/api/drafts/${draft.id}/approve`, { method: 'POST', headers, body: JSON.stringify({ version: draft.version }) })

test('没确认定稿就没有拍摄项，确认后才进拍摄且冻的是定稿正文', async t => {
  const port = testPort(49900, 150)
  const workspace = makeWorkspace()
  const server = await startServer(port, workspace.dataFile)
  t.after(() => { server.kill(); rmSync(workspace.dir, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${port}`
  const headers = { 'x-user-id': 'shoot-gate', 'content-type': 'application/json' }

  const fresh = await (await fetch(`${base}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title: '还没定稿的草稿', strategy_layer: 'trust', goal_refs: [] } }) })).json()
  const beforeApproval = await fetch(`${base}/api/drafts/${fresh[0].id}/approve`, { method: 'POST', headers, body: JSON.stringify({ version: fresh[0].version }) })
  assert.equal(beforeApproval.status, 409, '没过检查的草稿不能定稿，也就进不了拍摄')
  const empty = await (await fetch(`${base}/api/shooting/today`, { headers })).json()
  assert.equal(empty.length, 0)

  const draft = await createCheckedDraft(base, headers, '真实创业复盘')
  const approvedResponse = await approve(base, headers, draft)
  const approved = await approvedResponse.json()
  assert.equal(approvedResponse.status, 200, `定稿失败：${JSON.stringify(approved).slice(0, 200)}`)
  assert.equal(approved.status, 'approved')
  assert.equal(approved.draft.workflow_status, 'ready_to_shoot')
  assert.equal(approved.shooting.script, draft.body, '拍摄项里冻的是定稿正文')
  assert.equal(approved.shooting.draft_id, draft.id)
  assert.equal(approved.shooting.status, 'ready_to_shoot')

  // 再确认一次不新增拍摄项：按已记录的定稿版本重放确认，还是同一条。
  const againResponse = await approve(base, headers, { id: draft.id, version: approved.draft.approval.draft_version })
  const again = await againResponse.json()
  assert.equal(againResponse.status, 200, `重复确认失败：${JSON.stringify(again).slice(0, 200)}`)
  assert.equal(again.shooting.id, approved.shooting.id)
  const today = await (await fetch(`${base}/api/shooting/today`, { headers })).json()
  assert.equal(today.filter(entry => entry.draft_id === draft.id).length, 1)
})

test('定稿进拍摄后再改草稿，提词器读到的还是那一版定稿', async t => {
  const port = testPort(50000, 150)
  const workspace = makeWorkspace()
  const server = await startServer(port, workspace.dataFile)
  t.after(() => { server.kill(); rmSync(workspace.dir, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${port}`
  const headers = { 'x-user-id': 'shoot-frozen', 'content-type': 'application/json' }

  const draft = await createCheckedDraft(base, headers, '定稿后再改的稿子')
  const approved = await (await approve(base, headers, draft)).json()
  const frozen = approved.shooting.script
  assert.equal(frozen, draft.body, '拍摄项里冻的是定稿正文')

  // 定稿后要改稿得先撤回定稿；撤回只把可拍状态收回去，拍摄项里的 script 不动。
  const revokedResponse = await fetch(`${base}/api/drafts/${draft.id}/revoke-approval`, { method: 'POST', headers, body: JSON.stringify({ version: approved.draft.version, reason: '开头要重写' }) })
  assert.equal(revokedResponse.status, 200)
  const revoked = await revokedResponse.json()
  const reviseResponse = await fetch(`${base}/api/drafts/${draft.id}/revise`, { method: 'POST', headers, body: JSON.stringify({ note: '把开头改得更具体', version: revoked.draft.version }) })
  const revised = await reviseResponse.json()
  assert.equal(reviseResponse.status, 200, `改稿失败：${JSON.stringify(revised).slice(0, 200)}`)
  assert.notEqual(revised.body, frozen, '改稿后正文应该变了，否则这条测试没意义')

  const today = await (await fetch(`${base}/api/shooting/today`, { headers })).json()
  const afterRevise = today.find(entry => entry.draft_id === draft.id)
  assert.equal(afterRevise.script, frozen, '改稿不许漏进拍摄现场')
  assert.notEqual(afterRevise.script, revised.body)
})

test('撤回定稿把拍摄项退回待改，不留在可拍状态', async t => {
  const port = testPort(50100, 150)
  const workspace = makeWorkspace()
  const server = await startServer(port, workspace.dataFile)
  t.after(() => { server.kill(); rmSync(workspace.dir, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${port}`
  const headers = { 'x-user-id': 'shoot-revoke', 'content-type': 'application/json' }

  const draft = await createCheckedDraft(base, headers, '撤回定稿的稿子')
  const approved = await (await approve(base, headers, draft)).json()
  const revokeResponse = await fetch(`${base}/api/drafts/${draft.id}/revoke-approval`, { method: 'POST', headers, body: JSON.stringify({ version: approved.draft.version, reason: '事实核验要重做' }) })
  const revoked = await revokeResponse.json()
  assert.equal(revokeResponse.status, 200, `撤回失败：${JSON.stringify(revoked).slice(0, 200)}`)
  assert.equal(revoked.shooting.status, 'needs_revision')
  assert.equal(revoked.draft.workflow_status, 'needs_revision')
  // 正文没动过，撤回只是把可拍状态收回去。
  assert.equal(revoked.shooting.script, draft.body)
})
