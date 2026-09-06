import { appendFileSync, existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentFile = fileURLToPath(import.meta.url)
const defaultRoot = path.resolve(path.dirname(currentFile), '..')
const defaultLogFile = path.join(defaultRoot, 'local-app.log')

export const services = [
  { name: 'API', port: 3001, healthUrl: 'http://127.0.0.1:3001/healthz', npmArgs: ['run', 'server'], responseType: 'api' },
  { name: 'VITE', port: 5173, healthUrl: 'http://127.0.0.1:5173/', npmArgs: ['run', 'dev', '--', '--host', '127.0.0.1'], responseType: 'frontend' },
]

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

export function sanitizeLog(value) {
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[_-]?key|password|token|secret)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]')
}

export function createLogger(logFile = defaultLogFile) {
  return (scope, message) => {
    const timestamp = new Date().toISOString()
    appendFileSync(logFile, `[${timestamp}] [${scope}] ${sanitizeLog(message)}\n`, 'utf8')
  }
}

export async function probeService(service, fetchFn = fetch, timeoutMs = 1200) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchFn(service.healthUrl, { signal: controller.signal })
    if (!response.ok) return false
    if (service.responseType === 'api') {
      const payload = await response.json()
      return payload?.status === 'ok'
    }
    const html = await response.text()
    return html.includes('id="root"') && html.includes('定位派')
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export function isPortOpen(port, host = '127.0.0.1', timeoutMs = 600) {
  return new Promise(resolve => {
    const socket = net.createConnection({ port, host })
    const finish = result => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function logStream(stream, scope, logger) {
  stream?.on('data', chunk => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) logger(scope, line)
    }
  })
}

export function buildNpmInvocation(npmCommand, args, commandShell = process.env.ComSpec || 'cmd.exe') {
  return npmCommand.toLowerCase().endsWith('.cmd')
    ? { command: commandShell, args: ['/d', '/s', '/c', npmCommand, ...args] }
    : { command: npmCommand, args }
}

export function launchService(service, { rootDir, logger, spawnFn = spawn, npmCommand, commandShell }) {
  const invocation = buildNpmInvocation(npmCommand, service.npmArgs, commandShell)
  logger('launcher', `正在启动 ${service.name}：${npmCommand} ${service.npmArgs.join(' ')}`)
  const child = spawnFn(invocation.command, invocation.args, {
    cwd: rootDir,
    env: process.env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  logStream(child.stdout, service.name, logger)
  logStream(child.stderr, service.name, logger)
  child.on?.('error', error => logger(service.name, `启动失败：${error.message}`))
  child.on?.('exit', code => logger(service.name, `进程已退出，退出码：${code ?? 'unknown'}`))
  return child
}

export async function waitForService(service, { fetchFn = fetch, logger, attempts = 40, intervalMs = 500 }) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await probeService(service, fetchFn)) {
      logger('launcher', `${service.name} 已就绪`)
      return true
    }
    if (attempt < attempts) await sleep(intervalMs)
  }
  logger('launcher', `${service.name} 启动超时`)
  return false
}

export function openDefaultBrowser(url, spawnFn = spawn) {
  const child = spawnFn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'start', '""', url], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref?.()
}

export async function runLauncher(options = {}) {
  const rootDir = options.rootDir || defaultRoot
  const logger = options.logger || createLogger(options.logFile || path.join(rootDir, 'local-app.log'))
  const exists = options.existsFn || existsSync
  const fetchFn = options.fetchFn || fetch
  const portOpen = options.portOpenFn || isPortOpen
  const spawnFn = options.spawnFn || spawn
  const npmCommand = options.npmCommand || (process.platform === 'win32' ? 'npm.cmd' : 'npm')
  const commandShell = options.commandShell || process.env.ComSpec || 'cmd.exe'
  const npmAvailable = options.npmAvailableFn || (() => {
    const invocation = buildNpmInvocation(npmCommand, ['--version'], commandShell)
    return spawnSync(invocation.command, invocation.args, { windowsHide: true, stdio: 'ignore' }).status === 0
  })
  const openBrowser = options.openBrowserFn || (url => openDefaultBrowser(url))
  const waitOptions = options.waitOptions || {}

  logger('launcher', '========== 本地应用启动 ==========')
  if (!exists(path.join(rootDir, 'node_modules'))) {
    logger('launcher', '缺少 node_modules，请先在项目目录运行 npm install')
    return { ok: false, reason: 'missing_dependencies' }
  }
  if (!npmAvailable()) {
    logger('launcher', '找不到 npm，请确认 Node.js 已正确安装并加入 PATH')
    return { ok: false, reason: 'missing_npm' }
  }

  const status = {}
  for (const service of services) {
    const healthy = await probeService(service, fetchFn)
    if (healthy) {
      status[service.name] = 'reused'
      logger('launcher', `${service.name} 已运行，直接复用`)
      continue
    }
    if (await portOpen(service.port)) {
      logger('launcher', `${service.port} 端口已被其他服务占用，且未通过 ${service.name} 健康检查`)
      return { ok: false, reason: 'unexpected_port_owner', service: service.name }
    }
    launchService(service, { rootDir, logger, spawnFn, npmCommand, commandShell })
    status[service.name] = 'started'
  }

  const readiness = await Promise.all(services.map(service => waitForService(service, { fetchFn, logger, ...waitOptions })))
  if (readiness.some(ready => !ready)) return { ok: false, reason: 'startup_timeout', status }

  const frontendUrl = services.find(service => service.responseType === 'frontend').healthUrl
  openBrowser(frontendUrl)
  logger('launcher', `已打开 ${frontendUrl}`)
  return { ok: true, status, url: frontendUrl }
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runLauncher().catch(error => {
    createLogger()("launcher", `未处理错误：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
