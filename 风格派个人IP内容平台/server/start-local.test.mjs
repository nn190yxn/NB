import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildNpmInvocation, runLauncher, sanitizeLog } from '../scripts/start-local.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function healthyResponse(url) {
  if (url.includes(':3001')) return { ok: true, json: async () => ({ status: 'ok' }) }
  return { ok: true, text: async () => '<title>定位派</title><div id="root"></div>' }
}

function childStub() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

function baseOptions(overrides = {}) {
  return {
    rootDir: projectRoot,
    logger: () => undefined,
    existsFn: () => true,
    npmAvailableFn: () => true,
    npmCommand: 'npm',
    portOpenFn: async () => false,
    openBrowserFn: () => undefined,
    waitOptions: { attempts: 2, intervalMs: 0 },
    ...overrides,
  }
}

test('启动日志会遮蔽常见敏感字段', () => {
  const value = sanitizeLog('api_key=abc password:123 Bearer ey.test.token')
  assert.equal(value, 'api_key=[REDACTED] password=[REDACTED] Bearer [REDACTED]')
})

test('Windows npm.cmd 通过 cmd.exe 启动', () => {
  assert.deepEqual(buildNpmInvocation('npm.cmd', ['run', 'server'], 'cmd.exe'), {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', 'npm.cmd', 'run', 'server'],
  })
})

test('两个服务已健康时直接复用并打开本地页面', async () => {
  const opened = []
  const result = await runLauncher(baseOptions({
    fetchFn: async url => healthyResponse(url),
    spawnFn: () => { throw new Error('不应启动新进程') },
    openBrowserFn: url => opened.push(url),
  }))

  assert.equal(result.ok, true)
  assert.deepEqual(result.status, { API: 'reused', VITE: 'reused' })
  assert.deepEqual(opened, ['http://127.0.0.1:5173/'])
})

test('服务未运行时使用固定 npm 参数启动并等待健康检查', async () => {
  const calls = new Map()
  const spawns = []
  const opened = []
  const result = await runLauncher(baseOptions({
    fetchFn: async url => {
      const count = (calls.get(url) || 0) + 1
      calls.set(url, count)
      if (count === 1) throw new Error('尚未启动')
      return healthyResponse(url)
    },
    spawnFn: (command, args, options) => {
      spawns.push({ command, args, cwd: options.cwd, windowsHide: options.windowsHide })
      return childStub()
    },
    openBrowserFn: url => opened.push(url),
  }))

  assert.equal(result.ok, true)
  assert.deepEqual(spawns.map(item => item.args), [
    ['run', 'server'],
    ['run', 'dev', '--', '--host', '127.0.0.1'],
  ])
  assert.ok(spawns.every(item => item.command === 'npm' && item.cwd === projectRoot && item.windowsHide))
  assert.deepEqual(opened, ['http://127.0.0.1:5173/'])
})

test('未知服务占用端口时拒绝启动且不打开浏览器', async () => {
  let spawned = false
  let opened = false
  const result = await runLauncher(baseOptions({
    fetchFn: async () => { throw new Error('非目标服务') },
    portOpenFn: async () => true,
    spawnFn: () => { spawned = true; return childStub() },
    openBrowserFn: () => { opened = true },
  }))

  assert.deepEqual(result, { ok: false, reason: 'unexpected_port_owner', service: 'API' })
  assert.equal(spawned, false)
  assert.equal(opened, false)
})

test('缺少依赖时给出失败结果且不启动进程', async () => {
  let spawned = false
  const result = await runLauncher(baseOptions({
    existsFn: () => false,
    spawnFn: () => { spawned = true; return childStub() },
  }))

  assert.deepEqual(result, { ok: false, reason: 'missing_dependencies' })
  assert.equal(spawned, false)
})

test('BAT 从自身目录隐藏启动 Node 启动器并包含前置检查', () => {
  const bat = readFileSync(path.join(projectRoot, '一键启动.bat'), 'utf8')
  assert.match(bat, /cd \/d "%~dp0"/)
  assert.match(bat, /where node\.exe/)
  assert.match(bat, /where npm\.cmd/)
  assert.match(bat, /node_modules/)
  assert.match(bat, /Start-Process.+scripts\/start-local\.mjs.+WindowStyle Hidden/)
})
