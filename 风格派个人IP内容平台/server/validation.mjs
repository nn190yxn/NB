export function validRatios(ratios) {
  return ratios && Object.values(ratios).length === 3 && Object.values(ratios).every(value => Number.isInteger(value) && value >= 0) && Object.values(ratios).reduce((sum, value) => sum + value, 0) === 100
}

export function validateMaterialInput(body) {
  if (body.name !== undefined && (typeof body.name !== 'string' || body.name.length > 200)) return '素材名称长度必须在 200 个字符以内'
  if (body.content !== undefined && (typeof body.content !== 'string' || body.content.length > 2_000_000)) return '素材正文长度超过限制'
  if (body.format !== undefined && !['pdf', 'word', 'excel', 'markdown', 'txt', 'url', 'text'].includes(body.format)) return '不支持的素材格式'
  return null
}

export function normalizeMaterialFormat(name = '', format = '') {
  if (format) return format
  const extension = String(name).toLowerCase().split('.').pop()
  return ({ md: 'markdown', markdown: 'markdown', txt: 'txt', pdf: 'pdf', doc: 'word', docx: 'word', xls: 'excel', xlsx: 'excel' })[extension] || 'text'
}

// 浏览器上传（readAsText）只能交出文本，PDF/DOCX/XLSX 会变成二进制乱码。
// 这类内容必须在入口拦下，否则乱码会被当成「已解析正文」以 ready 状态静默入库。
// 判据用实测过的信号：压缩包魔数 PK\x03\x04、NUL 字节、%PDF 头、解码乱码字符占比。
function binaryUploadError(text) {
  if (/^PK[\u0001-\u0008]/.test(text)) return '这是压缩格式的 Office 文件（DOCX/XLSX 等），浏览器上传只能读取纯文本；请另存为 .txt 或 .md 后重新上传'
  if (text.includes('%PDF')) return '这是 PDF 文件的二进制内容，浏览器上传只能读取纯文本；请先导出为 .txt 或 .md 后重新上传'
  const replacement = (text.match(/\uFFFD/g) || []).length
  if (text.includes('\u0000') || (replacement >= 10 && replacement / text.length > 0.05)) return '文件不是可读文本（解码后出现大量乱码字符），请另存为 .txt 或 .md 后重新上传'
  return ''
}

export function parseMaterialContent({ format, content = '', url = null }) {
  if (format === 'url') return url ? { status: 'ready', content: String(content || url), error: null } : { status: 'failed', content: '', error: '网页素材缺少 URL' }
  if (!String(content).trim()) return { status: 'failed', content: '', error: '素材缺少可解析正文，请补充正文后重试' }
  const text = String(content)
  const binaryError = binaryUploadError(text)
  if (binaryError) return { status: 'failed', content: text, error: binaryError }
  if (format === 'excel') {
    try {
      const rows = JSON.parse(text)
      if (Array.isArray(rows)) return { status: 'ready', content: rows.map(row => Array.isArray(row) ? row.join(' | ') : Object.values(row || {}).join(' | ')).join('\n'), error: null }
    } catch {
      if (text.includes(',') || text.includes('\t')) return { status: 'ready', content: text.replace(/\t/g, ' | '), error: null }
    }
    return { status: 'failed', content: text, error: 'Excel 内容需要 JSON 行数组或 CSV 文本' }
  }
  if (format === 'pdf' || format === 'word') return { status: 'ready', content: text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), error: null }
  return { status: 'ready', content: text, error: null }
}

export function validateSourceRefs(sourceRefs) {
  return Array.isArray(sourceRefs) && sourceRefs.every(ref => Boolean(ref && typeof ref.type === 'string' && ref.type.trim() && (typeof ref.id === 'string' || typeof ref.id === 'number')))
}

export function profileGaps(profile) {
  const gaps = []
  if (!String(profile?.role || '').trim()) gaps.push('role')
  if (!Array.isArray(profile?.audiences) || !profile.audiences.length) gaps.push('audiences')
  if (!Array.isArray(profile?.pillars) || !profile.pillars.length) gaps.push('pillars')
  return gaps
}

export const factCheckStatuses = new Set(['needs_review', 'verified', 'rejected'])

export function validateDraftUpdate(body, current) {
  if (body.fact_check_status !== undefined && !factCheckStatuses.has(body.fact_check_status)) return '不支持的事实核验状态'
  if (body.status === 'published' && (body.fact_check_status || current.fact_check_status) !== 'verified') return '发布前必须完成事实核验'
  if (body.source_refs !== undefined && !validateSourceRefs(body.source_refs)) return '来源引用格式无效'
  if (body.source_refs !== undefined && body.source_refs.length === 0 && current.source_refs?.length) return '草稿必须保留来源引用'
  return null
}
