const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

function cleanText(value) { return String(value || '').replace(/\u0000/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }

function parseText(buffer) {
  const content = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || '')
  return content.trim()
}

function parseMarkdown(buffer) { return parseText(buffer) }

function parsePdf(buffer) {
  return cleanText(buffer.toString('latin1').replace(/\\\((.*?)\\\)/g, '$1').replace(/BT[\s\S]*?ET/g, match => match.replace(/\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?\s+Td/g, ' ')))
}

function parseWord(buffer) {
  const text = parseText(buffer)
  if (text.includes('<w:')) return cleanText(text)
  if (buffer.slice(0, 2).toString() === 'PK') throw new Error('DOCX 压缩包需要文档解析依赖')
  return cleanText(text)
}

function parseExcel(buffer) {
  const text = parseText(buffer)
  if (!text) return ''
  try {
    const rows = JSON.parse(text)
    if (Array.isArray(rows)) return rows.map(row => Array.isArray(row) ? row.join(' | ') : Object.values(row || {}).join(' | ')).join('\n').trim()
  } catch {}
  if (text.includes(',') || text.includes('\t') || text.includes('\n')) return text.split(/\r?\n/).map(row => row.split(/,|\t/).join(' | ')).join('\n').trim()
  throw new Error('Excel 内容需要 CSV、TSV 或 JSON 行数组')
}

export const documentAdapters = Object.freeze({ txt: parseText, text: parseText, markdown: parseMarkdown, word: parseWord, pdf: parsePdf, excel: parseExcel })

export function parseDocument({ format, buffer, content = '' }) {
  const input = buffer ?? Buffer.from(String(content), 'utf8')
  if (!Buffer.isBuffer(input) || input.length > MAX_DOCUMENT_BYTES) throw new Error('文件为空或超过 10MB 限制')
  const adapter = documentAdapters[format]
  if (!adapter) throw new Error(`不支持的文档格式: ${format}`)
  const text = adapter(input)
  if (!text) throw new Error('文档没有可提取的正文')
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  return { status: 'ready', content: text, extracted_fields: { segments: lines.slice(0, 8), candidate_topics: lines.filter(line => line.length >= 8).slice(0, 5), quotes: lines.filter(line => line.length >= 12).slice(0, 5) }, error: null }
}

export function parseSyncJob(job) {
  const startedAt = new Date().toISOString()
  try {
    const buffer = job.content_base64 ? Buffer.from(job.content_base64, 'base64') : Buffer.from(job.content || '', 'utf8')
    return { ...parseDocument({ format: job.name.toLowerCase().endsWith('.md') ? 'markdown' : job.name.toLowerCase().endsWith('.txt') ? 'txt' : job.name.toLowerCase().endsWith('.pdf') ? 'pdf' : ['.doc', '.docx'].some(ext => job.name.toLowerCase().endsWith(ext)) ? 'word' : 'excel', buffer }), status: 'ready', started_at: startedAt, finished_at: new Date().toISOString() }
  } catch (error) {
    return { status: 'failed', content: '', extracted_fields: { segments: [], candidate_topics: [], quotes: [] }, error: error instanceof Error ? error.message : '文档解析失败', started_at: startedAt, finished_at: new Date().toISOString() }
  }
}

export const documentParserLimits = Object.freeze({ maxBytes: MAX_DOCUMENT_BYTES })
