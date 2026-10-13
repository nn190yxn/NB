// undici / fetch 会拒绝一批「不安全端口」（3659、4045、4190、6000、6665-6669、10080 等）。
// 测试文件由 node --test 并行拉起，互不共享内存：只靠随机数仍会撞号。
// 用父进程 pid 目录里的独占文件做跨进程分配，同一轮 npm test 里每个端口只发出去一次。
import { mkdirSync, readFileSync, writeFileSync, existsSync, linkSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 62 个测试文件用 `cwd: process.cwd()` 起后台，后台入口写的是相对路径 `server/index.mjs`。
// 在 server/ 目录里单跑测试文件时那个路径不存在——后台退码 1，测试只剩一句
// 「测试 API 异常退出: 1」，看着像偶发失败，能把人引去改本来没坏的代码（这轮就被它骗过一次）。
// 所以在发号之前先把真正的原因说清楚。
export function assertSpawnableFromCwd(cwd = process.cwd()) {
  if (!existsSync(join(cwd, 'server', 'index.mjs'))) {
    throw new Error(`测试要在仓库根目录跑（npm test）：当前目录 ${cwd} 下没有 server/index.mjs，测试起后台只会以「异常退出: 1」失败，看不出真正原因。`)
  }
  return cwd
}
assertSpawnableFromCwd()

export const blockedPorts = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 138, 139, 143, 161, 179,
  389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 549, 550, 551, 552, 553, 554, 555, 556,
  563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190,
  5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
])

// 端口有没有人用：光靠自己发的号占不到真实占用（并行跑两套测试、或桌面端/Vite 已经占着同一个号时，
// 后台进程直接 EADDRINUSE 退出，测试就报成一个看不懂的「异常退出: 1」）。
// 这里在发号前用 netstat 看一次本机正在监听 / 等待回收的端口，每个测试进程只查一次。
function listeningPorts(exec) {
  const found = new Set()
  let output = ''
  try {
    output = exec()
  } catch {
    // 查不到（没有 netstat、语言环境不同、容器里禁用）就退回只用自己的锁，不因此让测试跑不起来。
    return null
  }
  for (const line of String(output).split(/\r?\n/)) {
    if (!/LISTEN|TIME_WAIT/i.test(line)) continue
    const columns = line.trim().split(/\s+/).filter(Boolean)
    const local = columns[1] || ''
    const port = Number(local.slice(local.lastIndexOf(':') + 1))
    if (Number.isInteger(port) && port > 0) found.add(port)
  }
  return found
}

function defaultNetstat() {
  return execFileSync('netstat', process.platform === 'win32' ? ['-ano'] : ['-an'], { encoding: 'utf8', timeout: 3000, maxBuffer: 8 * 1024 * 1024 })
}

export function createPortAllocator({ lockDir, blocked = blockedPorts, exec = defaultNetstat, portIsFree = null, pid = process.pid, isAlive = pid => {
  // 锁文件里写的是持有那个端口的测试进程 pid。进程没了，锁就该被接手——
  // 否则上一轮崩掉的测试会永久吃掉一批端口。
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
} } = {}) {
  // 锁目录必须是全局共享的：按 ppid 分目录的话，同时跑两套测试会各自发同一个号，
  // 后绑的那个直接 EADDRINUSE 退出，报出来是一句看不懂的「异常退出: 1」。
  const dir = lockDir || join(tmpdir(), 'content-ip-test-ports')
  mkdirSync(dir, { recursive: true })

  // 抢一个号必须是原子的。以前的写法是「锁不存在就创建；存在但持有者死了就直接覆写 pid」，
  // 后半段有两个进程同时判定为死锁、同时以为自己拿到同一个号的窗口——
  // 表现就是并发下「整文件失败、每次挂的文件不同」。
  // 现在只用 link(2)：目标已存在就一定失败，赢的只有一个；输了就重看持有者，还活着就让开。
  function claim(lockFile, attempt = 0) {
    const mine = `${lockFile}.${pid}`
    writeFileSync(mine, String(pid))
    try {
      try {
        linkSync(mine, lockFile)
        return true
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }
      let holder = 0
      try {
        holder = Number(readFileSync(lockFile, 'utf8'))
      } catch {
        return false
      }
      if (!holder || holder === pid || isAlive(holder)) return false
      if (attempt >= 3) return false
      // 上一个持有者确实没了：收走它的锁再来一次（两边同时收也只有一个能 link 成功）。
      try {
        unlinkSync(lockFile)
      } catch { /* 别人已经收走了，下面的 link 会给出答案 */ }
      return claim(lockFile, attempt + 1)
    } finally {
      try {
        unlinkSync(mine)
      } catch { /* 已经清掉了 */ }
    }
  }
  let busy = null
  const busyPorts = () => {
    if (busy === null) busy = listeningPorts(exec)
    return busy
  }

  function testPort(base, span) {
    const start = Number(base)
    const width = Number(span)
    if (!Number.isInteger(start) || !Number.isInteger(width) || width <= 0) {
      throw new Error(`无效的测试端口范围: base=${base} span=${span}`)
    }
    const inUse = busyPorts()
    for (let port = start; port < start + width; port += 1) {
      if (blocked.has(port)) continue
      if (inUse?.has(port)) continue
      if (portIsFree && !portIsFree(port)) continue
      if (claim(join(dir, String(port)))) return port
    }
    throw new Error(`测试端口耗尽: ${start}-${start + width - 1}`)
  }

  function testPortSequence(base, span) {
    return () => testPort(base, span)
  }

  return { testPort, testPortSequence }
}

const shared = createPortAllocator()
export const testPort = (base, span) => shared.testPort(base, span)
export const testPortSequence = (base, span) => shared.testPortSequence(base, span)

export function listenLocal(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ port, baseUrl: `http://127.0.0.1:${port}` })
    })
  })
}
