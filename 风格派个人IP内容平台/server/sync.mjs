import { createHash } from 'node:crypto'

export function checksumForFile(file) {
  return file.checksum || createHash('sha256').update(`${file.path || file.name || ''}:${file.content || ''}`).digest('hex')
}

export function coalesceFileEvents(events) {
  const byPath = new Map()
  for (const event of events) {
    if (!event?.path) continue
    if (event.type === 'deleted') {
      byPath.set(event.path, { ...event, content: '' })
      continue
    }
    byPath.set(event.path, { ...event, type: 'changed', checksum: checksumForFile(event) })
  }
  return [...byPath.values()]
}

export function createSyncQueue(deviceId = 'local-device') {
  const queue = []
  return {
    enqueue(events) {
      queue.push(...coalesceFileEvents(events).map(event => ({ ...event, device_id: deviceId, queued_at: new Date().toISOString() })))
      return queue.length
    },
    drain() {
      const batch = queue.splice(0, queue.length)
      return batch
    },
    size() {
      return queue.length
    },
  }
}
