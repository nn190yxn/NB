import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { groupMaterialsByIdentity, materialChecksum, materialIdentityConflict, mergeMaterialGroup, mergeSourceRefs, normalizeMaterialText } from './material-key.mjs'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

test('归一化：空格和标点不参与身份，字和顺序才参与', () => {
  assert.equal(normalizeMaterialText(' 内容要按成交写， 不是按点赞写。'), normalizeMaterialText('内容要按成交写不是按点赞写'))
  assert.notEqual(normalizeMaterialText('内容要按成交写'), normalizeMaterialText('内容不要按成交写'))
})

test('身份只看正文：加上来源就不再相等，正是五套旧编码各算各的后果', () => {
  const text = '点赞会撒谎，询盘不会'
  assert.equal(materialChecksum(text), materialChecksum(`  ${text.replace('，', '、')}  `))
  assert.notEqual(materialChecksum(text), materialChecksum(`${text}（换个来源）`))
})

test('类型冲突只报不猜：同文既是金句又是判断时，保留用户先定的那个', () => {
  const conflicts = materialIdentityConflict({ material_kind: 'quote', unit_type: 'OPI' }, { material_kind: 'insight', unit_type: 'OPI' })
  assert.deepEqual(conflicts, [{ field: 'material_kind', current: 'quote', next: 'insight' }])
  assert.deepEqual(materialIdentityConflict({ material_kind: 'quote' }, { material_kind: 'quote' }), [])
  assert.deepEqual(materialIdentityConflict({}, { material_kind: 'quote' }), [], '原先没定的不算冲突')
})

test('来源引用合并去重，重复引用不会越堆越长', () => {
  const merged = mergeSourceRefs([{ type: 'material', id: 1 }], [{ type: 'material', id: 1 }, { type: 'research', id: '9' }])
  assert.deepEqual(merged, [{ type: 'material', id: 1 }, { type: 'research', id: '9' }])
  assert.deepEqual(mergeSourceRefs(null, undefined, [{ type: 'draft', id: '3' }]), [{ type: 'draft', id: '3' }])
  assert.deepEqual(mergeSourceRefs([{ type: 'x' }], ['字符串不是合法引用']), [{ type: 'x' }], '形状不对的引用丢掉，不塞进数组')
})

test('疑似重复分组：只剩一条时不算一组，组内按编号升序', () => {
  const groups = groupMaterialsByIdentity([
    { id: 4, content: '同一句', checksum: materialChecksum('同一句') },
    { id: 2, content: '同一句', checksum: materialChecksum('同一句') },
    { id: 7, content: '另一句', checksum: materialChecksum('另一句') },
    { id: 9 },
  ])
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].items.map(item => item.id), [2, 4])
})

test('合并保留最早那条并追加来源，其余软删且记下并进了谁', () => {
  const items = [
    { id: 3, content: '同一句', material_kind: 'insight', source_refs: [{ type: 'material', id: 1 }] },
    { id: 1, content: '同一句', material_kind: 'quote', source_refs: [{ type: 'draft', id: '8' }] },
  ]
  const result = mergeMaterialGroup(items, () => '2026-09-21T00:00:00.000Z')
  assert.equal(result.merged.id, 1, '保留最早入库的那条')
  assert.equal(result.merged.material_kind, 'quote', '第一次定的类型不被后来者覆盖')
  assert.deepEqual(result.archived, [3])
  assert.deepEqual(result.merged.source_refs, [{ type: 'draft', id: '8' }, { type: 'material', id: 1 }])
  assert.equal(items.find(item => item.id === 3).deleted_at, '2026-09-21T00:00:00.000Z')
  assert.equal(items.find(item => item.id === 3).merged_into, 1, '被并掉的要能查回去')
  assert.equal(mergeMaterialGroup([{ id: 1, content: '孤条' }]), null, '只有一条不叫合并')
})

const llmMock = await startSharedLlmMock()
const port = testPort(49300, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'material-identity-')), 'data.json')
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
const patch = (path, owner, body) => fetch(`${baseUrl}${path}`, { method: 'PATCH', headers: headers(owner), body: JSON.stringify(body) })
const get = async (path, owner) => (await fetch(`${baseUrl}${path}`, { headers: headers(owner) })).json()

test('同一句话走四个门，只落一条，来源引用一条条追加', async t => {
  await sharedServer()
  // 进程由文件级 after 钩子统一关闭
  const owner = 'identity-owner'
  const text = '老板不赚钱，通常不是一个点坏了，而是赚钱链路断了'

  const atom = await (await post('/api/materials/atoms', owner, { kind: 'insight', text })).json()
  assert.equal(atom.duplicate, undefined)
  assert.equal(atom.checksum, materialChecksum(text), '身份就是归一化正文的哈希')

  // 换标点、加空格：还是同一句。
  const variant = `  ${text.replace('，', '、').replace('断了', '断了。')} `
  const again = await post('/api/materials/atoms', owner, { kind: 'insight', text: variant })
  assert.equal(again.status, 200)
  const reAtom = await again.json()
  assert.equal(reAtom.duplicate, true)
  assert.equal(reAtom.id, atom.id)
  assert.equal(reAtom.identity_conflicts, undefined, '同一句两次都定为 insight，不该报冲突')

  // 上传路径：文件级哈希另存，身份仍然只看正文。
  // 同一句话被当成「金句」再传一次：算同一条，但要把类型冲突报出来让人定一个。
  const up = await (await post('/api/materials/upload', owner, { name: '随手记.md', content: variant, material_kind: 'quote' })).json()
  assert.equal(up.duplicate, true, '上传同文不该造出第二条')
  assert.equal(up.id, atom.id)
  assert.deepEqual((up.identity_conflicts || []).map(item => item.field), ['material_kind'], '金句和判断撞上了要报出来，不能闷着（两者的认知角色都是主张，所以只有类型冲突）')
  assert.equal(up.material_kind, 'insight', '类型不自动改判，保留用户先定的')
  assert.ok((up.source_refs || []).some(ref => ref.type === 'material' && /^[0-9a-f]{64}$/.test(String(ref.id))), '文件级哈希并进来源引用，审计要能查回是哪份文件')
  assert.ok(up.source_refs.length > reAtom.source_refs.length, '每从哪个门进来一次就多一条来源引用')

  // 研究转素材：以前这条路干脆没有身份字段。
  const collected = await (await post('/api/research/hot-search/collect', owner, { platform: '小红书', entries: [{ title: variant }] })).json()
  const asMaterial = await (await post(`/api/research/${collected.items[0].id}/collect`, owner, {})).json()
  assert.equal(asMaterial.duplicate, true, '同一句话从热点转进来也只算一条')
  assert.equal(asMaterial.id, atom.id)

  // 回流：草稿追问的答案也是同一句。
  const drafts = await (await post('/api/drafts/generate', owner, { topic: { title: '老板不赚钱是链路断了', strategy_layer: 'trust', goal_refs: [] } })).json()
  const followup = await (await post(`/api/drafts/${drafts[0].id}/followups`, owner, { code: 'vague_case', label: '案例含糊', answer: text })).json()
  assert.equal(followup.duplicate, true)
  assert.equal(followup.id, atom.id)

  const library = await get('/api/materials', owner)
  const hits = library.filter(item => materialChecksum(item.content) === atom.checksum)
  assert.equal(hits.length, 1, '四个门跑完，库里只有一条')
  assert.ok(hits[0].source_refs.length >= 3, `来源要一条条累积起来，实际 ${JSON.stringify(hits[0].source_refs)}`)
})

test('同一条热点二次搜索再转素材，只算一条（编号不重铸，已收录标记保住）', async t => {
  await sharedServer()
  // 进程由文件级 after 钩子统一关闭
  const owner = 'research-churn-owner'

  const first = await (await post('/api/research/hot-search/collect', owner, { platform: '抖音', entries: [{ title: '西贝关了很多店' }] })).json()
  const entry = first.items[0]
  const material = await (await post(`/api/research/${entry.id}/collect`, owner, {})).json()
  assert.equal(material.duplicate, false, '第一次转素材要说清"这不是重复"，别用缺字段表示')

  const second = await (await post('/api/research/hot-search/collect', owner, { platform: '抖音', entries: [{ title: '西贝关了很多店' }] })).json()
  const again = second.items[0]
  assert.equal(again.id, entry.id, '同标题必须复用原记录：换编号会把「已收录」标记冲掉')
  assert.equal(again.collected, true, '重新收录不该让人以为这条还没转过素材')

  const reCollect = await (await post(`/api/research/${again.id}/collect`, owner, {})).json()
  assert.equal(reCollect.duplicate, true)
  const library = await get('/api/materials', owner)
  assert.equal(library.filter(item => item.content === '西贝关了很多店').length, 1, '同一个热点转两次只有一份素材')
})

test('编辑正文撞上别的一条要拦下来，说清撞了谁；不撞就改得动', async t => {
  await sharedServer()
  // 进程由文件级 after 钩子统一关闭
  const owner = 'patch-owner'

  const a = await (await post('/api/materials/atoms', owner, { kind: 'insight', text: '说重话可以，但要说准' })).json()
  const b = await (await post('/api/materials/atoms', owner, { kind: 'insight', text: '站在老板这边拆真相' })).json()

  const clash = await patch(`/api/materials/${b.id}`, owner, { content: '说重话可以 但要说准。' })
  assert.equal(clash.status, 409, '改成正文和别的一条相同，等于手动造重复，必须拦')
  const clashBody = await clash.json()
  assert.match(clashBody.error, /已经在了/)
  assert.equal(clashBody.duplicate_id, a.id, '要说出撞了哪一条，不能只说不行')

  const kept = (await get('/api/materials', owner)).find(item => item.id === b.id)
  assert.equal(kept.content, '站在老板这边拆真相', '被拦下来时原文一个字都不该动')

  const edited = await (await patch(`/api/materials/${b.id}`, owner, { content: '站在老板这边拆真相，不站上位教训人' })).json()
  assert.equal(edited.checksum, materialChecksum('站在老板这边拆真相，不站上位教训人'), '正文一改，身份跟着重算')
  assert.equal(edited.name, '站在老板这边拆真相，不站上位教训人', '没另给名字时用新正文')

  const refiled = await (await patch(`/api/materials/${b.id}`, owner, { unit_type: 'CAS', material_kind: 'experience' })).json()
  assert.equal(refiled.unit_type, 'CAS', '认知角色本来就该能改：录入那一刻定死是错的')
  assert.equal(refiled.material_kind, 'experience')

  const invalid = await (await patch(`/api/materials/${b.id}`, owner, { unit_type: 'XXX' })).json()
  assert.match(invalid.error, /认知角色/, '改角色也要挡非法值')

  // 角度与角色都要能改：录入那一刻定死是错的，导入器也说过「没角色的 insight 进去就是死料」。
  const anglePatched = await (await patch(`/api/materials/${b.id}`, owner, { angle: ' 客户 ', unit_type: 'OPI' })).json()
  assert.equal(anglePatched.angle, '客户', '角度要去掉首尾空格再存')
  assert.equal(anglePatched.unit_type, 'OPI')
  const cleared = await (await patch(`/api/materials/${b.id}`, owner, { angle: '', unit_type: null })).json()
  assert.equal(cleared.angle, null, '角度要能清空')
  assert.equal(cleared.unit_type, null, '角色可以退回「按类型自动」')
})

test('疑似重复分组只数活着的、只数自己的', async t => {
  await sharedServer()
  // 进程由文件级 after 钩子统一关闭
  const owner = 'dup-owner'
  const other = 'dup-other'
  const text = '你不是缺流量，是接不住流量'

  await post('/api/materials/atoms', owner, { kind: 'insight', text })
  await post('/api/materials/atoms', owner, { kind: 'quote', text })
  await post('/api/materials/atoms', other, { kind: 'insight', text })
  await post('/api/materials/atoms', owner, { kind: 'insight', text: '另一句完全不相干的话' })

  const mine = await get('/api/materials/duplicates', owner)
  assert.equal(mine.groups.length, 0, '同文进来时就并掉了，正常路径不该还剩重复组')
  assert.equal(mine.redundant_count, 0)

  const theirs = await get('/api/materials/duplicates', other)
  assert.equal(theirs.groups.length, 0)
  const library = await get('/api/materials', other)
  assert.equal(library.filter(item => item.content === text).length, 1)
  assert.equal(library.some(item => item.content === '另一句完全不相干的话'), false, '别人的素材不能出现在我的库里')
})

test('清理脚本：预览不动数据，加 --apply 才合并，且一定先备份', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dedupe-script-'))
  const file = join(dir, 'data.json')
  const rows = [
    { id: 1, owner_id: 'a', content: '说重话可以，但要说准', material_kind: 'insight', unit_type: 'OPI' },
    { id: 2, owner_id: 'a', content: '说重话可以 但要说准。', material_kind: 'quote', unit_type: 'OPI' },
    { id: 3, owner_id: 'a', content: '另一句无关的话', material_kind: 'insight', unit_type: 'OPI' },
  ]
  writeFileSync(file, JSON.stringify({ materials: rows }))
  const run = (...extra) => new Promise(resolve => {
    const child = spawn(process.execPath, ['scripts/dedupe-materials.mjs', `--data=${file}`, ...extra], { cwd: process.cwd() })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    child.once('exit', code => resolve({ code, output }))
  })

  const preview = await run()
  assert.equal(preview.code, 0)
  assert.match(preview.output, /预览/)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).materials.filter(item => !item.deleted_at).length, 3, '预览阶段一条都不许动')

  const applied = await run('--apply')
  assert.equal(applied.code, 0)
  assert.match(applied.output, /保留 #1/)
  assert.match(applied.output, /归档 #2/)
  const after = JSON.parse(readFileSync(file, 'utf8')).materials
  assert.equal(after.filter(item => !item.deleted_at).length, 2, '同文的只剩一条')
  assert.equal(after.find(item => item.id === 2).merged_into, 1, '被并掉的要能查回去')
  assert.equal(after.find(item => item.id === 1).material_kind, 'insight', '保留最早那条，类型不被后来者覆盖')
  assert.ok(readdirSync(join(process.cwd(), 'backups')).some(name => name.startsWith('data-before-dedupe-')), '合并前必须留一份备份')

  const again = await run('--apply')
  assert.match(again.output, /没有同文素材/, '可重入：再跑一次不该报"又合并了一批"')
})
