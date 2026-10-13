import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBuildInfo, readGitInfo, sourceFingerprint } from './build-info.mjs'
import { testPort } from './test-port.mjs'

function tempProject() {
  const root = mkdtempSync(join(tmpdir(), 'build-info-'))
  mkdirSync(join(root, 'server'), { recursive: true })
  // 真实仓库的后台全是静态 import，这里照做：指纹只认「被 import 到的文件」。
  writeFileSync(join(root, 'server/index.mjs'), "import { b } from './b.mjs'\nexport const a = 1 + b\n")
  writeFileSync(join(root, 'server/b.mjs'), 'export const b = 2\n')
  writeFileSync(join(root, 'server/data.json'), '{}')
  return root
}

const build = root => createBuildInfo({ root, gitRun: () => null })

test('改到一个被 import 的源码文件 → 判定为陈旧', () => {
  const root = tempProject()
  const info = build(root)
  assert.equal(info.snapshot().stale, false, '刚启动时不该报陈旧')

  appendFileSync(join(root, 'server/b.mjs'), 'export const c = 3\n')
  const after = info.snapshot()
  assert.equal(after.stale, true, '磁盘上的后台源码比正在跑的进程新')
  assert.equal(after.source_files, 2)
  assert.ok(after.newest_source_at)
})

test('只算真正被 import 的文件：数据文件与测试助手改了都不该让角标变红', () => {
  const root = tempProject()
  const info = build(root)
  writeFileSync(join(root, 'server/data.json'), '{"materials":[]}')
  writeFileSync(join(root, 'server/index.test.mjs'), 'test("x", () => {})\n')
  // 本轮自己踩到的坑：test-port.mjs、generation-test-helper.mjs 只在测试里用，后台不 import 它们。
  // 把它们算进指纹会让角标常年误报，而报错的角标等于没有角标。
  writeFileSync(join(root, 'server/test-port.mjs'), 'export const testPort = () => 1\n')
  writeFileSync(join(root, 'server/generation-test-helper.mjs'), 'export const helper = 1\n')
  assert.equal(info.snapshot().stale, false)
})

test('没有 git（打包成桌面版）时如实说没有，不猜版本号', () => {
  const root = tempProject()
  const fingerprint = sourceFingerprint({ entry: join(root, 'server/index.mjs') })
  assert.equal(fingerprint.files, 2)
  assert.match(fingerprint.revision, /^2-\d+-\d+$/)

  const snapshot = build(root).snapshot()
  assert.equal(snapshot.commit, null)
  assert.equal(snapshot.git_source, 'none')
  assert.equal(snapshot.dirty, false)
  assert.match(snapshot.revision, /^nogit:/, '没有 commit 也要能给出可比较的指纹')
})

test('git 口径：本目录下的未提交改动才算脏，别处的不算', () => {
  const fakeGit = body => args => {
    if (args[0] === 'rev-parse' && args[1] === '--short') return 'abc1234'
    if (args[0] === 'rev-parse') return '/repo'
    return body
  }
  const root = '/repo/工作台'

  const sibling = readGitInfo({ root, gitRun: fakeGit(' M 别的项目/index.mjs') })
  assert.equal(sibling.commit, 'abc1234')
  assert.equal(sibling.dirty, false, '上层仓库里兄弟目录的改动不该把工作台标脏')

  assert.equal(readGitInfo({ root, gitRun: fakeGit(' M 工作台/server/index.mjs') }).dirty, true)
  assert.equal(readGitInfo({ root, gitRun: fakeGit('?? 工作台/docs/新规格.md') }).dirty, false, '只有未跟踪文件时，在跑的代码没变')
})

test('uptime 与启动时间随时间走，且不会算出负数', () => {
  const root = tempProject()
  let clock = 1_000
  const info = createBuildInfo({ root, gitRun: () => null, now: () => clock })
  clock = 61_000
  const snapshot = info.snapshot()
  assert.equal(snapshot.uptime_ms, 60_000)
  assert.equal(new Date(snapshot.started_at).getTime(), 1_000)
  assert.equal(info.snapshot(500).uptime_ms, 0, '时钟回拨也不能给出负的存活时间')
})

const port = testPort(48100, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'version-route-')), 'data.json')
writeFileSync(dataFile, '{}')

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 20000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

test('/api/version 报出代码标识且不需要登录；/healthz 形状不变', async t => {
  const server = await startServer()
  t.after(() => server.kill())

  const response = await fetch(`${baseUrl}/api/version`)
  assert.equal(response.status, 200)
  const info = await response.json()
  assert.equal(typeof info.stale, 'boolean', '陈旧判定必须在，缺了它这条接口就是装饰')
  assert.ok(info.source_files > 10, `真实仓库里应能数到后台的 import 图，实际 ${info.source_files}`)
  assert.ok(Date.parse(info.started_at), '启动时间要能解析')
  assert.ok(info.revision)

  // 角标要能回答「现在在往哪个数据文件写」：前端换端口就可能连到另一套后台，界面看不出来是坑。
  assert.equal(info.data_file, dataFile, '版本号里没带数据文件路径')
  assert.equal(info.storage, 'json')

  // /healthz 是被测试锁住的监控契约：版本信息只走 /api/version，不往里塞字段。
  assert.deepEqual(await (await fetch(`${baseUrl}/healthz`)).json(), { status: 'ok', storage: 'json-mvp' })

  // 来源被拒时不能只甩一句「不被允许」——开发模式下要给出路。
  const denied = await fetch(`${baseUrl}/api/topics`, { headers: { Origin: 'http://127.0.0.1:9999' } })
  assert.equal(denied.status, 403)
  const deniedBody = await denied.json()
  assert.equal(deniedBody.code, 'origin_not_allowed')
  assert.equal(deniedBody.error, '请求来源不被允许', '这句原文被 auth.test.mjs 锁着，不能改')
  assert.match(deniedBody.remedy, /APP_ORIGIN.*重启后台/, '报错要告诉人怎么解')
})
