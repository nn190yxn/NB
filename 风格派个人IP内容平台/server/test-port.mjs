// undici / fetch 会拒绝一批「不安全端口」（3659、4045、4190、6000、6665-6669、10080 等）。
// 测试文件由 node --test 并行拉起，互不共享内存：只靠随机数仍会撞号。
// 用父进程 pid 目录里的独占文件做跨进程分配，同一轮 npm test 里每个端口只发出去一次。
import { mkdirSync, openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const blockedPorts = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 138, 139, 143, 161, 179,
  389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 549, 550, 551, 552, 553, 554, 555, 556,
  563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190,
  5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
])

export function createPortAllocator({ lockDir, blocked = blockedPorts } = {}) {
  const dir = lockDir || join(tmpdir(), `content-ip-test-ports-${process.ppid}`)
  mkdirSync(dir, { recursive: true })

  function testPort(base, span) {
    const start = Number(base)
    const width = Number(span)
    if (!Number.isInteger(start) || !Number.isInteger(width) || width <= 0) {
      throw new Error(`无效的测试端口范围: base=${base} span=${span}`)
    }
    for (let port = start; port < start + width; port += 1) {
      if (blocked.has(port)) continue
      try {
        const fd = openSync(join(dir, String(port)), 'wx')
        closeSync(fd)
        return port
      } catch (error) {
        if (error?.code === 'EEXIST') continue
        throw error
      }
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
