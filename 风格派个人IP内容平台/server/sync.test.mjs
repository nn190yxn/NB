import test from 'node:test'
import assert from 'node:assert/strict'
import { checksumForFile, coalesceFileEvents, createSyncQueue } from './sync.mjs'

test('coalesces repeated file changes and preserves deletions', () => {
  const events = coalesceFileEvents([
    { path: 'notes/a.md', type: 'changed', content: 'old' },
    { path: 'notes/a.md', type: 'changed', content: 'new' },
    { path: 'notes/b.md', type: 'deleted', content: 'gone' },
  ])
  assert.equal(events.length, 2)
  assert.equal(events.find(event => event.path === 'notes/a.md').content, 'new')
  assert.equal(events.find(event => event.path === 'notes/b.md').type, 'deleted')
})

test('creates stable checksums and drains a device queue', () => {
  const file = { path: 'a.md', content: 'hello' }
  assert.equal(checksumForFile(file), checksumForFile(file))
  const queue = createSyncQueue('laptop')
  assert.equal(queue.enqueue([file]), 1)
  assert.equal(queue.size(), 1)
  assert.equal(queue.drain()[0].device_id, 'laptop')
  assert.equal(queue.size(), 0)
})
