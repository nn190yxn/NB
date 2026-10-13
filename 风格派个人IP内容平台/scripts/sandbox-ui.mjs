import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import net from 'node:net'

// 真界面走查用的沙箱：后台读写 data.json 的副本，界面连的就是这个后台。
// 为什么需要它：界面上生成的每一条素材、每一份稿子都会立刻落盘。
// 在真实后台上点一次「生成草稿」，就等于往用户的数据里塞测试垃圾。
// 端口一律 --strictPort：Vite 悄悄跳号（5173 被占就用 5174）时，
// 界面连的会是另一套后台、写的可能是真实数据，而页面上完全看不出来。

const root = join(import.meta.dirname, '..')
const viteJs = join(root, 'node_modules/vite/bin/vite.js')
const source = join(root, 'server/data.json')
if (!existsSync(source)) {
  console.error(`没有 ${source}，无处可拷。`)
  process.exit(1)
}

const dir = mkdtempSync(join(tmpdir(), 'sandbox-ui-'))
// --data <路径>：接着上一次沙箱数据继续走。走查走到一半改代码要重启后台时，
// 不重用的话前面攒的选题、主张就没了。给了路径也必须仍在临时目录里，别指真实数据。
const reuse = process.argv.indexOf('--data') >= 0 ? process.argv[process.argv.indexOf('--data') + 1] : null
if (reuse && !existsSync(reuse)) {
  console.error(`--data 指向的文件不存在：${reuse}`)
  process.exit(1)
}
if (reuse && resolve(reuse).toLowerCase().startsWith(resolve(root, 'server').toLowerCase())) {
  console.error('--data 只能在 server 目录之外，指真实 data.json 就等于在真实数据上试错。')
  process.exit(1)
}
const dataCopy = reuse || join(dir, 'data.json')
if (!reuse) copyFileSync(source, dataCopy)

const freePort = () => new Promise(resolve => {
  const probe = net.createServer()
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})

const [serverPort, uiPort] = [await freePort(), await freePort()]
const origin = `http://localhost:${uiPort}`
const children = []

const serve = (command, args, env, label) => {
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  // 两个子进程的日志混在一起，靠 label 分清是谁在报。
  child.stdout.on('data', chunk => process.stdout.write(`${label} ${chunk}`))
  child.stderr.on('data', chunk => process.stdout.write(`${label} ${chunk}`))
  children.push(child)
  return child
}

// --watch：沙箱后台也要跟着源码走。挂一个读过旧代码的沙箱界面走查，
// 得出的结论会指错方向——这个项目最容易犯的就是这个错。
serve(process.execPath, ['--watch', 'server/index.mjs'], { PORT: String(serverPort), NODE_ENV: 'test', DATA_FILE: dataCopy, APP_ORIGIN: origin }, '[后台]')
serve(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(uiPort), '--strictPort', '--host', '127.0.0.1'], { API_PROXY_TARGET: `http://127.0.0.1:${serverPort}` }, '[界面]')

const waitHttp = async url => {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return null
}

const version = await (async () => {
  const response = await waitHttp(`http://127.0.0.1:${serverPort}/api/version`)
  return response ? await response.json() : null
})()

if (!version) {
  console.error('沙箱后台没起来。')
  for (const child of children) child.kill()
  process.exitCode = 1
} else if (version.storage !== 'json' || version.data_file !== dataCopy) {
  // 这一步是安全阀：证明这个后台读写的确实是副本。不成立就别开界面。
  console.error(`后台写的不是副本，是 ${version.data_file}（${version.storage}）。已停，未开界面。`)
  for (const child of children) child.kill()
  process.exitCode = 1
} else {
  const ready = await waitHttp(`http://127.0.0.1:${uiPort}/`)
  console.log(`\n沙箱界面：${origin}`)
  console.log(`沙箱后台：http://127.0.0.1:${serverPort}，数据副本 ${dataCopy}`)
  console.log(`副本大小 ${(readFileSync(dataCopy).length / 1024).toFixed(0)} KB；真实 server/data.json 不受这个进程读写。`)
  if (!ready) console.log('（Vite 还没响应，看上面的 [界面] 日志）')
}

const shutdown = () => {
  for (const child of children) child.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
