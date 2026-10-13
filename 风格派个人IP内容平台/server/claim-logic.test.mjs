import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { angleSuggestions, claimLogicPrompt, claimLogicVariables, logicStateOf, normalizeAngles, parseClaimLogicVerdict, claimsAngleNote, parseClaimsOutput } from './claim-logic.mjs'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

test('角度：只取一对，去重去空，词表只是建议不是枚举', () => {
  assert.deepEqual(normalizeAngles(['老板', '员工']), ['老板', '员工'])
  assert.deepEqual(normalizeAngles(['老板', ' 老板 ', '', null, '员工', '客户']), ['老板', '员工'], '一次只跑一对')
  assert.deepEqual(normalizeAngles('市场'), ['市场'])
  assert.deepEqual(normalizeAngles(undefined), [])
  assert.ok(angleSuggestions.includes('老板') && angleSuggestions.includes('市场'))
  assert.match(claimsAngleNote(['老板', '员工']), /只从「老板」这个角度/, '一对角度也是一次只问一个角度，第二个单独问')
  assert.match(claimsAngleNote(['老板']), /只从「老板」这个角度/)
  assert.match(claimsAngleNote(['员工'], ['成本不在人在流程']), /已经有人说过了/, '第二个角度要看得见「第一个角度已经说过什么」')
  assert.match(claimsAngleNote(['员工'], ['成本不在人在流程']), /「成本不在人在流程」/, '已说过的原话要真的列进提示词')
  assert.match(claimsAngleNote(['员工'], ['成本不在人在流程']), /同义改写.*给空数组/s, '换个词复述不算新立场；提不出不同说法就明说没有')
  assert.equal(claimsAngleNote([]), '', '没给角度就不加这段，别让提示词空喊')
})

test('主张解析：角度认不出就落回主角度，重复条目丢掉，字符串老形状仍能吃', () => {
  const items = parseClaimsOutput(JSON.stringify({ claims: [
    { text: '老板看的是现金流', angle: '老板' },
    { text: '员工看的是能不能学会', angle: '员工' },
    { text: '瞎编的角度', angle: '外星人' },
    { text: '老板看的是现金流', angle: '老板' },
    '老形状的一条主张',
  ] }), ['老板', '员工'])
  assert.deepEqual(items.map(item => item.angle), ['老板', '员工', '老板', '老板'])
  assert.equal(items.length, 4, '同文重复的那条要丢掉')
  assert.deepEqual(parseClaimsOutput(JSON.stringify({ claims: [] }), ['老板']), [])
})

test('逻辑判定：中文档位和 ```json 围栏都要认，认不出档就报错', () => {
  assert.equal(parseClaimLogicVerdict('```json ' + JSON.stringify({ status: '有条件成立', note: '有边界' }) + ' ```').status, 'conditional', '真模型会把 JSON 包进围栏、档位写成中文')
  assert.equal(parseClaimLogicVerdict(JSON.stringify({ status: '不成立', breakpoint: '少了一步' })).status, 'failed')

  assert.deepEqual(parseClaimLogicVerdict(JSON.stringify({ status: 'passed', breakpoint: '', note: '依据撑得住' })), { status: 'passed', breakpoint: '', note: '依据撑得住' })
  assert.throws(() => parseClaimLogicVerdict(JSON.stringify({ status: '大体可以', note: '含糊' })), /只认 passed/)
  assert.throws(() => parseClaimLogicVerdict(JSON.stringify({ status: '' })), /只认 passed/, '空档不是"成立"')
  assert.throws(() => parseClaimLogicVerdict('[]'), /不是对象/)
  assert.throws(() => parseClaimLogicVerdict('不是 JSON'), /JSON/)
})

test('判定绑在正文上：正文一改，旧结论退回「判定作废」而不是继续冒充查过', () => {
  assert.equal(logicStateOf({}), 'unchecked')
  assert.equal(logicStateOf({ logic_status: 'passed', checksum: 'A', logic_source_checksum: 'A' }), 'passed')
  assert.equal(logicStateOf({ logic_status: 'passed', checksum: 'B', logic_source_checksum: 'A' }), 'stale')
  assert.equal(logicStateOf({ logic_status: '胡说', checksum: 'A', logic_source_checksum: 'A' }), 'unchecked')
})

test('判定提示词不做文笔检查，也不许编指不到原文的断点', () => {
  assert.match(claimLogicPrompt, /不检查文笔/)
  assert.match(claimLogicPrompt, /指不到原文的断点不要编/)
  assert.deepEqual(claimLogicVariables({ text: '这条只对老板成立', scope: '老板', why: '' }), { claim: '这条只对老板成立', declared_scope: '老板', declared_reason: '' })
  assert.equal(claimLogicVariables({ text: 'x'.repeat(3000) }).claim.length, 2000, '喂给模型的主张要截断，不能整篇塞过去')
})

const llmMock = await startSharedLlmMock()
const port = testPort(49500, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'claim-logic-')), 'data.json')
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
const list = async owner => (await (await fetch(`${baseUrl}/api/materials`, { headers: headers(owner) })).json())

test('查逻辑：结果落到素材上，改正文后自动作废，不成立的照样还在库里可用', async t => {
  await sharedServer()
  // 进程由文件级 after 钩子统一关闭
  const owner = 'logic-owner'

  const claim = await (await post('/api/materials/atoms', owner, { kind: 'insight', text: '这条只对老板成立，因为老板付钱', unit_type: 'OPI', angle: '老板' })).json()
  assert.equal(claim.logic_status, 'unchecked', '刚入库是「没查」，不是「查过没问题」')

  const checked = await (await post('/api/skills/claims/check', owner, { material_id: claim.id })).json()
  assert.equal(checked.status, 'conditional')
  assert.equal(checked.material.logic_status, 'conditional')
  assert.equal(checked.logic_state, 'conditional')
  assert.ok(checked.material.logic_source_checksum, '判定要绑住当时那份正文')

  const row = (await list(owner)).find(item => item.id === claim.id)
  assert.equal(row.logic_state, 'conditional', '列表读出来就得带判定状态，界面不用自己猜')

  // 正文一改，旧判定立刻作废。
  await fetch(`${baseUrl}/api/materials/${claim.id}`, { method: 'PATCH', headers: headers(owner), body: JSON.stringify({ content: '这条只对老板成立，因为老板付钱，员工也帮忙口碑' }) })
  const after = (await list(owner)).find(item => item.id === claim.id)
  assert.equal(after.logic_state, 'stale', '改了正文还说"有条件成立"就是骗人')

  const rechecked = await (await post('/api/skills/claims/check', owner, { material_id: claim.id })).json()
  assert.equal(rechecked.status, 'conditional', '重查覆盖旧结论，不留两条判定')

  // 判成不成立也不拦：用户要能照样把它选去写稿（他的原话：逻辑不通但利观点还能用）。
  const kept = (await list(owner)).find(item => item.id === claim.id)
  assert.ok(kept, '判过的素材仍留在库里，没被判定动过')
  assert.equal(kept.deleted_at, undefined)

  const failed = await (await post('/api/skills/claims/check', owner, { text: '先给判断再给动作，这条站不住' })).json()
  assert.equal(failed.status, 'failed', 'mock 把带「站不住」的主张判成反例')
  assert.equal(failed.material, undefined, '没给 material_id 就只出结论，不擅自写库')
})

test('交白卷后的逼问：要说清「先想这个立场在乎什么」，且不许复述别人的话', () => {
  const first = claimsAngleNote(['员工'], ['门店扩张时没人算过单店账'])
  const second = claimsAngleNote(['员工'], ['门店扩张时没人算过单店账'], true)
  assert.equal(second.includes('上一次这个角度什么也没提'), true, '第二轮要让人看出这是重来一次')
  assert.match(second, /在乎的是什么、最怕失去什么/)
  assert.match(second, /才给空数组/, '实在提不出不同说法仍然允许空着，不许硬编')
  assert.equal(first.includes('上一次这个角度什么也没提'), false, '第一轮不该带逼问')
  assert.equal(claimsAngleNote(['员工'], [], true), claimsAngleNote(['员工'], [], false), '前面还没人说话时没得可逼')
})
