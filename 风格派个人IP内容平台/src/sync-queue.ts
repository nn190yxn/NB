export type SyncFileEvent = {
  path: string
  name?: string
  content?: string
  checksum?: string
  type?: 'changed' | 'deleted'
}

const storageKey = 'content-ip-sync-queue'

function readQueue(): SyncFileEvent[] {
  if (typeof localStorage === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(storageKey) || '[]')
  } catch {
    return []
  }
}

function writeQueue(queue: SyncFileEvent[]) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(storageKey, JSON.stringify(queue))
}

export function enqueueSyncEvents(events: SyncFileEvent[]) {
  const current = readQueue()
  const byPath = new Map(current.map(event => [event.path, event]))
  for (const event of events) {
    if (event.path) byPath.set(event.path, event.type === 'deleted' ? { ...event, content: '' } : event)
  }
  const next = [...byPath.values()]
  writeQueue(next)
  return next.length
}

export function pendingSyncEvents() {
  return readQueue()
}

export async function flushSyncQueue(deviceId = 'browser-device') {
  const files = readQueue()
  if (!files.length) return { results: [] }
  const response = await fetch('/api/materials/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_id: deviceId, files }) })
  if (!response.ok) throw new Error(`同步失败: ${response.status}`)
  const result = await response.json()
  const failed = new Set(result.results.filter((item: { status: string }) => item.status === 'failed').map((item: { name: string }) => item.name))
  writeQueue(files.filter(file => failed.has(file.name || file.path)))
  return result
}
