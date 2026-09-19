export type SyncFileEvent = {
  path: string
  name?: string
  content?: string
  checksum?: string
  type?: 'changed' | 'deleted'
}

let storageKey: string | null = null
export function setSyncAccount(account: string | null) { storageKey = account ? `content-ip-sync-queue:${encodeURIComponent(account)}` : null }

// 读的结果要分三样：能用的事件、原始字节、是不是读坏了。
// 以前只返回数组，**「读坏」和「本来就是空的」长得一模一样**——紧接着的一次写入
// 就把那些看不懂的字节覆盖掉了，待同步的记录就此消失（审计 25.5 的「离线队列读坏」）。
type QueueRead = { events: SyncFileEvent[]; raw: string | null; damaged: boolean }

const emptyRead: QueueRead = { events: [], raw: null, damaged: false }

// 不是事件的垃圾（null、字符串、没有 path 的对象）混在数组里时，照样按「读坏」算：
// 丢掉它们可以，但原始字节必须先留底。
function isSyncFileEvent(value: unknown): value is SyncFileEvent {
  return Boolean(value) && typeof value === 'object' && typeof (value as SyncFileEvent).path === 'string' && (value as SyncFileEvent).path.length > 0
}

function readQueue(): QueueRead {
  if (!storageKey || typeof localStorage === 'undefined') return emptyRead
  const raw = localStorage.getItem(storageKey)
  if (!raw) return emptyRead
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return { events: [], raw, damaged: true }
    const events = parsed.filter(isSyncFileEvent)
    return events.length === parsed.length ? { events, raw: null, damaged: false } : { events, raw, damaged: true }
  } catch {
    return { events: [], raw, damaged: true }
  }
}

// 读坏的原样留一份。宁可留着看不懂的字节，也不能让待同步的记录凭空消失。
// 留不下的唯一情况是浏览器存储满：这时返回 false，调用方**不许覆盖**。
function keepDamagedCopy(raw: string, reason: string) {
  try {
    localStorage.setItem(`${storageKey}:damaged`, JSON.stringify({ reason, at: new Date().toISOString(), raw }))
    return true
  } catch {
    return false
  }
}

function writeQueue(queue: SyncFileEvent[]) {
  if (!storageKey || typeof localStorage === 'undefined') return
  localStorage.setItem(storageKey, JSON.stringify(queue))
}

export function enqueueSyncEvents(events: SyncFileEvent[]) {
  if (!storageKey) throw new Error('请先登录再使用离线同步')
  const read = readQueue()
  // 写之前先留底：读坏的那些字节里可能就是待同步的记录。
  if (read.damaged && read.raw !== null && !keepDamagedCopy(read.raw, '入队时发现本地队列读坏')) {
    throw new Error('本地待同步记录读坏了，且备份失败（可能是浏览器存储已满），为避免丢掉记录，这次没有写入')
  }
  const byPath = new Map(read.events.map(event => [event.path, event]))
  for (const event of events) {
    if (event.path) byPath.set(event.path, event.type === 'deleted' ? { ...event, content: '' } : event)
  }
  const next = [...byPath.values()]
  writeQueue(next)
  return next.length
}

export function pendingSyncEvents() {
  return readQueue().events
}

export async function flushSyncQueue(deviceId = 'browser-device') {
  const accountKey = storageKey
  const read = readQueue()
  const files = read.events
  if (!files.length) {
    // 没有可用事件时不写回——读坏的原样留着（顺手留一份备份，好找）。
    if (read.damaged && read.raw !== null) keepDamagedCopy(read.raw, '同步时发现本地队列读坏')
    return { results: [] }
  }
  const session = await fetch('/api/auth/session', { credentials: 'include' })
  const identity = await session.json()
  if (!session.ok || !identity.user_id || accountKey !== `content-ip-sync-queue:${encodeURIComponent(identity.user_id)}`) throw new Error('账号已变更，请刷新后再同步')
  const response = await fetch('/api/materials/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_id: deviceId, files }) })
  if (!response.ok) throw new Error(`同步失败: ${response.status}`)
  const result = await response.json()
  const failed = new Set(result.results.filter((item: { status: string }) => item.status === 'failed').map((item: { name: string }) => item.name))
  if (storageKey !== accountKey) return result
  // 回写是「用合法事件覆盖整个存储」，所以读坏时同样要先留底，否则没同步成功的记录会跟着一起没。
  if (read.damaged && read.raw !== null && !keepDamagedCopy(read.raw, '同步回写时发现本地队列读坏')) throw new Error('本地待同步记录读坏了，且备份失败（可能是浏览器存储已满），为避免丢掉记录，这次没有回写')
  writeQueue(files.filter(file => failed.has(file.name || file.path)))
  return result
}
