// 所有者隔离：A 造的数据，B 既不该读到，也不该改得动。
//
// 由来（2026-09-19 审计 25.4）：那一轮用「切出路由块 + 块内搜 owner 过滤关键词」的办法逐条看了 24 条草稿路由，
// 没发现越权读取——但审计自己写了三条限制：判定靠关键词、只覆盖 state.* 的直接访问、只看了一个文件。
// **结论是启发式的，不是证明。** 它当时给的下一步是「在数据访问层统一收口」。
//
// 这里先做能真出货的那半：**不看代码怎么写，直接把两个账号跑起来，用 B 的身份去读、去改**。
// 关键词在不在只是线索；「B 到底碰没碰到 A 的东西」才是结论。
//
// 覆盖面（自动枚举，不手抄）：`server/index.mjs` 里的 GET 路由（直写的 + 带参数的），以及带参数写路由
// （POST/PUT/PATCH/DELETE）。**新加一条路由会自动进这张表**，所以「以后新路由忘了过滤」会在这里红，
// 而不是等下一次人工审计。
//
// 判定方式（不空过，靠构造保证）：
//   读：1) 先以 A 的身份请求一遍——拿不到 A 的数据，说明这条路由本来就不带用户数据（或种子没生效），
//          整体要求至少 N 条真的拿到了 A 的数据，否则这套判定等于空转；
//       2) 再以 B 的身份请求同一条：**任何 A 的标记都不许出现**；
//       3) 路径里带了 A 的真 id 的（详情类）：A 拿到 200，B 就必须不是 200。
//   写：用 B 的身份对 A 的资源发写请求（带 A 的真 id），**不许被接受**（必须 ≥400），
//       且**拒绝的文案里不许出现 A 的标记**（2026-09-20 补：拒绝也分干净不干净，报错里带出别人的数据一样是泄），
//       并且事后以 A 的身份重新读一遍，**A 的数据必须一字不差**。
//   间接引用：A 的 id 不在 URL 里、而在请求体里（拿 A 的 id 去拼自己的东西）：要么被拒，
//       要么被忽略（「接受但忽略」不算问题，形式判断就是这种），**不能被用上**——B 的回复里不许出现 A 的标记，
//       事后 A 的数据也不许变。
//
// 已知边界（别拿它当安全证明）：数不完的那几条都写着底——
//   不带 id 的写路由（只写自己名下的）不在写判定里；写判定里还有 6 族没造种子（逐族登记了原因）；
//   请求体里的 id 只覆盖源码里能枚举到的那几处（INDIRECT_REFERENCES）；
//   真正的「结构性不可能发生」（数据访问层统一收口）仍未做。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

const llmMock = await startSharedLlmMock()
const PORT = testPort(47000, 1000)

// 两个账号各自的标记：只认这串字符，不拿 id 数字去比（1 会出现在页码、计数里，会假红）。
const OWNER = { id: 'isolation-owner', mark: 'ISO-OWNER-SENTINEL' }
const OTHER = { id: 'isolation-other', mark: 'ISO-OTHER-SENTINEL' }

// 没在本测试里造数据、因此跳过的资源族：写清为什么。
// 多出一族就会红——要么给它造种子，要么在这里说明为什么不用查。
const SKIPPED_FAMILIES = {
  'private-files': '要真上传文件才有得读，本测试不造',
  'vision-tasks': '种子要跑截图识别，本测试不造',
  feedback: '反馈是管理员视角，本测试不造',
  shooting: '拍摄项只能由草稿定稿流程产生，本测试不跑那条链路',
  sync: '同步冲突要两台设备真的撞到一起，本测试不造',
  positioning: '定位候选要真模型生成，本测试不造',
  research: '研究项要连外部搜索，本测试不造',
  devices: '设备心跳按设备号读，本测试不造',
}

// 这几条列表路由必须双向都看得见：B 看得见 B 的、看不见 A 的。
// 它们也是「防整套测试空过」的探针——路由坏了、种子没生效，这里会先红。
// 能进来的前提：响应里带自己那一行的 id。设置项（api-settings）按 slot 读、没有 id 字段，所以只能进指纹比对。
const LIST_ROUTES_WITH_BOTH = ['/api/drafts', '/api/materials', '/api/memories', '/api/structures', '/api/topics', '/api/performance-snapshots', '/api/sync-directories', '/api/profile/reviews', '/api/preferences']
// 「B 改没改动 A 的东西」要比对的路由：除了上面那张表，另加没有 id 字段、但历史上就是因「忘了过滤」翻过车的设置项。
const FINGERPRINT_EXTRA = ['/api/api-settings']
const ANTI_EMPTY_MIN_ROUTES = 10

function freshDataFile(tag) {
  const file = join(mkdtempSync(join(tmpdir(), `owner-isolation-${tag}-`)), 'data.json')
  writeFileSync(file, '{}')
  return file
}

function startServer(port, dataFile) {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...llmMock.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

const headersFor = owner => ({ 'x-user-id': owner.id, 'content-type': 'application/json' })

// 以指定身份读一条路由（跨账号判定靠对比两边拿到的字符串）。
async function getAs(owner, path, base) {
  const response = await fetch(`${base}${path}`, { headers: headersFor(owner) })
  return { status: response.status, text: await response.text() }
}

async function post(owner, path, body, base, method = 'POST') {
  const response = await fetch(`${base}${path}`, { method, headers: headersFor(owner), body: JSON.stringify(body) })
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

// 源码里带参数的路由都是 `const X = url.pathname.match(/.../)`，方法判定跟在后面几行。
function enumeratePatternRoutes(methods, source = readFileSync('server/index.mjs', 'utf8')) {
  const lines = source.split('\n')
  const routes = []
  lines.forEach((line, index) => {
    const match = line.match(/const (\w+) = url\.pathname\.match\((\/\^.*?\/[a-z]*)\)/)
    if (!match) return
    const window = lines.slice(index, index + 4).join('\n')
    const guard = window.match(new RegExp(`${match[1]} && request\\.method === '(${methods})'`))
    if (!guard) return
    const path = normalizePattern(match[2])
    routes.push({ path, pattern: match[2], family: familyOf(path), method: guard[1] })
  })
  return routes
}

function enumerateGetRoutes(source) {
  const lines = (source || readFileSync('server/index.mjs', 'utf8')).split('\n')
  const direct = []
  lines.forEach(line => {
    const match = line.match(/url\.pathname === '([^']+)'/)
    if (match && /request\.method === 'GET'/.test(line)) direct.push({ path: match[1], family: familyOf(match[1]), dynamic: false })
  })
  return direct.concat(enumeratePatternRoutes('GET', source).map(route => ({ ...route, dynamic: true })))
}

// 给每个账号造一份自己的数据，并把 id 记下来给带参数的路由拼 URL 用。
// 造不出来就直接红：整套判定的前提就是「A 手里真的有数据」。
// 每多一族种子，读判定和写判定就自动多覆盖几条路由（枚举是按路由走的，不靠手抄）。
async function seed(owner, base) {
  // 档案先写：**模型生成的东西会抄档案里的字**（假模型把档案的 role 抄进选题标题），
  // 档案晚写一步，那些行就不带标记，针对它们的间接引用判定就永远看不见漏出来的内容。
  const profile = await post(owner, '/api/profile', { role: `${owner.mark}-role`, audiences: [`${owner.mark}-audience`] }, base, 'PUT')
  assert.ok(profile.status === 200, `造档案失败（${owner.id}）：${profile.status} ${profile.text.slice(0, 200)}`)
  const draft = await post(owner, '/api/drafts/generate', { topic: { title: `${owner.mark}-draft`, strategy_layer: 'trust', goal_refs: [] } }, base)
  assert.ok([200, 201].includes(draft.status), `造草稿失败（${owner.id}）：${draft.status} ${draft.text.slice(0, 200)}`)
  const topic = await post(owner, '/api/topics/generate', {}, base)
  assert.ok([200, 201].includes(topic.status), `造选题失败（${owner.id}）：${topic.status} ${topic.text.slice(0, 200)}`)
  // 选题是模型产的，但里面要真有标记：没标记的种子等于没被判定盯上。
  assert.ok(JSON.stringify(topic.json).includes(owner.mark), `造出来的选题里没有标记，模型抄档案这一步变了（${owner.id}）：${topic.text.slice(0, 200)}`)
  const material = await post(owner, '/api/materials/atoms', { kind: 'quote', text: `${owner.mark}-material`, name: `${owner.mark}-material` }, base)
  assert.ok([200, 201].includes(material.status), `造素材失败（${owner.id}）：${material.status} ${material.text.slice(0, 200)}`)
  const memory = await post(owner, '/api/memories', { memory_type: 'style', content: `${owner.mark}-memory` }, base)
  assert.ok([200, 201].includes(memory.status), `造记忆失败（${owner.id}）：${memory.status} ${memory.text.slice(0, 200)}`)
  const structure = await post(owner, '/api/structures', { title: `${owner.mark}-structure`, steps: ['开场：一句话点题', '正文：给一个例子'] }, base)
  assert.ok([200, 201].includes(structure.status), `造方法失败（${owner.id}）：${structure.status} ${structure.text.slice(0, 200)}`)
  const review = await post(owner, '/api/profile/import', { content: `角色：${owner.mark}-role`, name: `${owner.mark}-档案.txt` }, base)
  assert.ok(review.status === 201, `造档案审核项失败（${owner.id}）：${review.status} ${review.text.slice(0, 200)}`)
  const snapshot = await post(owner, '/api/performance-snapshots', { draft_id: draft.json[0]?.id, platform: '抖音', metrics: { 播放量: 1000, 点赞数: 50 }, raw_model_result: { note: `${owner.mark}-snapshot` }, status: 'confirmed' }, base)
  assert.ok(snapshot.status === 201, `造发布表现失败（${owner.id}）：${snapshot.status} ${snapshot.text.slice(0, 200)}`)
  const directory = await post(owner, '/api/sync-directories', { local_path: `C:/iso-${owner.mark}`, device_id: `iso-device-${owner.id}` }, base)
  assert.ok(directory.status === 201, `造同步目录失败（${owner.id}）：${directory.status} ${directory.text.slice(0, 200)}`)
  // 设置项：显示出来的是 Base URL 和模型名，所以标记放这两个字段里。
  // 标记不能放主机名：域名过 URL 解析会被小写化，标记变成另一个字符串，读判定就永远看不见它。
  // **地址必须指向 mock**：一旦这一族有了用户自己的配置，生成就不再走环境变量里的共享 mock，
  // 而真去请求这个地址；随手写个 https://api.example.com 会让本文件里所有需要模型的路由全变 502。
  const apiSetting = await post(owner, '/api/api-settings/text_primary', { api_key: llmMock.env.PROJECT_LLM_API_KEY, base_url: llmMock.env.PROJECT_LLM_BASE_URL, model: `${owner.mark}-model`, enabled: true }, base, 'PUT')
  assert.equal(apiSetting.status, 200, `造设置项失败（${owner.id}）：${apiSetting.status} ${apiSetting.text.slice(0, 200)}`)
  // 偏好：数据回流那条路只认「同一平台、至少两条已确认、带 views 的表现数据」。
  // 没用「终稿回流」那条（要求草稿有两版可比，跑起来重多了）。平台名里带标记，偏好这一行才进得了标记判定。
  for (const views of [1000, 10]) {
    const extra = await post(owner, '/api/performance-snapshots', { draft_id: draft.json[0]?.id, platform: `${owner.mark}-抖音`, metrics: { views }, status: 'confirmed' }, base)
    assert.ok(extra.status === 201, `造同类发布表现失败（${owner.id}）：${extra.status} ${extra.text.slice(0, 200)}`)
  }
  const flow = await post(owner, '/api/preferences/data-flow', {}, base)
  assert.ok(flow.status === 200 && (flow.json?.created || []).length > 0, `造偏好失败（${owner.id}）：${flow.status} ${flow.text.slice(0, 200)}`)
  return {
    ids: {
      drafts: draft.json[0]?.id,
      topics: topic.json[0]?.id,
      materials: material.json?.id,
      memories: memory.json?.id,
      structures: structure.json?.id,
      profile: review.json?.id,
      'performance-snapshots': snapshot.json?.id,
      'sync-directories': directory.json?.id,
      // 设置项没有 id，参数就是槽位名：写判定要试的正是「B 能不能动 A 的槽位配置」。
      'api-settings': 'text_primary',
      preferences: flow.json?.created?.[0]?.id,
    },
    mark: owner.mark,
  }
}

// 一个账号名下各类数据的完整快照（用于「B 改没改动 A 的东西」）。
async function fingerprint(owner, base) {
  const parts = []
  for (const path of [...LIST_ROUTES_WITH_BOTH, ...FINGERPRINT_EXTRA]) parts.push((await getAs(owner, path, base)).text)
  return parts.join('\n')
}

function assertCoverageDecided(skipped) {
  const unknown = [...skipped].filter(family => !(family in SKIPPED_FAMILIES))
  assert.deepEqual(unknown, [], `这些资源族既没覆盖也没登记原因（新增一族必须做一次决定）：${unknown.join('、')}`)
}

test('别人的数据读不到：GET 路由逐条过一遍（跨账号）', async t => {
  const base = `http://127.0.0.1:${PORT}`
  const server = await startServer(PORT, freshDataFile('read'))
  t.after(() => server.kill())
  const mine = await seed(OWNER, base)
  const theirs = await seed(OTHER, base)
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

    const asOwner = await getAs(OWNER, target, base)
    const asOther = await getAs(OTHER, target, base)
    const ownerSaw = asOwner.text.includes(mine.mark)
    if (ownerSaw) routesWithOwnerData += 1
    if (asOther.text.includes(mine.mark)) leaked.push(`${target} → ${asOther.text.slice(0, 160)}`)
    if (ownerSaw && target.includes(`/${id}`) && asOwner.status === 200 && asOther.status === 200) leaked.push(`${target} 详情类：A 拿到 200，B 也拿到 200（${asOther.text.slice(0, 160)}）`)
  }

  assert.deepEqual(leaked, [], `B 读到了 A 的数据：\n${leaked.join('\n')}`)
  assertCoverageDecided(skipped)
  assert.ok(routesWithOwnerData >= ANTI_EMPTY_MIN_ROUTES, `只有 ${routesWithOwnerData} 条路由真的返回了 A 的数据——种子没生效或枚举没扫到，这套判定等于空转`)
  // 把实跑的量打出来：数量突然缩水，说明有路由不干活了（这里比断言先看到）。
  console.log(JSON.stringify({ event: 'owner_isolation_read', getRoutes: routes.length, routesWithOwnerData, skippedFamilies: [...skipped].sort() }))

  // 双向探针：B 自己的东西必须看得见（否则「B 什么都读不到」也可能只是接口全坏了）。
  // 用 id 而不是 mark 来判：模型是 mock 的，返回的选题标题里没有我塞的标记，拿 mark 判会假红。
  for (const list of LIST_ROUTES_WITH_BOTH) {
    const family = familyOf(list)
    const asOther = await getAs(OTHER, list, base)
    assert.ok(asOther.text.includes(`"id":${JSON.stringify(theirs.ids[family])}`), `${list} 没返回 B 自己的数据（${asOther.status}）：${asOther.text.slice(0, 160)}`)
    assert.ok(!asOther.text.includes(`"id":${JSON.stringify(mine.ids[family])}`), `${list} 把 A 的数据混进了 B 的列表：${asOther.text.slice(0, 160)}`)
    assert.ok(!asOther.text.includes(mine.mark), `${list} 把 A 的数据混进了 B 的列表：${asOther.text.slice(0, 160)}`)
  }
})

test('别人的东西改不动：带参数的写路由逐条用 B 的身份试一遍', async t => {
  const port = PORT + 1
  const base = `http://127.0.0.1:${port}`
  const server = await startServer(port, freshDataFile('write'))
  t.after(() => server.kill())
  const mine = await seed(OWNER, base)
  await seed(OTHER, base)

  const routes = enumeratePatternRoutes('POST|PUT|PATCH|DELETE')
  assert.ok(routes.length >= 15, `只认出 ${routes.length} 条带参数的写路由，枚举规则可能失效了（漏认 = 假绿）`)

  const before = await fingerprint(OWNER, base)
  const skipped = new Set()
  const accepted = []
  const leakedInReason = []
  let exercised = 0

  for (const route of routes) {
    const id = mine.ids[route.family]
    if (!id) { skipped.add(route.family); continue }
    exercised += 1
    const target = patternToUrl(route.pattern, id)
    const response = await fetch(`${base}${target}`, { method: route.method, headers: headersFor(OTHER), ...(route.method === 'DELETE' ? {} : { body: '{}' }) })
    const text = await response.text()
    if (response.status < 400) accepted.push(`${route.method} ${target} → ${response.status} ${text.slice(0, 140)}`)
    if (text.includes(mine.mark)) leakedInReason.push(`${route.method} ${target} → ${response.status} ${text.slice(0, 140)}`)
  }

  assert.ok(exercised >= 5, `只试了 ${exercised} 条写路由——种子或枚举没生效，这条等于空转`)
  assert.deepEqual(accepted, [], `B 对 A 的资源发写请求，服务端没拒绝：\n${accepted.join('\n')}`)
  assert.deepEqual(leakedInReason, [], `B 被拒了，但拒绝的文案里带出了 A 的数据：\n${leakedInReason.join('\n')}`)
  assert.equal(await fingerprint(OWNER, base), before, 'B 的写请求改动了 A 的数据')
  assertCoverageDecided(skipped)
  console.log(JSON.stringify({ event: 'owner_isolation_write', patternWriteRoutes: routes.length, exercised, skippedFamilies: [...skipped].sort() }))
})

// 间接引用：别人的 id 不在 URL 里，而在请求体里（拿 A 的 id 去拼自己的东西）。
// 这两条路以前不在判定里，因为「怎么从源码里枚举出请求体里的 id 字段」没有靠得住的算法。
// 现在不靠算法靠枚举：**把源码里真接受 id 的几处写下来**，一条一条试。
//
// 判定看两件事，而不是看状态码：
//   「接受但忽略」不是问题（形式判断就是这种），**「接受并用了别人的东西」才是**。
//   所以：① B 的回复里不许出现 A 的标记（用上了 A 的内容会现形）；② 事后 A 的数据必须一字不差
//   （把内容写回 A 的选题这种改动，会在这里现形）。
const INDIRECT_REFERENCES = [
  { path: '/api/drafts/generate', why: '生成锚点（选题/方法/素材）全部指向 A，同时给 B 自己的锚点让请求能往下走', body: mine => ({ topic: { title: 'B 自己的锚点', strategy_layer: 'trust', goal_refs: [] }, topic_id: mine.ids.topics, structure_id: mine.ids.structures, quote_ids: [mine.ids.materials], experience_ids: [mine.ids.materials] }) },
  { path: '/api/materials/atoms', why: '素材来源指向 A 的素材', body: mine => ({ kind: 'quote', text: 'B 自己的素材', source_id: mine.ids.materials }) },
  { path: '/api/performance-snapshots', why: '表现数据挂到 A 的草稿上', body: mine => ({ draft_id: mine.ids.drafts, platform: '抖音', metrics: { views: 1 }, status: 'confirmed' }) },
  { path: '/api/skills/form', why: '形式判断的结果会写回选题（拿 A 的 id 试）', body: mine => ({ topic: 'B 自己的选题', topic_id: mine.ids.topics }) },
]

test('间接引用：请求体里拿 A 的 id，既读不到也用不上（跨账号）', async t => {
  const base = `http://127.0.0.1:${PORT}`
  const server = await startServer(PORT, freshDataFile('indirect'))
  t.after(() => server.kill())
  const mine = await seed(OWNER, base)
  await seed(OTHER, base)

  const before = await fingerprint(OWNER, base)
  const leaked = []
  const statuses = []
  for (const entry of INDIRECT_REFERENCES) {
    const response = await post(OTHER, entry.path, entry.body(mine), base)
    // 404 说明路由改了名字或没这条——枚举清单过期了，这时候必须让人看见，不能静默跳过。
    assert.notEqual(response.status, 404, `${entry.path} 返回 404：这条路由可能改了名字，清单要跟着改（${entry.why}）`)
    // 5xx 更糟：路由报错了，根本走不到「用没用别人的 id」那一步，这条会变成假绿。
    assert.ok(response.status < 500, `${entry.path} 返回 ${response.status}（${entry.why}）：这条没真的走到引用解析那一步，判定等于空转`)
    statuses.push(`${entry.path}=${response.status}${response.status >= 500 ? ` ${response.text.slice(0, 120)}` : ''}`)
    if (response.text.includes(mine.mark)) leaked.push(`${entry.path}（${entry.why}）→ ${response.status} ${response.text.slice(0, 160)}`)
  }

  assert.deepEqual(leaked, [], `B 在自己的请求体里引用了 A 的 id，服务端把 A 的东西给了 B：\n${leaked.join('\n')}`)
  assert.equal(await fingerprint(OWNER, base), before, 'B 用请求体里的 A 的 id 改动了 A 的数据')
  console.log(JSON.stringify({ event: 'owner_isolation_indirect', checked: INDIRECT_REFERENCES.length, statuses }))
})

test('路由枚举规则本身要认得出现有路由（防止规则退化后假绿）', () => {
  const routes = enumerateGetRoutes()
  const paths = routes.map(route => route.path)
  assert.ok(paths.includes('/api/drafts'), '认不出 /api/drafts')
  // 参数段在归一化时去掉了反斜杠，所以是 `(d+)` 而不是 `(\d+)`。
  assert.ok(paths.includes('/api/drafts/(d+)'), `认不出带参数的草稿详情路由：${paths.filter(path => path.includes('drafts')).join('、')}`)
  assert.ok(paths.includes('/api/drafts/(d+)/history'), '认不出草稿历史路由')
  const direct = routes.filter(route => !route.dynamic).length
  const dynamic = routes.length - direct
  // 带参数的 GET 路由现在就 4 条（草稿详情/草稿历史/私密文件预览/截图任务）。
  // 变少比变多更可怕：那意味着「查过的」悄悄变少了，会成为假绿。
  assert.ok(direct >= 25, `直写路由只认出 ${direct} 条，规则可能退化了`)
  assert.ok(dynamic >= 4, `带参数 GET 路由只认出 ${dynamic} 条，规则可能退化了`)

  const writes = enumeratePatternRoutes('POST|PUT|PATCH|DELETE')
  const draftsWrites = writes.filter(route => route.family === 'drafts')
  assert.ok(draftsWrites.some(route => route.method === 'DELETE'), `认不出草稿删除路由：${draftsWrites.map(route => `${route.method} ${route.path}`).join('、')}`)
  assert.ok(writes.length >= 15, `带参数写路由只认出 ${writes.length} 条，规则可能退化了`)
})
