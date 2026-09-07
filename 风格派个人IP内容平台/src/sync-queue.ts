export type SyncFileEvent = {
  path: string
  name?: string
  content?: string
  checksum?: string
  type?: 'changed' | 'deleted'
}

let storageKey: string | null = null
export function setSyncAccount(account: string | null) { storageKey = account ? `content-ip-sync-queue:${encodeURIComponent(account)}` : null }

function readQueue(): SyncFileEvent[] {
  if (!storageKey || typeof localStorage === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(storageKey) || '[]')
  } catch {
    return []
  }
}

function writeQueue(queue: SyncFileEvent[]) {
  if (!storageKey || typeof localStorage === 'undefined') return
  localStorage.setItem(storageKey, JSON.stringify(queue))
}

export function enqueueSyncEvents(events: SyncFileEvent[]) {
  if (!storageKey) throw new Error('请先登录再使用离线同步')
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
  const accountKey = storageKey
  const files = readQueue()
  if (!files.length) return { results: [] }
  const session = await fetch('/api/auth/session', { credentials: 'include' })
  const identity = await session.json()
  if (!session.ok || !identity.user_id || accountKey !== `content-ip-sync-queue:${encodeURIComponent(identity.user_id)}`) throw new Error('账号已变更，请刷新后再同步')
  const response = await fetch('/api/materials/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_id: deviceId, files }) })
  if (!response.ok) throw new Error(`同步失败: ${response.status}`)
  const result = await response.json()
  const failed = new Set(result.results.filter((item: { status: string }) => item.status === 'failed').map((item: { name: string }) => item.name))
  if (storageKey !== accountKey) return result
  writeQueue(files.filter(file => failed.has(file.name || file.path)))
  return result
}
