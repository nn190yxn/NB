// 所有者隔离：A 造的数据，B 一条都不该读到。
//
// 由来（2026-09-19 审计 25.4）：那一轮用「切出路由块 + 块内搜 owner 过滤关键词」的办法逐条看了 24 条草稿路由，
// 没发现越权读取——但审计自己写了三条限制：判定靠关键词、只覆盖 state.* 的直接访问、只看了一个文件。
// **结论是启发式的，不是证明。** 它当时给的下一步是「在数据访问层统一收口」。
//
// 这一步先做能真出货的那半：**不看代码怎么写，直接把两个账号跑起来，用 B 的身份去读一遍**。
// 关键词在不在只是线索；「B 到底读没读到 A 的东西」才是结论。
//
// 覆盖面（自动枚举，不手抄）：`server/index.mjs` 里所有 GET 路由——既包括 `url.pathname === '...'`
// 这种直写的，也包括 `url.pathname.match(/.../)` 这种带参数的。**新加一条 GET 路由会自动进这张表**，
// 所以「以后新路由忘了过滤」会在这里红，而不是等下一次人工审计。
//
// 每条路由的判定方式（不空过，靠构造保证）：
//   1. 先以 A 的身份请求一遍：拿不到 A 的数据，说明这条路由本来就不带用户数据（或种子没生效）。
//      整体要求至少 N 条真的拿到了 A 的数据，否则这套判定等于空转。
//   2. 再以 B 的身份请求同一条路由：**任何 A 的标记都不许出现**。
//   3. 路径里带了 A 的资源 id 的（详情类）：A 拿到 200，B 就必须不是 200。
//
// 已知边界（别拿它当安全证明）：只管读（GET）；只覆盖种子造得出的资源族，其余族在
// SKIPPED_FAMILIES 里逐条登记原因，新增一族会红；写路径的越权由各条路由自己的测试管。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

const llmMock = await startSharedLlmMock()
const port = testPort(47000, 1000)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'owner-isolation-test-')), 'data.json')
writeFileSync(dataFile, '{}')

// 两个账号各自的标记：只认这串字符，不拿 id 数字去比（1 会出现在页码、计数里，会假红）。
const OWNER = { id: 'isolation-owner', mark: 'ISO-OWNER-SENTINEL' }
const OTHER = { id: 'isolation-other', mark: 'ISO-OTHER-SENTINEL' }

// 没在本测试里造数据、因此跳过的资源族：写清为什么。
// 多出一族就会红——要么给它造种子，要么在这里说明为什么不用查。
const SKIPPED_FAMILIES = {
  'private-files': '要真上传文件才有得读，本测试不造',
  'performance-snapshots': '种子要造发布表现，本测试不造',
  'vision-tasks': '种子要跑截图识别，本测试不造',
  feedback: '反馈是管理员视角，本测试不造',
  shooting: '种子要排拍摄计划，本测试不造',
  sync: '同步对象要两台设备握手，本测试不造',
  'api-settings': '设置项按 slot 读，本测试不造',
  positioning: '定位候选要真模型生成，本测试不造',
  profile: '档案审核项要真审核流程，本测试不造',
}

// 这几条列表路由必须双向都看得见：B 看得见 B 的、看不见 A 的。
// 它们也是「防整套测试空过」的探针——路由坏了、种子没生效，这里会先红。
const LIST_ROUTES_WITH_BOTH = ['/api/drafts', '/api/materials', '/api/memories', '/api/structures', '/api/topics']
const ANTI_EMPTY_MIN_ROUTES = 4

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...llmMock.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

const headersFor = owner => ({ 'x-user-id': owner.id, 'content-type': 'application/json' })

async function post(owner, path, body) {
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: headersFor(owner), body: JSON.stringify(body) })
  const text = await response.text()
  return { status: response.status, text, json: text ? JSON.parse(text) : undefined }
}

// 正则文本 → 人看得懂的路径模式：去掉正则的转义和首尾锚点。
// `/^\/api\/drafts\/(\d+)$/` → `/api/drafts/(\d+)`
function normalizePattern(pattern) {
  return pattern.replace(/\\/g, '').replace(/^\//, '').replace(/\/$/, '').replace(/^\^/, '').replace(/\$$/, '')
}

function familyOf(path) {
  const match = path.match(/^\/api\/([^/]+)/)
  return match ? match[1] : ''
}

// 把路径模式变成一条真路径：带参数的段换成传入的 id，`(preview|download)` 这种取第一个。
function patternToUrl(pattern, id) {
  return normalizePattern(pattern)
    .replace(/\((?:\?:)?[^()]*\|[^()]*\)/g, group => group.slice(1, -1).split('|')[0])
    .replace(/\((?:\?:)?[^()]*\)/g, String(id))
}

// 从源码枚举 GET 路由。直写的看 `url.pathname === '...'`；带参数的看 `const X = url.pathname.match(/.../)`
// 加后面几行内的 `X && request.method === 'GET'`。
function enumerateGetRoutes(source = readFileSync('server/index.mjs', 'utf8')) {
  const lines = source.split('\n')
  const routes = []
  lines.forEach(line => {
    const direct = line.match(/url\.pathname === '([^']+)'/)
    if (direct && /request\.method === 'GET'/.test(line)) routes.push({ path: direct[1], family: familyOf(direct[1]), dynamic: false })
  })
  lines.forEach((line, index) => {
    const match = line.match(/const (\w+) = url\.pathname\.match\((\/\^.*?\/[a-z]*)\)/)
    if (!match) return
    const window = lines.slice(index, index + 4).join('\n')
    if (!new RegExp(`${match[1]} && request\\.method === 'GET'`).test(window)) return
    const path = normalizePattern(match[2])
    routes.push({ path, pattern: match[2], family: familyOf(path), dynamic: true })
  })
  return routes
}

// 给每个账号造一份自己的数据，并把 id 记下来给带参数的 GET 路由拼 URL 用。
// 造不出来就直接红：整套判定的前提就是「A 手里真的有数据」。
async function seed(owner) {
  const draft = await post(owner, '/api/drafts/generate', { topic: { title: `${owner.mark}-draft`, strategy_layer: 'trust', goal_refs: [] } })
  assert.ok([200, 201].includes(draft.status), `造草稿失败（${owner.id}）：${draft.status} ${draft.text.slice(0, 200)}`)
  const topic = await post(owner, '/api/topics/generate', {})
  assert.ok([200, 201].includes(topic.status), `造选题失败（${owner.id}）：${topic.status} ${topic.text.slice(0, 200)}`)
  const material = await post(owner, '/api/materials/atoms', { kind: 'quote', text: `${owner.mark}-material`, name: `${owner.mark}-material` })
  assert.ok([200, 201].includes(material.status), `造素材失败（${owner.id}）：${material.status} ${material.text.slice(0, 200)}`)
  const memory = await post(owner, '/api/memories', { memory_type: 'style', content: `${owner.mark}-memory` })
  assert.ok([200, 201].includes(memory.status), `造记忆失败（${owner.id}）：${memory.status} ${memory.text.slice(0, 200)}`)
  const structure = await post(owner, '/api/structures', { title: `${owner.mark}-structure`, steps: ['开场：一句话点题', '正文：给一个例子'] })
  assert.ok([200, 201].includes(structure.status), `造方法失败（${owner.id}）：${structure.status} ${structure.text.slice(0, 200)}`)
  return {
    ids: { drafts: draft.json[0]?.id, topics: topic.json[0]?.id, materials: material.json?.id, memories: memory.json?.id, structures: structure.json?.id },
    mark: owner.mark,
  }
}

test('别人的数据读不到：GET 路由逐条过一遍（跨账号）', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const mine = await seed(OWNER)
  const theirs = await seed(OTHER)
  assert.ok(mine.ids.drafts && mine.ids.materials && mine.ids.memories && mine.ids.structures, `种子 id 缺失：${JSON.stringify(mine.ids)}`)

  const routes = enumerateGetRoutes()
  assert.ok(routes.length >= 30, `只认出 ${routes.length} 条 GET 路由，枚举规则可能失效了（漏认 = 假绿）`)

  const skipped = new Set()
  const leaked = []
  let routesWithOwnerData = 0

  for (const route of routes) {
    const id = mine.ids[route.family]
    if (route.dynamic && !id) { skipped.add(route.family); continue }
    const target = route.dynamic ? patternToUrl(route.pattern, id) : route.path

    const asOwner = await fetch(`${baseUrl}${target}`, { headers: headersFor(OWNER) })
    const ownerText = await asOwner.text()
    const asOther = await fetch(`${baseUrl}${target}`, { headers: headersFor(OTHER) })
    const otherText = await asOther.text()

    const ownerSaw = ownerText.includes(mine.mark)
    if (ownerSaw) routesWithOwnerData += 1
    if (otherText.includes(mine.mark)) leaked.push(`${target} → ${otherText.slice(0, 160)}`)
    if (ownerSaw && target.includes(`/${id}`) && asOwner.status === 200 && asOther.status === 200) leaked.push(`${target} 详情类：A 拿到 200，B 也拿到 200（${otherText.slice(0, 160)}）`)
  }

  assert.deepEqual(leaked, [], `B 读到了 A 的数据：\n${leaked.join('\n')}`)
  const unknown = [...skipped].filter(family => !(family in SKIPPED_FAMILIES))
  assert.deepEqual(unknown, [], `这些资源族既没覆盖也没登记原因（新增一族必须做一次决定）：${unknown.join('、')}`)
  assert.ok(routesWithOwnerData >= ANTI_EMPTY_MIN_ROUTES, `只有 ${routesWithOwnerData} 条路由真的返回了 A 的数据——种子没生效或枚举没扫到，这套判定等于空转`)
  // 把实跑的量打出来：数量突然掎水，说明有路由不干活了（这里比断言先看到）。
  console.log(JSON.stringify({ event: 'owner_isolation_summary', getRoutes: routes.length, routesWithOwnerData, skippedFamilies: [...skipped].sort() }))

  // 双向探针：B 自己的东西必须看得见（否则「B 什么都读不到」也可能只是接口全坏了）。
  // 用 id 而不是 mark 来判：模型是 mock 的，返回的选题标题里没有我塞的标记，拿 mark 判会假红。
  for (const list of LIST_ROUTES_WITH_BOTH) {
    const family = familyOf(list)
    const response = await fetch(`${baseUrl}${list}`, { headers: headersFor(OTHER) })
    const text = await response.text()
    assert.ok(text.includes(`"id":${theirs.ids[family]}`), `${list} 没返回 B 自己的数据（${response.status}）：${text.slice(0, 160)}`)
    assert.ok(!text.includes(`"id":${mine.ids[family]}`), `${list} 把 A 的数据混进了 B 的列表：${text.slice(0, 160)}`)
    assert.ok(!text.includes(mine.mark), `${list} 把 A 的数据混进了 B 的列表：${text.slice(0, 160)}`)
  }
})

test('路由枚举规则本身要认得出现有路由（防止规则退化后假绿）', () => {
  const routes = enumerateGetRoutes()
  const paths = routes.map(route => route.path)
  assert.ok(paths.includes('/api/drafts'), '认不出 /api/drafts')
  assert.ok(paths.includes('/api/drafts/(\d+)'), `认不出带参数的草稿详情路由：${paths.filter(path => path.includes('drafts')).join('、')}`)
  assert.ok(paths.includes('/api/drafts/(\d+)/history'), '认不出草稿历史路由')
  const direct = routes.filter(route => !route.dynamic).length
  const dynamic = routes.length - direct
  // 带参数的 GET 路由现在就 4 条（草稿详情/草稿历史/私密文件预览/截图任务）。
  // 这个数字变少就是枚举规则退化了——比它变多更可怕，因为变少会变成「查过的变少了」的假绿。
  assert.ok(direct >= 25, `直写路由只认出 ${direct} 条，规则可能退化了`)
  assert.ok(dynamic >= 4, `带参数路由只认出 ${dynamic} 条，规则可能退化了`)
})
