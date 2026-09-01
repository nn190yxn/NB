import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let nextPort = 3700 + Math.floor(Math.random() * 120)
function startServer() {
  const port = nextPort++
  const baseUrl = `http://127.0.0.1:${port}`
  const directory = mkdtempSync(join(tmpdir(), 'private-api-'))
  const dataFile = join(directory, 'data.json')
  const fileRoot = join(directory, 'files')
  writeFileSync(dataFile, '{}')
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile, PRIVATE_FILE_ROOT: fileRoot, PRIVATE_FILE_MAX_BYTES: '1024' }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('私有文件 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve({ child, baseUrl, fileRoot }) } })
    child.once('error', reject)
  })
}
async function session(baseUrl, userId) {
  const response = await fetch(`${baseUrl}/api/auth/session`, { method: 'POST', headers: { 'x-user-id': userId } })
  return response.headers.get('set-cookie').split(';', 1)[0]
}

test('private upload deduplicates per user and supports authenticated preview/download', async t => {
  const { child, baseUrl, fileRoot } = await startServer(); t.after(() => child.kill())
  const cookie = await session(baseUrl, 'file-user-a')
  const content = Buffer.from('%PDF-1.7\naccount-private')
  const headers = { cookie, 'content-type': 'application/pdf', 'x-file-name': '../../account.pdf' }
  const uploaded = await fetch(`${baseUrl}/api/private-files`, { method: 'POST', headers, body: content })
  assert.equal(uploaded.status, 201)
  const record = await uploaded.json()
  assert.equal(record.original_name, 'account.pdf')
  assert.equal('storage_path' in record, false)
  assert.equal(record.size, content.length)
  assert.equal(existsSync(fileRoot), true)

  const duplicate = await fetch(`${baseUrl}/api/private-files`, { method: 'POST', headers, body: content })
  assert.equal(duplicate.status, 200)
  assert.equal((await duplicate.json()).duplicate, true)
  const preview = await fetch(`${baseUrl}/api/private-files/${record.id}/preview`, { headers: { cookie } })
  assert.equal(preview.status, 200)
  assert.equal(preview.headers.get('content-type'), 'application/pdf')
  assert.equal(await preview.arrayBuffer().then(buffer => Buffer.from(buffer).toString()), content.toString())
  const download = await fetch(`${baseUrl}/api/private-files/${record.id}/download`, { headers: { cookie } })
  assert.match(download.headers.get('content-disposition'), /^attachment;/)

  const otherCookie = await session(baseUrl, 'file-user-b')
  const forbidden = await fetch(`${baseUrl}/api/private-files/${record.id}/preview`, { headers: { cookie: otherCookie } })
  assert.equal(forbidden.status, 404)
})

test('private upload rejects forged MIME, oversized content and missing file name', async t => {
  const { child, baseUrl } = await startServer(); t.after(() => child.kill())
  const cookie = await session(baseUrl, 'file-user-security')
  const request = (name, mime, body) => fetch(`${baseUrl}/api/private-files`, { method: 'POST', headers: { cookie, 'content-type': mime, ...(name ? { 'x-file-name': name } : {}) }, body })
  assert.equal((await request('fake.png', 'image/png', Buffer.from('plain text'))).status, 422)
  assert.equal((await request('too.pdf', 'application/pdf', Buffer.alloc(1025, 1))).status, 422)
  assert.equal((await request('', 'application/pdf', Buffer.from('%PDF-1.7'))).status, 422)
})
