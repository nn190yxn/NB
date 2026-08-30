import { existsSync, readFileSync, writeFileSync, watch } from 'node:fs'
import { basename, extname, relative } from 'node:path'
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
  return { name: basename(filePath), path: relative(root, filePath), content: content.toString('utf8'), checksum: createHash('sha256').update(content).digest('hex') }
}

export function watchDirectory(root, onChange) {
  return watch(root, { recursive: true }, (_event, filename) => {
    if (!filename || !supportedExtensions.has(extname(String(filename)).toLowerCase())) return
    const filePath = `${root}/${filename}`
    onChange(existsSync(filePath) ? readSyncFile(root, filePath) : { name: basename(filePath), path: relative(root, filePath), content: '', type: 'deleted' })
  })
}

export async function submitSyncBatch(baseUrl, deviceId, files, fetcher = fetch) {
  const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/api/materials/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_id: deviceId, files }) })
  if (!response.ok) throw new Error(`同步失败: ${response.status}`)
  return response.json()
}
