import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve, sep } from 'node:path'

const typeRules = {
  '.txt': { mimes: ['text/plain'], kind: 'text' },
  '.md': { mimes: ['text/markdown', 'text/plain'], kind: 'text' },
  '.csv': { mimes: ['text/csv', 'text/plain'], kind: 'text' },
  '.pdf': { mimes: ['application/pdf'], kind: 'pdf' },
  '.docx': { mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], kind: 'zip' },
  '.xlsx': { mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], kind: 'zip' },
  '.png': { mimes: ['image/png'], kind: 'png' },
  '.jpg': { mimes: ['image/jpeg'], kind: 'jpeg' },
  '.jpeg': { mimes: ['image/jpeg'], kind: 'jpeg' },
  '.webp': { mimes: ['image/webp'], kind: 'webp' },
}

export function sanitizeFileName(value) {
  const raw = String(value || '').replaceAll('\\', '/')
  const name = basename(raw).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').slice(0, 180)
  if (!name || name === '.' || name === '..') throw new Error('文件名无效')
  return name
}

export function validatePrivateFile({ fileName, mimeType, content, maxBytes = 25 * 1024 * 1024 }) {
  if (!Buffer.isBuffer(content) || !content.length) throw new Error('文件内容不能为空')
  if (content.length > maxBytes) throw new Error(`文件超过 ${maxBytes} 字节限制`)
  const safeName = sanitizeFileName(fileName)
  const extension = extname(safeName).toLowerCase()
  const rule = typeRules[extension]
  const normalizedMime = String(mimeType || '').split(';', 1)[0].trim().toLowerCase()
  if (!rule || !rule.mimes.includes(normalizedMime)) throw new Error('文件扩展名或 MIME 类型不受支持')
  const signatures = {
    pdf: content.subarray(0, 5).toString() === '%PDF-',
    zip: content[0] === 0x50 && content[1] === 0x4b && [0x03, 0x05, 0x07].includes(content[2]) && [0x04, 0x06, 0x08].includes(content[3]),
    png: content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    jpeg: content[0] === 0xff && content[1] === 0xd8 && content.at(-2) === 0xff && content.at(-1) === 0xd9,
    webp: content.subarray(0, 4).toString() === 'RIFF' && content.subarray(8, 12).toString() === 'WEBP',
    text: !content.includes(0) && !content.subarray(0, Math.min(content.length, 4096)).toString('utf8').includes('\uFFFD'),
  }
  if (!signatures[rule.kind]) throw new Error('文件内容与声明类型不一致')
  return { safeName, extension, mimeType: normalizedMime, size: content.length, checksum: createHash('sha256').update(content).digest('hex') }
}

function safeOwnerSegment(ownerId) {
  return createHash('sha256').update(String(ownerId)).digest('hex').slice(0, 24)
}

export function storageRelativePath(ownerId, checksum, extension, now = new Date()) {
  return [safeOwnerSegment(ownerId), String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), String(now.getUTCDate()).padStart(2, '0'), `${checksum}${extension}`].join('/')
}

export function resolvePrivatePath(root, relativePath) {
  const rootPath = resolve(root)
  const target = resolve(rootPath, String(relativePath).replaceAll('/', sep))
  if (target !== rootPath && !target.startsWith(`${rootPath}${sep}`)) throw new Error('文件路径越界')
  return target
}

export function storePrivateFile(root, ownerId, validated, content, now = new Date()) {
  const relativePath = storageRelativePath(ownerId, validated.checksum, validated.extension, now)
  const target = resolvePrivatePath(root, relativePath)
  mkdirSync(resolve(target, '..'), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 })
    try { renameSync(temporary, target) } catch (error) {
      if (error.code !== 'EEXIST') throw error
      unlinkSync(temporary)
    }
  } catch (error) {
    try { unlinkSync(temporary) } catch { /* temporary file may not exist */ }
    throw error
  }
  return relativePath
}

export function readPrivateFile(root, relativePath) {
  return readFileSync(resolvePrivatePath(root, relativePath))
}

export function publicPrivateFile(record) {
  const { storage_path: _storagePath, ...publicRecord } = record
  return publicRecord
}
