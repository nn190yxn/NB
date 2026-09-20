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
//   1. 中间变量绕一圈再取数（`const rows = state.materials` 之后用 rows 找）扫不到；
//   2. 这一行写了 owner_id、但写得不对（比如 `item.owner_id !== undefined`）它看不出来；
//   3. 它是数出来的，不是推出来的——真正「不可能漏」要靠数据访问层收口，那仍未做（审计里记着）。
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
