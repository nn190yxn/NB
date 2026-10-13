import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPortAllocator, assertSpawnableFromCwd } from './test-port.mjs'
void mkdirSync

test('在错的目录下跑测试，要当场说清原因', () => {
  assert.equal(assertSpawnableFromCwd(process.cwd()), process.cwd(), '仓库根目录（或包含 server/index.mjs 的目录）该放行')
  const wrong = mkdtempSync(join(tmpdir(), 'wrong-cwd-'))
  assert.throws(() => assertSpawnableFromCwd(wrong), /要在仓库根目录跑/)
  assert.throws(() => assertSpawnableFromCwd(wrong), /异常退出: 1/, '得点破那句看不懂的错误信息其实是这个原因')
})

test('同一范围内的端口不会重复分配', () => {
  const { testPort } = createPortAllocator({ lockDir: mkdtempSync(join(tmpdir(), 'port-lock-')) })
  const seen = new Set()
  for (let index = 0; index < 30; index += 1) {
    const port = testPort(20000, 40)
    assert.equal(seen.has(port), false, `端口 ${port} 被分配了两次`)
    seen.add(port)
  }
})

test('递增取值会跳过 undici 禁用端口', () => {
  const { testPortSequence } = createPortAllocator({ lockDir: mkdtempSync(join(tmpdir(), 'port-lock-')) })
  const next = testPortSequence(3658, 20)
  assert.deepEqual([next(), next(), next()], [3658, 3660, 3661])
})

test('范围内端口用尽时明确失败', () => {
  const { testPort } = createPortAllocator({
    lockDir: mkdtempSync(join(tmpdir(), 'port-lock-')),
    blocked: new Set([10, 11]),
  })
  assert.equal(testPort(10, 3), 12)
  assert.throws(() => testPort(10, 3), /测试端口耗尽: 10-12/)
})

// 锁目录以前按 ppid 分：同时跑两套测试会各自发出同一个号，后绑的那个 EADDRINUSE 退出，
// 报出来是一句看不懂的「异常退出: 1」。现在锁是全局共享的，靠锁文件里的 pid 判断归属。
test('端口锁跨进程共享：别人占着的号不再发出去', () => {
  const lockDir = mkdtempSync(join(tmpdir(), 'port-lock-'))
  const taken = testPortFrom(lockDir)
  const other = taken(20100, 5)
  assert.ok(other >= 20100 && other <= 20104)
  // 换一个分配器实例（模拟另一套并行测试），不能拿到同一个号
  const again = testPortFrom(lockDir)
  const second = again(20100, 5)
  assert.notEqual(second, other, '并行跑的两套测试不该拿到同一个端口')
})

test('持有进程已经没了的锁要被接手，不然崩一次就永久吃掉一批端口', () => {
  const lockDir = mkdtempSync(join(tmpdir(), 'port-lock-'))
  const port = 20200
  writeFileSync(join(lockDir, String(port)), '999999999')
  const next = testPortFrom(lockDir, { isAlive: () => false })
  assert.equal(next(port, 2), port, '上一轮死掉的进程留下的锁该被接手')
})

// 接手死锁不能写成「读一下、觉得死了就覆写」：两个进程同时这么干，会拿到同一个号，
// 后绑的那个 EADDRINUSE 退出——就是并发下「整文件失败、每次挂的文件不同」的形状。
test('两个进程同时接手同一个死锁号，只能有一个拿到', () => {
  const lockDir = mkdtempSync(join(tmpdir(), 'port-lock-'))
  const port = 20400
  const dead = 999999999
  writeFileSync(join(lockDir, String(port)), String(dead))
  const winners = []
  const losers = []
  for (const fakePid of [11111, 22222]) {
    const { testPort } = createPortAllocator({ lockDir, pid: fakePid, isAlive: holder => holder !== dead })
    try {
      winners.push(testPort(port, 1))
    } catch (error) {
      losers.push(error.message)
    }
  }
  assert.deepEqual(winners, [port], `只能有一个拿到 ${port}，其余必须让开`)
  assert.equal(losers.length, 1)
  assert.match(losers[0], /端口耗尽/, '抢输的那个只能让开，不能和赢家绑同一个号')
  const holder = readFileSync(join(lockDir, String(port)), 'utf8')
  assert.ok(['11111', '22222'].includes(holder), `锁最后必须写着一个真持有者的 pid，现在是 ${holder}`)
  assert.deepEqual(readdirSync(lockDir), [String(port)], '抢号用的临时硬链接必须清干净')
})

test('本机已经在监听的端口不发出去', () => {
  const lockDir = mkdtempSync(join(tmpdir(), 'port-lock-'))
  const netstatLine = '  TCP    0.0.0.0:20301            0.0.0.0:0              LISTENING       4321'
  const next = testPortFrom(lockDir, { exec: () => netstatLine })
  assert.notEqual(next(20300, 4), 20301, '桌面端或 Vite 占着的号要让开')
  assert.equal(readFileSync(join(lockDir, '20300'), 'utf8').length > 0, true)
})

function testPortFrom(lockDir, overrides = {}) {
  const { testPort } = createPortAllocator({ lockDir, ...overrides })
  return testPort
}
