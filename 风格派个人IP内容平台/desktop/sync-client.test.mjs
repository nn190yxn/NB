import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drainSyncQueue, loadSyncConfig, loadSyncQueue, mergeSyncEvent, saveSyncConfig, saveSyncQueue, readSyncFile, scanSyncDirectory, submitSyncBatch, validateSyncDirectory } from './sync-client.mjs'

test('desktop sync client persists directories and creates checksummed manifests', () => {
  const root = mkdtempSync(join(tmpdir(), 'content-ip-desktop-'))
  const configFile = join(root, 'sync.json')
  saveSyncConfig(configFile, { directories: [root, root], device_id: 'workstation' })
  assert.deepEqual(loadSyncConfig(configFile), { directories: [root], device_id: 'workstation' })
  const source = join(root, 'note.md')
  writeFileSync(source, '# 记录')
  const manifest = readSyncFile(root, source)
  assert.equal(manifest.path, 'note.md')
  assert.ok(manifest.checksum)
  assert.equal(manifest.content, readFileSync(source, 'utf8'))
  assert.equal(Buffer.from(manifest.content_base64, 'base64').toString('utf8'), '# 记录')
})

test('desktop sync validates paths and scans only supported files', () => {
  const root = mkdtempSync(join(tmpdir(), 'content-ip-scan-'))
  mkdirSync(join(root, 'nested'))
  writeFileSync(join(root, 'nested', 'note.md'), '# 素材')
  writeFileSync(join(root, 'skip.exe'), 'no')
  assert.deepEqual(validateSyncDirectory(join(root, 'missing')).status, 'path_missing')
  assert.equal(validateSyncDirectory(root).status, 'watching')
  assert.deepEqual(scanSyncDirectory(root).map(item => item.path), [join('nested', 'note.md')])
})

test('desktop sync queue merges by relative path and drains only failed items', async () => {
  const root = mkdtempSync(join(tmpdir(), 'content-ip-queue-'))
  const queueFile = join(root, 'queue.json')
  saveSyncQueue(queueFile, mergeSyncEvent(mergeSyncEvent([], { path: 'note.md', checksum: 'old' }), { path: 'note.md', checksum: 'new' }))
  assert.equal(loadSyncQueue(queueFile)[0].checksum, 'new')
  const result = await drainSyncQueue(queueFile, 'http://localhost:3001', 'workstation', async () => ({ ok: true, async json() { return { results: [{ path: 'note.md', status: 'failed' }] } } }))
  assert.equal(result.remaining.length, 1)
})

test('desktop sync client submits a device batch through the API contract', async () => {
  let request
  const result = await submitSyncBatch('http://localhost:3001/', 'workstation', [{ path: 'note.md' }], async (url, options) => {
    request = { url, options }
    return { ok: true, async json() { return { results: [{ status: 'queued' }] } } }
  })
  assert.equal(request.url, 'http://localhost:3001/api/materials/sync')
  assert.equal(JSON.parse(request.options.body).device_id, 'workstation')
  assert.equal(result.results[0].status, 'queued')
})
