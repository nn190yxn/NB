import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { draftBriefPrompt, buildDraftBrief } from './draft-writing.mjs'
import { counterpartClaims, resolveStance } from './topic-stance.mjs'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

const claim = (id, angle, text, extra = {}) => ({ id, unit_type: 'OPI', material_kind: 'insight', content: text, name: text.slice(0, 12), angle, checksum: `c${id}`, ...extra })

test('主观点就是素材库里那条主张：选题只记编号', () => {
  const materials = [claim(1, '老板', '成本不在人在流程', { claims_run: 'R1' }), claim(2, '员工', '学不会是因为没人带', { claims_run: 'R1' })]
  assert.equal(resolveStance({ viewpoint_material_id: null }, materials), null)
  assert.equal(resolveStance({}, materials), null, '老选题没这个字段，读出来是没定观点，不是报错')
  const stance = resolveStance({ viewpoint_material_id: 1 }, materials)
  assert.equal(stance.text, '成本不在人在流程')
  assert.equal(stance.angle, '老板')
  assert.equal(stance.run_id, 'R1')
  assert.equal(stance.logic_state, 'unchecked')
  assert.equal(resolveStance({ viewpoint_material_id: 99 }, materials), null, '指向不存在的素材不算定了观点')
})

test('反方优先取同一次拆解的另一角度，没有配对才退回同一来源', () => {
  const materials = [
    claim(1, '老板', '成本不在人在流程', { claims_run: 'R1', source_refs: [{ type: 'research', id: 7 }] }),
    claim(2, '员工', '学不会是因为没人带', { claims_run: 'R1', source_refs: [{ type: 'research', id: 7 }] }),
    claim(3, '客户', '贵不怕，怕没结果', { claims_run: 'R2' }),
    claim(4, '同行', '这行本来就卷', { source_refs: [{ type: 'research', id: 7 }] }),
  ]
  const stance = resolveStance({ viewpoint_material_id: 1 }, materials)
  const paired = counterpartClaims(stance, materials)
  assert.deepEqual(paired.map(item => item.angle), ['员工'], '配对存在时只用配对的那组，不把全库不同角度的都拖进来')
  assert.equal(paired[0].material_id, 2)

  const orphan = resolveStance({ viewpoint_material_id: 3 }, materials)
  assert.deepEqual(counterpartClaims(orphan, materials), [], '没配对、也没共同来源时反方为空——不许硬凑')

  const legacy = [claim(5, '老板', '先看现金流', { source_refs: [{ type: 'research', id: 9 }] }), claim(6, '员工', '先看有没有人教', { source_refs: [{ type: 'research', id: 9 }] })]
  assert.deepEqual(counterpartClaims(resolveStance({ viewpoint_material_id: 5 }, legacy), legacy).map(item => item.angle), ['员工'], '老素材没有配对编号时按共同来源找')
})

test('反方为空不编：简报和提示词都要如实说', () => {
  const empty = buildDraftBrief({ topic: { title: '裸写' } })
  assert.equal(empty.stance, null, '没定主观点就是没定，不放一个假对象进去')
  assert.deepEqual(empty.counterparts, [])

  const filled = buildDraftBrief({
    topic: { title: '西贝关店', viewpoint_material_id: 1 },
    materials: [claim(1, '老板', '成本不在人在流程'), claim(2, '员工', '学不会是因为没人带')],
    stance: { text: '成本不在人在流程', angle: '老板', logic_state: 'conditional' },
    counterparts: [{ text: '学不会是因为没人带', angle: '员工', logic_state: 'passed' }],
  })
  assert.equal(filled.stance.text, '成本不在人在流程')
  assert.equal(filled.counterparts[0].angle, '员工')
})

test('提示词把 stance、反方和五个角色各自的用途都交代了', () => {
  const prompt = draftBriefPrompt({}, '短视频', 'trust')
  assert.match(prompt, /brief\.stance/, '不交代主观点，模型又会只按标题发挥')
  assert.match(prompt, /brief\.counterparts/, '不交代反方，「先驳后立」就只能驳一个编出来的靶子')
  assert.match(prompt, /不许凭空发明/)
  for (const role of ['QST', 'CON', 'OPI', 'CAS', 'SOL']) assert.match(prompt, new RegExp(role), `${role} 没有派用途`)
  assert.match(prompt, /logic_state 是 conditional/, '有条件成立的主张要带限定，否则范围会被写成普适')
})

const llmMock = await startSharedLlmMock()
const port = testPort(49700, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'topic-stance-')), 'data.json')
writeFileSync(dataFile, '{}')

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, ...llmMock.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 20000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

let serverPromise = null
// 一个文件一个后台进程：每个测试各起一个的话，并发跑全套时会有文件卡在启动超时上。
const sharedServer = () => { if (!serverPromise) serverPromise = startServer(); return serverPromise }
after(async () => { if (serverPromise) (await serverPromise).kill() })

const headers = owner => ({ 'x-user-id': owner, 'content-type': 'application/json' })
const post = (path, owner, body) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: headers(owner), body: JSON.stringify(body) })
const put = (path, owner, body) => fetch(`${baseUrl}${path}`, { method: 'PUT', headers: headers(owner), body: JSON.stringify(body) })
const json = async response => await response.json()

test('手动立选题：定主观点和角度，生成时简报里真有它们', async t => {
  await sharedServer()
  // 进程由文件级 after 钩子统一关闭
  const owner = 'stance-owner'

  const stanceAtom = await json(await post('/api/materials/atoms', owner, { kind: 'insight', text: '成本不在人在流程，在链路', unit_type: 'OPI', angle: '老板', claims_run: 'RUN-1' }))
  const rival = await json(await post('/api/materials/atoms', owner, { kind: 'insight', text: '学不会是因为没人带', unit_type: 'OPI', angle: '员工', claims_run: 'RUN-1' }))
  assert.ok(stanceAtom.id && rival.id)

  const created = await post('/api/topics', owner, { title: '西贝关店这件事到底亏在哪', angle: '老板', viewpoint_material_id: stanceAtom.id })
  assert.equal(created.status, 201, '必须能自己立一条选题，不能只能靠批量生成')
  const topic = await json(created)
  assert.equal(topic.angle, '老板')
  assert.equal(topic.viewpoint_material_id, stanceAtom.id)

  assert.equal((await post('/api/topics', owner, { title: '   ' })).status, 422, '空标题要拦下来')
  assert.equal((await post('/api/topics', owner, { title: '假观点', viewpoint_material_id: 98765 })).status, 422, '主观点指向不存在的素材要拦下来')

  // 用户一条素材都没勾：主观点和它的反方仍然要进简报。
  const drafts = await json(await post('/api/drafts/generate', owner, { topic_id: topic.id }))
  const brief = drafts[0].generation_context.brief
  assert.equal(brief.stance?.text, '成本不在人在流程，在链路', '选了的观点必须进简报，不能只留在选题上')
  assert.deepEqual(brief.counterparts.map(item => item.text), ['学不会是因为没人带'])
  assert.equal(brief.material_roles.OPI.length, 2, '两条主张都要进角色分组')
  assert.equal(brief.material_gap, null, '有料就不能报"在裸写"')
  assert.ok(drafts[0].source_refs.some(ref => ref.type === 'material' && ref.id === stanceAtom.id), '用没用上都要能溯源回去')

  // 换角度不改标题：另立一条，两条并存。
  const rivalTopic = await json(await post('/api/topics', owner, { title: '西贝关店这件事到底亏在哪', angle: '员工', viewpoint_material_id: rival.id }))
  assert.notEqual(rivalTopic.id, topic.id, '同一件事的另一个角度是另一条选题，不是覆盖')

  const switched = await json(await put(`/api/topics/${rivalTopic.id}/stance`, owner, { angle: '客户', viewpoint_material_id: stanceAtom.id }))
  assert.equal(switched.angle, '客户')
  assert.equal(switched.viewpoint_material_id, stanceAtom.id)
  assert.equal((await put(`/api/topics/${rivalTopic.id}/stance`, owner, { viewpoint_material_id: 55555 })).status, 422)
})

test('从热点一步立选题：热点先成素材，再当主观点', async t => {
  await sharedServer()
  // 进程由文件级 after 钩子统一关闭
  const owner = 'hotspot-topic-owner'

  const collected = await json(await post('/api/research/hot-search/collect', owner, { platform: '抖音', entries: [{ title: '西贝关闭多家门店' }] }))
  const topic = await json(await post('/api/topics', owner, { title: '西贝关店：老板算错的那笔账', research_id: collected.items[0].id, angle: '经营' }))
  assert.equal(topic.viewpoint_material_id > 0, true, '热点要自动成为这条选题的主观点')
  assert.equal(topic.angle, '经营')

  const materials = await json(await fetch(`${baseUrl}/api/materials`, { headers: headers(owner) }))
  const hotspot = materials.filter(item => item.content === '西贝关闭多家门店')
  assert.equal(hotspot.length, 1, '一步立选题不该再造出第二份热点素材')

  const brief = (await json(await post('/api/drafts/generate', owner, { topic_id: topic.id })))[0].generation_context.brief
  assert.equal(brief.stance.text, '西贝关闭多家门店')
})
