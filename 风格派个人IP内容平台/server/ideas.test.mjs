import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

const llmMock = await startSharedLlmMock()

// 每个测试一个自己的工作目录：共用一个目录的话，前一个测试收尾时把目录删了，
// 后一个测试的服务写状态文件就会失败（看起来像路由报错，其实是测试环境问题）。
const makeWorkspace = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ideas-'))
  return { dir, dataFile: join(dir, 'state.json') }
}

function startServer(listenPort, dataFile) {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...llmMock.env, PORT: String(listenPort), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务启动超时')), 15000)
    child.stdout.on('data', chunk => { if (String(chunk).includes('listening')) { clearTimeout(timer); resolve(child) } })
    child.stderr.on('data', chunk => { if (String(chunk).includes('Error')) { clearTimeout(timer); reject(new Error(String(chunk))) } })
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`服务退出：${code}`)) })
  })
}

const bearer = token => ({ 'x-user-id': token, 'content-type': 'application/json' })

// 失败时把服务端返回的错误体带进断言，不然只看到一个状态码没法查。
const generateDrafts = async (base, headers, payload) => {
  const response = await fetch(`${base}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify(payload) })
  const data = await response.json()
  assert.ok(response.ok, `生成草稿失败：${response.status} ${JSON.stringify(data).slice(0, 300)}`)
  assert.ok(Array.isArray(data) && data[0]?.id, `生成草稿返回的不是草稿数组：${JSON.stringify(data).slice(0, 300)}`)
  return data
}

const postIdeas = async (base, headers, draft, kind) => {
  const response = await fetch(`${base}/api/drafts/${draft.id}/ideas`, { method: 'POST', headers, body: JSON.stringify({ kind, version: draft.version }) })
  const data = await response.json()
  assert.equal(response.status, 200, `出方案失败：${JSON.stringify(data).slice(0, 300)}`)
  return data
}

test('标题方案要多个，每条带公式编号与分类，编的编号被丢掉', async t => {
  const port = testPort(42100, 150)
  const workspace = makeWorkspace()
  const server = await startServer(port, workspace.dataFile)
  t.after(() => { server.kill(); rmSync(workspace.dir, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${port}`
  const headers = bearer('ideas-owner')

  const drafts = await generateDrafts(base, headers, { topic: { title: '内容要按成交写', strategy_layer: 'trust', goal_refs: [] } })
  const draft = drafts[0]

  const updated = await postIdeas(base, headers, draft, 'title')
  const ideas = updated.ideas.title
  // 三条方案里有一条编号不存在，落到用户面前只能剩两条。
  assert.equal(ideas.plans.length, 2)
  assert.deepEqual(ideas.plans.map(item => item.formula_id), [34, 17])
  assert.equal(ideas.source.includes('小红书'), true, '举例的来源要标清')
  // 阶段 3「减负」第 2 条：例子照给，但得说清它不是这个平台的，并告诉你该改哪。
  assert.match(ideas.source_note, /小红书/, '要说清举例来自小红书')
  assert.match(ideas.source_note, /抖音/, '要说清在抖音该注意什么')
  assert.match(ideas.source_note, /别直接照搬/, '光说来源不够，要给出可执行的提醒')
  // 前台一次只给 3 条：公式库整份留在后台当弹药，不一次全摆出来。
  assert.equal(JSON.parse(llmMock.lastUser()).要几条方案, 3, '标题方案默认只问模型要 3 条')
  assert.ok(ideas.plans.length <= 3, '前台最多 3 条')

  // AC 要求的四项溯源字段都要带上，用户才看得到「为什么是这条公式」。
  const first = ideas.plans[0]
  assert.equal(first.formula_template, '[数字] 天内 [结果] 的唯一办法')
  assert.equal(first.formula_example, '90 天内打造个人 IP 变现 6 位数的唯一办法')
  assert.equal(first.category, '结果承诺')
  assert.equal(first.category_label, '结果承诺型（具体结果 + 时间框架）')
  assert.ok(first.why.includes('结果'))
  assert.equal(first.platform, '抖音')
  // 至少两个不同公式的方案，不是同一条公式换着说。
  assert.equal(new Set(ideas.plans.map(item => item.formula_id)).size, ideas.plans.length)
  assert.equal(ideas.draft_version, draft.version)

  // 换个类型：方法名不认识的那条也要被丢掉。
  const hookResponse = await fetch(`${base}/api/drafts/${draft.id}/ideas`, { method: 'POST', headers, body: JSON.stringify({ kind: 'hook', version: draft.version }) })
  const hookDraft = await hookResponse.json()
  if (hookDraft.ideas?.hook?.plans?.length) {
    assert.equal(hookDraft.ideas.hook.plans.length, 2)
    assert.deepEqual(hookDraft.ideas.hook.plans.map(item => item.method), ['素材提取', '悬念制造'])
    assert.equal(hookDraft.ideas.hook.plans[0].method_label, '方法一：素材提取')
    assert.equal(hookDraft.ideas.hook.plans[0].needs_user_material, false)
  } else {
    // 这条草稿的素材判定为「零素材」时源技能要求直接停，不出方案。
    assert.match(hookDraft.ideas.hook.blocked, /素材/)
  }
})

// 换一换：从公式库里换出没给过的，而不是把同样几条再摆一遍。
test('换一换只给没看过的公式，全看完了就如实说换不出来', async t => {
  const port = testPort(42300, 150)
  const workspace = makeWorkspace()
  const server = await startServer(port, workspace.dataFile)
  t.after(() => { server.kill(); rmSync(workspace.dir, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${port}`
  const headers = bearer('ideas-swap')

  const drafts = await generateDrafts(base, headers, { topic: { title: '换一换试试', strategy_layer: 'trust', goal_refs: [] } })
  const first = await postIdeas(base, headers, drafts[0], 'title')
  const roundOne = first.ideas.title.plans.map(item => item.formula_id)
  assert.deepEqual(roundOne, [34, 17], '第一次照旧：999 是编的编号，丢掉')
  // 第一次生成不是换一换，所以不该排除任何东西。
  assert.deepEqual(JSON.parse(llmMock.lastUser())['不许再用的公式编号'], [], '第一次生成不排除任何公式')
  assert.deepEqual(first.ideas.title.shown_formula_ids, [34, 17])
  assert.equal(first.ideas.title.formula_total, 75, '要告诉界面公式库一共多少条')

  const swap = () => fetch(`${base}/api/drafts/${first.id}/ideas`, { method: 'POST', headers, body: JSON.stringify({ kind: 'title', version: first.version, swap: true }) })

  const second = await (await swap()).json()
  const roundTwo = second.ideas.title.plans.map(item => item.formula_id)
  assert.deepEqual(roundTwo, [36, 18], '换一换给的是没见过的公式')
  assert.ok(roundTwo.every(id => !roundOne.includes(id)), '一条都不许和上一轮重复')
  assert.deepEqual(JSON.parse(llmMock.lastUser())['不许再用的公式编号'], [34, 17], '上一轮看过的要报给模型')
  assert.deepEqual(second.ideas.title.shown_formula_ids, [34, 17, 36, 18], '看过的要累积记住')

  const third = await (await swap()).json()
  const roundThree = third.ideas.title.plans.map(item => item.formula_id)
  assert.ok(roundThree.every(id => ![...roundOne, ...roundTwo].includes(id)), '第三轮还是不许重复')
  assert.deepEqual(third.ideas.title.shown_formula_ids, [34, 17, 36, 18, 22])

  // 池子里没给过的都用完了：如实说换不出来，不把旧公式重新端上来。
  const exhausted = await swap()
  assert.equal(exhausted.status, 502, '换不出来要报错，不能假装成功')
  const payload = await exhausted.json()
  assert.match(payload.error, /重复/, '错误要说清是「换出来的和之前重复」')
  // 换失败不落库，看过的名单不能被弄脏，否则用户越换越少。
  const list = await (await fetch(`${base}/api/drafts`, { headers })).json()
  assert.deepEqual(list[0].ideas.title.shown_formula_ids, [34, 17, 36, 18, 22], '换失败不该动已看过的名单')
})

test('素材为零时开头不出方案，直接照源技能停下来让人去补', async t => {
  const port = testPort(42200, 150)
  const workspace = makeWorkspace()
  const server = await startServer(port, workspace.dataFile)
  t.after(() => { server.kill(); rmSync(workspace.dir, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${port}`
  const headers = bearer('ideas-empty')

  // 不带任何素材生成：正文里也没有数据、故事、金句、权威或痛点。
  const drafts = await generateDrafts(base, headers, { topic: { title: '内容要按成交写', strategy_layer: 'trust', goal_refs: [] } })
  const draft = drafts[0]
  const updated = await postIdeas(base, headers, draft, 'hook')
  const hook = updated.ideas.hook
  assert.deepEqual(hook.plans, [], '素材为零不许拿大模型硬编开头')
  assert.match(hook.blocked, /写不出好开头/)
  assert.equal(hook.readiness.richness.verdict, 'stop')
  assert.equal(hook.readiness.richness.missing.length, 5)
  // 没走模型，所以没有 provider——这条证明停下来是本地判的，不是模型判的。
  assert.equal(hook.provider, undefined)
})

test('有素材时开头出多个方案，每条溯源到三种方法之一', async t => {
  const port = testPort(42300, 150)
  const workspace = makeWorkspace()
  const server = await startServer(port, workspace.dataFile)
  t.after(() => { server.kill(); rmSync(workspace.dir, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${port}`
  const headers = bearer('ideas-material')

  const materialResponse = await fetch(`${base}/api/materials/atoms`, { method: 'POST', headers, body: JSON.stringify({ kind: 'experience', text: '去年我发了 1200 条内容，咨询只有 3 个。学员说焦虑到想放弃。', unit_type: 'CAS', name: '自己的复盘' }) })
  const material = await materialResponse.json()
  assert.ok(material.id, `建素材失败：${materialResponse.status} ${JSON.stringify(material).slice(0, 300)}`)
  const drafts = await generateDrafts(base, headers, { topic: { title: '内容要按成交写', strategy_layer: 'trust', goal_refs: [] }, experience_ids: [material.id] })
  const draft = drafts[0]

  const updated = await postIdeas(base, headers, draft, 'hook')
  const hook = updated.ideas.hook
  assert.equal(hook.plans.length, 2)
  assert.equal(hook.blocked, undefined)
  // 素材里带了数字和痛点，判定至少不是零素材；具体停在 limited 还是 ready 不是这条测试要管的。
  assert.ok(hook.readiness.richness.count >= 2)
  assert.notEqual(hook.readiness.richness.verdict, 'stop')
  assert.deepEqual(hook.plans.map(item => item.method), ['素材提取', '悬念制造'])
  // 三种方法整份带上，用户看得到还有哪条没出。
  assert.deepEqual(hook.methods.map(item => item.id), ['素材提取', '素材增补', '悬念制造'])
  assert.ok(hook.provider)

  // 正文一改，旧方案不能再摆着——版本对不上就得清掉。
  const revised = await (await fetch(`${base}/api/drafts/${draft.id}/revise`, { method: 'POST', headers, body: JSON.stringify({ note: '把开头改得更具体', version: draft.version }) })).json()
  assert.equal(revised.ideas, null, '正文改了，旧方案要清掉')
})

test('用 material_ids 挂上 CAS 经历后，开头方案不再按零素材停', async t => {
  const port = testPort(42400, 150)
  const workspace = makeWorkspace()
  const server = await startServer(port, workspace.dataFile)
  t.after(() => { server.kill(); rmSync(workspace.dir, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${port}`
  const headers = bearer('ideas-cas-role')

  const materialResponse = await fetch(`${base}/api/materials/atoms`, { method: 'POST', headers, body: JSON.stringify({ kind: 'experience', unit_type: 'CAS', name: '询盘比点赞诚实', text: '去年有个做咨询的客户，账号发了半年没人问。改完第一条讲询盘，当周就有人来问价。' }) })
  const material = await materialResponse.json()
  assert.ok(material.id, `建素材失败：${materialResponse.status}`)
  const drafts = await generateDrafts(base, headers, { topic: { title: '内容要按成交写', strategy_layer: 'trust', goal_refs: [] }, material_ids: [material.id] })
  const draft = drafts[0]
  assert.deepEqual(draft.generation_context.material_ids, [material.id])

  const updated = await postIdeas(base, headers, draft, 'hook')
  const hook = updated.ideas.hook
  assert.equal(hook.blocked, undefined, '有真实经历不该按零素材停')
  assert.notEqual(hook.readiness.richness.verdict, 'stop')
  assert.ok(hook.readiness.richness.count >= 1)
  assert.ok(hook.plans.length >= 1)
})
