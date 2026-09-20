import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { collectionNames } from './mysql.mjs'

// 这条是**静态卡口**，跟 `owner-isolation.test.mjs`（真换账号跑一遍）各管一半：
//   行为测试管「现在真漏没漏」；这条管「以后别再悄悄写出一个漏点」。
//
// 为什么还要它：行为测试只能覆盖**枚举得出、又造了种子**的路由。新写一条按 id 取数的代码时，
// 除非那条路由正好被覆盖、又构造得出泄漏，否则不会响。这里把「取某一行数据、却没在这一行说明是谁的」
// 全部列出来，多一处就红——逼写的人做一次有意识的决定：要么走 owned()，要么在这里写清为什么。
//
// **它管不住的（别把它当安全证明）**：
//   1. 数据从哪来：文件末尾那几只守卫只看「取数那一行、写归属那一行、比归属那一行」**怎么写**，
//      推不出「`owner`/`userId` 这些变量本身是不是从请求体里绑出来的」（对最常见的绑法另有一条守卫盯着）；
//   2. 它是数出来的，不是推出来的——真正「不可能漏」要靠数据访问层收口，那仍未做（审计里记着）。
const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8')

// 集合名单取自持久化登记表（`server/mysql.mjs`），不在这里另维护一份：
// 那一边有 `persistence-registry.test.mjs` 盯着「saveState 用到的集合必须都登记」，所以它才是权威。
const READ_VERBS = ['find', 'filter', 'findIndex', 'some', 'every', 'map', 'flatMap']

// 同一行里出现这些，就算「已经说明白了」：
//   带 owner_id（显式按所有者过滤）/ nextId(state.x)（算下一个 id，本来就要看全量）/ 按对象身份操作刚拿到的那几条。
// `id !== ` 只出现在「把自己那条从数组里剔出去」这种写法里（全量搜过，两处都合法）：
// 它的方向是**删掉一条**，不是「把别人的读出来」。
const EXPLAINED = /owner_id|nextId\(|item !== |entry !== |file !== |row !== |id !== /

// 允许「没在这一行提所有者」的取数，只有这几处，每处都要说清为什么。
// 断言是双向的：出现清单外的 → 红；清单里的某条已经扫不到（代码改了）→ 也红。
const ALLOWED_UNSCOPED = [
  { match: 'state.usage_daily.find(item => item.id === id)?.count', why: '额度计数：id 本身就是「日期:用户:用途」拼出来的，所有者就在键里' },
  { match: 'state.usage_daily = state.usage_daily.filter(item => item.date >= cutoff)', why: '清理三天前的计数行：按日期做维护，不取给谁看' },
  { match: 'let record = state.usage_daily.find(item => item.id === id)', why: '同上（额度计数），新建时也会盖上 owner_id' },
  { match: 'state.users.find(user => user.username === key', why: '登录时按用户名认人：users 本身就是身份表，没有「所有者」这一层' },
  { match: 'state.feedback.find(entry => entry.id ===', why: '管理员改反馈状态，上一行已经用 isAdmin 挡过；反馈是全局收件箱，不按所有者过滤' },
  { match: 'state.drafts.filter(item => item.variant_of === draft.id)', why: '清变体：draft 是上面用 owned() 取到的自己那条，按它自己的 id 找派生稿' },
  { match: 'state.shooting.find(item => item.draft_id === draft.id)', why: '按草稿找拍摄项：draft 来自 owned()，拍摄项与草稿一对一' },
]

function scan(text) {
  const risky = []
  const unscoped = []
  const unknown = new Set()
  text.split('\n').forEach((line, index) => {
    const hit = line.match(new RegExp(`state\\.(\\w+)\\s*\\.\\s*(${READ_VERBS.join('|')})\\b`))
    if (!hit) return
    if (!collectionNames.includes(hit[1])) { unknown.add(hit[1]); return }
    risky.push({ line: index + 1, collection: hit[1], code: line.trim() })
    if (!EXPLAINED.test(line)) unscoped.push({ line: index + 1, code: line.trim() })
  })
  return { risky, unscoped, unknown: [...unknown] }
}

test('取某一行数据、却没说明是谁的，必须都在清单里', () => {
  const { risky, unscoped, unknown } = scan(source)
  // 防空过：扫不到东西的话下面全是空断言，这条测试会永远绿。
  assert.ok(collectionNames.length >= 15, `登记表只读到 ${collectionNames.length} 个集合，抽取方式可能失效了`)
  assert.ok(risky.length >= 20, `只扫到 ${risky.length} 处取数，正则可能失效——这条卡口就成空转了`)

  // 读的集合名必须在登记表里：写错名字（`state.draf.find`）会让上面那些断言安静地少扫一处。
  assert.deepEqual(unknown, [], `这些名字不在持久化登记表里，可能是拼错、或新集合没登记：${unknown.join('、')}`)

  const used = new Set()
  const unexpected = []
  for (const hit of unscoped) {
    const allowed = ALLOWED_UNSCOPED.find(entry => hit.code.includes(entry.match))
    if (allowed) { used.add(allowed.match); continue }
    unexpected.push(`index.mjs:${hit.line} ${hit.code.slice(0, 140)}`)
  }

  assert.deepEqual(unexpected, [], [
    '新出现了「取某一行数据、但没在这一行说明是谁的」的写法。两条路选一条：',
    '1. 走 owned(集合名, request).find(...) —— 这是本项目的正经入口；',
    `2. 确实不该按所有者过滤（管理员入口、身份表、按已归属对象的 id 找子行），就把这一处加到 ALLOWED_UNSCOPED 并写清为什么。\n${unexpected.join('\n')}`,
  ].join('\n'))

  const stale = ALLOWED_UNSCOPED.filter(entry => !used.has(entry.match)).map(entry => entry.match)
  assert.deepEqual(stale, [], `清单里这几条已经扫不到了（代码改了或写法变了），该从 ALLOWED_UNSCOPED 里删掉：\n${stale.join('\n')}`)

  // 反证（常驻）：往合成源码里塞几种写法，扫描必须报对的那一个。
  // 不然哪天真则失效，这条卡口会安静地变绿——跟它要防的东西一样。
  assert.equal(scan('const leaked = state.drafts.find(item => item.id === draftId)\n').unscoped.length, 1, '扫描对「按 id 取数没写所有者」不敏感了')
  assert.equal(scan("const fine = owned('drafts', request).find(item => item.id === draftId)\n").unscoped.length, 0, '已经走 owned() 的取数不该被报')
  assert.equal(scan(`const mine = state.drafts.filter(item => item.owner_id === user)\n`).unscoped.length, 0, '显式带 owner_id 的取数不该被报')
  assert.equal(scan('state.memories.push(memory)\n').risky.length, 0, '写入不该被当成取数')
  assert.deepEqual(scan('state.draf.find(item => item.id === id)\n').unknown, ['draf'], '拼错的集合名要能报出来')

  console.log(JSON.stringify({ event: 'owner_scope_static', riskyReads: risky.length, explained: risky.length - unscoped.length, allowed: ALLOWED_UNSCOPED.length }))
})

// —— 2026-09-20 补：这道卡口自己写明的两处「管不住」——
// 原文：① 中间变量绕一圈再取数扫不到；② 「这一行写了 owner_id、但写得不对」看不出来。
// 这两处正好是「漏了过滤」最省事的藏身处（把集合转个手、或者直接把客户端递上来的 owner_id 写给入库），
// 所以抳成三只守卫 + 一只盯着身份变量从哪来的。守卫本身用**合成源码**自证：能抳住会出事的写法，也不误伤合规写法。
const IDENTITY = /userId|\bowner\b|\busername\b/

// 允许「没在这一行写出身份」的例外，每条都要说清为什么。
const ALLOWED_ALIAS = [
  { match: 'const store = state[`${collection}_by_user`]', why: '按用户分库的存储：键就是 userId(request)，取到的永远是「自己那份」' },
]
const ALLOWED_OWNER_WRITE = [
  { match: "owner_id: collection === 'users' ? (item.id", why: '老数据迁移补归属：users 用自己的 id 当归属，其余给 demo-user 兜底（一次性迁移，不接用户输入）' },
]
const ALLOWED_LOOSE_IDENTITY = [
  { match: "const username = String(body.username || '').trim().toLowerCase()", why: '登录/注册：用户名本来就该由客户端提，它就是身份的来源；同名注册会被拦，密码对不上也不放行' },
]

function scanOwnership(text) {
  const handover = []
  const clientOwner = []
  const meaningless = []
  const looseIdentity = []
  text.split('\n').forEach((line, index) => {
    const where = { line: index + 1, code: line.trim() }
    // 守卫一：把整个集合交给一个变量（`const rows = state.materials`）——之后用 rows 取数，上面那只扫 `state.x.find` 的卡口就看不见了。
    if (/=\s*state(?:\.\w+|\[[^\]]*\])\s*(?:\/\/.*)?$/.test(line) && !ALLOWED_ALIAS.some(entry => line.includes(entry.match))) handover.push(where)
    // 守卫二：归属必须由服务端写。写成 `owner_id: body.owner_id` 就是把「我是谁」交给客户端。
    for (const hit of line.matchAll(/owner_id:\s*([^,}]+)/g)) {
      if (IDENTITY.test(hit[1]) || ALLOWED_OWNER_WRITE.some(entry => line.includes(entry.match))) continue
      clientOwner.push({ ...where, value: hit[1].trim().slice(0, 60) })
    }
    // 守卫三：归属的比较必须有意义。`owner_id !== undefined`、`owner_id === 'demo-user'` 看着像过滤，其实谁都过。
    for (const hit of line.matchAll(/owner_id\s*[!=]==?\s*([^&|)]+)/g)) {
      if (IDENTITY.test(hit[1])) continue
      meaningless.push({ ...where, value: hit[1].trim().slice(0, 60) })
    }
    // 守卫四：被当成身份的那些变量，不许从客户端递上来的东西里绑（那是守卫二、三最大的后门）。
    if (/(?:const|let)\s+(?:owner|userId|username|ownerId)\w*\s*=\s*[^;]*(?:\bbody\b|\bpayload\b|\bheaders\b|query\b)/.test(line) && !ALLOWED_LOOSE_IDENTITY.some(entry => line.includes(entry.match))) looseIdentity.push(where)
  })
  return { handover, clientOwner, meaningless, looseIdentity }
}

test('归属必须由服务端写、比得有意义、集合不许转手', () => {
  const clean = scanOwnership(source)
  const show = hits => hits.map(hit => `index.mjs:${hit.line} ${hit.code.slice(0, 150)}`).join('\n')
  assert.deepEqual(clean.handover, [], `这些地方把整个集合交给了变量，之后用它取数就绕过上面那只卡口了。要么直接用 owned()/state.x.find(...)，要么加到 ALLOWED_ALIAS 并写清为什么：\n${show(clean.handover)}`)
  assert.deepEqual(clean.clientOwner, [], `这些地方写的归属不是「谁在问」：接客户端递上来的 owner_id 就是越权写入。\n${show(clean.clientOwner)}`)
  assert.deepEqual(clean.meaningless, [], `这些归属比较没有意义，谁都过得了（看着像过滤，其实不是）：\n${show(clean.meaningless)}`)
  assert.deepEqual(clean.looseIdentity, [], `身份变量不许从请求里绑（body/payload/headers/query）。确实该由客户端提（比如登录用户名），就加到 ALLOWED_LOOSE_IDENTITY 并写清为什么：\n${show(clean.looseIdentity)}`)
  const staleIdentity = ALLOWED_LOOSE_IDENTITY.filter(entry => !source.includes(entry.match)).map(entry => entry.match)
  assert.deepEqual(staleIdentity, [], `清单里这几条已经扫不到了（代码改了或写法变了），该从 ALLOWED_LOOSE_IDENTITY 里删掉：\n${staleIdentity.join('\n')}`)

  // 反空过（常驻）：拿**会出事的写法**当场试——每只守卫都得抓住。
  const hazards = scanOwnership([
    'const rows = state.materials',
    'const rows = state[collectionName]',
    'const item = { id, owner_id: body.owner_id }',
    'const item = { owner_id: remote.owner_id, id }',
    'const mine = state.materials.find(row => row.owner_id !== undefined)',
    "const mine = state.materials.filter(row => row.owner_id === 'demo-user')",
    'const owner = body.user_id',
  ].join('\n'))
  assert.ok(hazards.handover.length >= 2, `「集合转手」守卫是空转：${JSON.stringify(hazards.handover)}`)
  assert.ok(hazards.clientOwner.length >= 2, `「归属不接客户端」守卫是空转：${JSON.stringify(hazards.clientOwner)}`)
  assert.ok(hazards.meaningless.length >= 2, `「归属比较要有意义」守卫是空转：${JSON.stringify(hazards.meaningless)}`)
  assert.ok(hazards.looseIdentity.length >= 1, `「身份变量不许从请求里绑」守卫是空转：${JSON.stringify(hazards.looseIdentity)}`)

  // 反向：合规写法不许被误伤（误报会逼人加白名单，白名单一多守卫就废了）。
  const falseAlarms = scanOwnership([
    'const mine = state.materials.filter(item => item.owner_id === userId(request))',
    'const store = state[`${collection}_by_user`]',
    'const item = { id, owner_id: userId(request) }',
    'const owner = userId(request)',
  ].join('\n'))
  assert.deepEqual(falseAlarms.handover, [], `合规写法被误判成集合转手：${JSON.stringify(falseAlarms.handover)}`)
  assert.deepEqual(falseAlarms.clientOwner, [], `合规写法被误判成「归属接客户端」：${JSON.stringify(falseAlarms.clientOwner)}`)
  assert.deepEqual(falseAlarms.meaningless, [], `合规写法被误判成「归属没比对」：${JSON.stringify(falseAlarms.meaningless)}`)
  assert.deepEqual(falseAlarms.looseIdentity, [], `合规写法被误判成身份变量来路不明：${JSON.stringify(falseAlarms.looseIdentity)}`)

  console.log(JSON.stringify({ event: 'owner_scope_ownership_guards', handover: clean.handover.length, clientOwner: clean.clientOwner.length, meaningless: clean.meaningless.length, looseIdentity: clean.looseIdentity.length }))
})
