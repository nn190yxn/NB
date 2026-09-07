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

test('移除伪复盘指标和固定同步时间，保留过期会话输入保护', () => {
  const source = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\+42%|\+18%|最后同步于 09:42|<b>12<\/b>/)
  assert.match(source, /expectedUser=\{accountId\}/)
  assert.match(source, /当前编辑内容保留/)
  assert.match(source, /function HomeTopics/)
  assert.doesNotMatch(source, /indexRef\.current/)
})
