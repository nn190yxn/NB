import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolvePrivatePath, sanitizeFileName, storageRelativePath, storePrivateFile, validatePrivateFile } from './private-files.mjs'

const pdf = Buffer.from('%PDF-1.7\nprivate')
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])

test('file names are reduced to safe basenames and storage paths stay inside root', () => {
  assert.equal(sanitizeFileName('../../private.txt'), 'private.txt')
  assert.equal(sanitizeFileName('报告?.pdf'), '报告_.pdf')
  const root = mkdtempSync(join(tmpdir(), 'private-files-'))
  assert.throws(() => resolvePrivatePath(root, '../outside.txt'), /越界/)
  assert.match(storageRelativePath('user-a', 'a'.repeat(64), '.pdf'), /^[a-f0-9]{24}\/\d{4}\/\d{2}\/\d{2}\/[a-f0-9]{64}\.pdf$/)
})

test('supported files require matching MIME and content signature', () => {
  assert.deepEqual(validatePrivateFile({ fileName: 'report.pdf', mimeType: 'application/pdf', content: pdf }).mimeType, 'application/pdf')
  assert.deepEqual(validatePrivateFile({ fileName: 'screen.png', mimeType: 'image/png', content: png }).extension, '.png')
  assert.throws(() => validatePrivateFile({ fileName: 'fake.png', mimeType: 'image/png', content: Buffer.from('not an image') }), /不一致/)
  assert.throws(() => validatePrivateFile({ fileName: 'report.pdf', mimeType: 'text/plain', content: pdf }), /不受支持/)
  assert.throws(() => validatePrivateFile({ fileName: 'empty.txt', mimeType: 'text/plain', content: Buffer.alloc(0) }), /不能为空/)
})

test('private storage uses checksum file names and atomic content', () => {
  const root = mkdtempSync(join(tmpdir(), 'private-files-'))
  const validated = validatePrivateFile({ fileName: 'report.pdf', mimeType: 'application/pdf', content: pdf })
  const relative = storePrivateFile(root, 'user-a', validated, pdf)
  assert.deepEqual(readFileSync(join(root, ...relative.split('/'))), pdf)
  assert.match(relative, /report\.pdf|[a-f0-9]{64}\.pdf$/)
})
