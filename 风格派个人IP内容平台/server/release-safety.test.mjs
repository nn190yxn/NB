import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformWithOxc } from 'vite'

test('离线队列按账号隔离，不自动迁移归属不明旧队列', async t => {
  const old = globalThis.localStorage
  const map = new Map([['content-ip-sync-queue', JSON.stringify([{ path: 'legacy' }])]])
  globalThis.localStorage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) }
  t.after(() => { if (old) globalThis.localStorage = old; else delete globalThis.localStorage })
  const compiled = await transformWithOxc(readFileSync(new URL('../src/sync-queue.ts', import.meta.url), 'utf8'), 'queue.ts')
  const queue = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`)
  assert.throws(() => queue.enqueueSyncEvents([{ path: 'new' }]))
  queue.setSyncAccount('alice'); queue.enqueueSyncEvents([{ path: 'alice-only' }])
  queue.setSyncAccount('bob'); assert.deepEqual(queue.pendingSyncEvents(), [])
  queue.setSyncAccount('alice'); assert.equal(queue.pendingSyncEvents()[0].path, 'alice-only')
  queue.setSyncAccount(null); assert.deepEqual(queue.pendingSyncEvents(), [])
  assert.ok(map.has('content-ip-sync-queue'))
})

test('离线队列读坏了也不许把待同步的记录弄丢', async t => {
  const old = globalThis.localStorage
  const map = new Map()
  globalThis.localStorage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) }
  t.after(() => { if (old) globalThis.localStorage = old; else delete globalThis.localStorage })
  const compiled = await transformWithOxc(readFileSync(new URL('../src/sync-queue.ts', import.meta.url), 'utf8'), 'queue.ts')
  const queue = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`)
  const key = 'content-ip-sync-queue:alice'
  queue.setSyncAccount('alice')

  // 三种「读坏」：解析不了、解析出来不是数组、数组里混着不是事件的垃圾。
  // 它们的共同点是**原来那些字节里可能就是待同步的记录**，所以一条都不许凭空消失。
  const damaged = [
    ['截断的 JSON', '{"path":"old"'],
    ['不是数组', JSON.stringify({ path: 'old' })],
    ['数组里混垃圾', JSON.stringify([null, 'x', { path: 'old' }])],
  ]
  for (const [label, raw] of damaged) {
    map.set(key, raw)
    // 新记录照常入队：不能因为存储坏了就整个功能停摆。
    queue.enqueueSyncEvents([{ path: 'new' }])
    // 坏字节必须还在、且找得到（换到 :damaged 备份位）：修好之前，不能让人永远找不回来。
    const kept = [...map.values()].some(value => value.includes('old'))
    assert.ok(kept, `${label}：坏数据被直接覆盖了，待同步的记录找不回来了`)
    assert.ok(map.has(`${key}:damaged`), `${label}：没留下备份位（:damaged），坏了的东西无处可查`)
    // 入队的新记录必须在（用得下去），且读出来只能是合法事件。
    const pending = queue.pendingSyncEvents()
    assert.deepEqual(pending.filter(event => event?.path === 'new').length, 1, `${label}：新记录没入队`)
    assert.ok(pending.every(event => event && typeof event.path === 'string'), `${label}：读出了不是事件的东西：${JSON.stringify(pending)}`)
    // 主存储里只许剩「合法事件」——不是事件的东西不能留在那里让下次再踩一遍。
    // （注意：里面那些**本来就合法**的事件要留着，比如这一组的 {path:'old'}。）
    const main = JSON.parse(map.get(key))
    assert.ok(main.every(event => event && typeof event.path === 'string'), `${label}：主存储里混进了不是事件的东西：${map.get(key)}`)
    assert.equal(main.filter(event => event.path === 'new').length, 1, `${label}：新记录不在主存储里`)
    map.clear()
  }

  // 备份写不进去（最常见的是浏览器存储满了）时，**宁可不写，也不能覆盖**：覆盖就等于把记录扔掉。
  const original = '{"path":"old"'
  map.set(key, original)
  globalThis.localStorage = {
    getItem: value => map.get(value),
    setItem: (value, item) => { if (String(value).endsWith(':damaged')) throw new Error('QuotaExceededError'); map.set(value, item) },
  }
  assert.throws(() => queue.enqueueSyncEvents([{ path: 'later' }]), /备份失败/, '备份失败时应该报错而不是静默覆盖')
  assert.equal(map.get(key), original, '备份失败时主存储不该被动过')
})

test('移除伪复盘指标和固定同步时间，保留过期会话输入保护', () => {
  const source = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\+42%|\+18%|最后同步于 09:42|<b>12<\/b>/)
  assert.match(source, /expectedUser=\{accountId\}/)
  assert.match(source, /当前编辑内容保留/)
  assert.match(source, /function HomeTopics/)
  assert.doesNotMatch(source, /indexRef\.current/)
})
