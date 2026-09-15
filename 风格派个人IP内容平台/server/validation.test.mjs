import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMaterialFormat, parseMaterialContent, profileGaps, validRatios, validateDraftUpdate, validateMaterialInput, validateSourceRefs } from './validation.mjs'

test('策略比例必须恰好总和为 100', () => {
  assert.equal(validRatios({ reach: 50, trust: 30, conversion: 20 }), true)
  assert.equal(validRatios({ reach: 50, trust: 30, conversion: 30 }), false)
  assert.equal(validRatios({ reach: -1, trust: 51, conversion: 50 }), false)
})

test('素材输入校验格式和长度', () => {
  assert.equal(validateMaterialInput({ name: '复盘.md', format: 'markdown', content: '内容' }), null)
  assert.equal(validateMaterialInput({ format: 'exe' }), '不支持的素材格式')
  assert.equal(validateMaterialInput({ name: 'x'.repeat(201) }), '素材名称长度必须在 200 个字符以内')
})

test('来源引用必须有类型和标识', () => {
  assert.equal(validateSourceRefs([{ type: 'material', id: 1 }]), true)
  assert.equal(validateSourceRefs([{ type: 'material' }]), false)
})

test('素材格式可从文件名推断，解析失败可重试', () => {
  assert.equal(normalizeMaterialFormat('复盘.docx'), 'word')
  assert.deepEqual(parseMaterialContent({ format: 'txt', content: '' }), { status: 'failed', content: '', error: '素材缺少可解析正文，请补充正文后重试' })
  assert.deepEqual(parseMaterialContent({ format: 'url', url: 'https://example.com' }), { status: 'ready', content: 'https://example.com', error: null })
})

test('表格和文档内容使用可审计的文本归一化', () => {
  assert.equal(parseMaterialContent({ format: 'excel', content: JSON.stringify([{ name: 'A', score: 3 }]) }).content, 'A | 3')
  assert.equal(parseMaterialContent({ format: 'excel', content: 'name,score\nA,3' }).status, 'ready')
  assert.equal(parseMaterialContent({ format: 'word', content: '<p>真实过程</p>' }).content, '真实过程')
})

test('二进制文件不能被当成已解析正文静默入库', () => {
  // 浏览器用 readAsText 上传 DOCX/PDF 时，服务端拿到的就是这些二进制乱码。
  const zip = `PK\u0003\u0004${'\uFFFD'.repeat(200)}`
  assert.equal(parseMaterialContent({ format: 'word', content: zip }).status, 'failed')
  assert.match(parseMaterialContent({ format: 'word', content: zip }).error, /另存为 \.txt 或 \.md/)
  assert.equal(parseMaterialContent({ format: 'excel', content: zip }).status, 'failed')
  const pdf = `%PDF-1.4\u0000${'\uFFFD'.repeat(200)}`
  assert.match(parseMaterialContent({ format: 'pdf', content: pdf }).error, /PDF 文件的二进制内容/)
  const ole = `\u0000\u0001\uFFFD\uFFFD${'\uFFFD'.repeat(200)}`
  assert.equal(parseMaterialContent({ format: 'word', content: ole }).status, 'failed')
  // 乱码入库的内容仍保留在 content 里，便于排查与重试
  assert.equal(parseMaterialContent({ format: 'word', content: zip }).content, zip)
})

test('正常文本不会被二进制判据误伤', () => {
  assert.equal(parseMaterialContent({ format: 'markdown', content: 'PK 对决复盘：记录一次真实的对手分析过程。' }).status, 'ready')
  assert.equal(parseMaterialContent({ format: 'txt', content: '这是一段正常的中文复盘内容。' }).status, 'ready')
  // 少量坏字节不算乱码
  assert.equal(parseMaterialContent({ format: 'txt', content: `${'复盘内容。'.repeat(30)}\uFFFD\uFFFD` }).status, 'ready')
  assert.equal(parseMaterialContent({ format: 'word', content: '<p>真实过程</p>' }).status, 'ready')
})

test('IP 档案缺口检测返回生成所需字段', () => {
  assert.deepEqual(profileGaps({ role: '', audiences: [], pillars: [] }), ['role', 'audiences', 'pillars'])
  assert.deepEqual(profileGaps({ role: '顾问', audiences: ['创业者'], pillars: ['复盘'] }), [])
})

test('草稿发布需要已核验事实并保留来源', () => {
  const current = { fact_check_status: 'needs_review', source_refs: [{ type: 'material', id: 1 }] }
  assert.equal(validateDraftUpdate({ status: 'published' }, current), '发布前必须完成事实核验')
  assert.equal(validateDraftUpdate({ status: 'published', fact_check_status: 'verified' }, current), null)
  assert.equal(validateDraftUpdate({ source_refs: [] }, current), '草稿必须保留来源引用')
})
