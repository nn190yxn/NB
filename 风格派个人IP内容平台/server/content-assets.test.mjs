import test from 'node:test'
import assert from 'node:assert/strict'
import { crossPlatformCollectionNames, normalizeCrossPlatformState, normalizeMaterialRecord } from './content-assets.mjs'

test('legacy materials receive cross-platform source and parse defaults', () => {
  const legacy = { id: 1, name: '旧素材', status: 'ready', source_path: 'notes/a.md' }
  assert.deepEqual(normalizeMaterialRecord(legacy), {
    ...legacy,
    owner_id: 'demo-user',
    source_type: 'local_sync',
    source_id: null,
    device_id: null,
    source_deleted_at: null,
    parse_status: 'ready',
    review_status: 'pending',
  })
})

test('explicit material ownership and lifecycle fields are preserved', () => {
  const material = {
    id: 2,
    owner_id: 'user-b',
    status: 'failed',
    source_type: 'research',
    source_id: 88,
    source_path: null,
    device_id: 'device-1',
    source_deleted_at: '2026-09-01T00:00:00.000Z',
    parse_status: 'processing',
    review_status: 'approved',
  }
  assert.deepEqual(normalizeMaterialRecord(material), material)
})

test('cross-platform state migration adds every new collection without mutating input', () => {
  const legacy = { materials: [{ id: 1, status: 'failed' }], shooting: [{ id: 2, status: 'todo' }] }
  const snapshot = structuredClone(legacy)
  const migrated = normalizeCrossPlatformState(legacy)
  assert.deepEqual(legacy, snapshot)
  for (const name of crossPlatformCollectionNames) assert.deepEqual(migrated[name], [])
  assert.equal(migrated.materials[0].parse_status, 'failed')
  assert.equal(migrated.shooting[0].status, 'ready_to_shoot')
})

test('state migration preserves explicit owners and assigns fallback owners only when absent', () => {
  const migrated = normalizeCrossPlatformState({
    devices: [{ id: 'same', owner_id: 'user-a' }, { id: 'other' }],
    performance_snapshots: [{ id: 1, owner_id: 'user-b', metrics: {} }],
  }, 'fallback-user')
  assert.equal(migrated.devices[0].owner_id, 'user-a')
  assert.equal(migrated.devices[1].owner_id, 'fallback-user')
  assert.equal(migrated.performance_snapshots[0].owner_id, 'user-b')
})

test('normalization is idempotent across legacy material states', () => {
  const statuses = ['ready', 'failed', 'queued', undefined]
  const sources = [undefined, null, 'folder/file.md']
  for (const status of statuses) {
    for (const source_path of sources) {
      const state = { materials: [{ id: 1, status, source_path }] }
      const once = normalizeCrossPlatformState(state)
      const twice = normalizeCrossPlatformState(once)
      assert.deepEqual(twice, once, `status=${status} source_path=${source_path}`)
      assert.doesNotThrow(() => JSON.parse(JSON.stringify(twice)))
    }
  }
})
