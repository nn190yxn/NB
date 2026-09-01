import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync, writeFileSync, watch } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { createHash } from 'node:crypto'

const supportedExtensions = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.md', '.markdown', '.txt'])

export function loadSyncConfig(file) {
  if (!existsSync(file)) return { directories: [], device_id: 'desktop-device' }
  return JSON.parse(readFileSync(file, 'utf8'))
}

export function saveSyncConfig(file, config) {
  writeFileSync(file, `${JSON.stringify({ directories: [...new Set(config.directories || [])], device_id: config.device_id || 'desktop-device' }, null, 2)}\n`)
}

export function readSyncFile(root, filePath) {
  const content = readFileSync(filePath)
  return { name: basename(filePath), path: relative(root, filePath), content: content.toString('utf8'), content_base64: content.toString('base64'), checksum: createHash('sha256').update(content).digest('hex') }
}

export function isSupportedSyncFile(filePath) { return supportedExtensions.has(extname(String(filePath)).toLowerCase()) }

export function validateSyncDirectory(root) {
  if (!existsSync(root)) return { ok: false, status: 'path_missing', error: '路径不存在' }
  try {
    if (!statSync(root).isDirectory()) return { ok: false, status: 'path_missing', error: '路径不是文件夹' }
    accessSync(root, constants.R_OK)
    return { ok: true, status: 'watching', error: null }
  } catch {
    return { ok: false, status: 'permission_denied', error: '无读取权限' }
  }
}

export function scanSyncDirectory(root) {
  const files = []
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && isSupportedSyncFile(path)) files.push(readSyncFile(root, path))
    }
  }
  visit(root)
  return files
}

export function mergeSyncEvent(queue, event) {
  const key = event.path || event.name
  const index = queue.findIndex(item => (item.path || item.name) === key)
  if (index < 0) return [...queue, event]
  const next = [...queue]
  next[index] = event
  return next
}

export function loadSyncQueue(file) {
  if (!existsSync(file)) return []
  const value = JSON.parse(readFileSync(file, 'utf8'))
  return Array.isArray(value) ? value : []
}

export function saveSyncQueue(file, queue) { writeFileSync(file, `${JSON.stringify(queue, null, 2)}\n`) }

export function enqueueSyncEvent(file, event) {
  const queue = mergeSyncEvent(loadSyncQueue(file), event)
  saveSyncQueue(file, queue)
  return queue
}


export async function drainSyncQueue(file, baseUrl, deviceId, fetcher = fetch, cookie = '') {
  const queue = loadSyncQueue(file)
  if (!queue.length) return { results: [], remaining: [] }
  const result = await submitSyncBatch(baseUrl, deviceId, queue, fetcher, cookie)
  const failed = new Set((result.results || []).filter(item => item.status === 'failed').map(item => item.path || item.name))
  const remaining = queue.filter(item => failed.has(item.path || item.name))
  saveSyncQueue(file, remaining)
  return { ...result, remaining }
}

export function watchDirectory(root, onChange, { stabilityMs = 250 } = {}) {
  const timers = new Map()
  return watch(root, { recursive: true }, (_event, filename) => {
    if (!filename || !isSupportedSyncFile(filename)) return
    const filePath = `${root}/${filename}`
    clearTimeout(timers.get(filePath))
    timers.set(filePath, setTimeout(() => {
      timers.delete(filePath)
      onChange(existsSync(filePath) ? readSyncFile(root, filePath) : { name: basename(filePath), path: relative(root, filePath), content_base64: '', type: 'deleted' })
    }, stabilityMs))
  })
}

export async function submitSyncBatch(baseUrl, deviceId, files, fetcher = fetch, cookie = '') {
  const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/api/materials/sync`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ device_id: deviceId, files }) })
  if (!response.ok) throw new Error(`同步失败: ${response.status}`)
  return response.json()
}
