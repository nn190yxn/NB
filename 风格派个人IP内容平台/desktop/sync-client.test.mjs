import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSyncConfig, saveSyncConfig, readSyncFile, submitSyncBatch } from './sync-client.mjs'

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
