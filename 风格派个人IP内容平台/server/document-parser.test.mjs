import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDocument, parseSyncJob } from './document-parser.mjs'

test('文档解析适配器提取 TXT、Markdown、PDF、Word 和 CSV 内容', () => {
  assert.equal(parseDocument({ format: 'txt', content: '第一行\n第二行' }).status, 'ready')
  assert.match(parseDocument({ format: 'markdown', content: '# 标题\n正文内容' }).content, /标题/)
  assert.match(parseDocument({ format: 'pdf', buffer: Buffer.from('BT (PDF title) ET', 'latin1') }).content, /PDF title/)
  assert.match(parseDocument({ format: 'word', content: '<w:p>Word 内容</w:p>' }).content, /Word 内容/)
  assert.match(parseDocument({ format: 'excel', content: '姓名,观点\n小明,坚持练习' }).content, /姓名 \| 观点/)
})

test('解析失败只影响当前任务并返回失败状态', () => {
  const result = parseSyncJob({ name: 'broken.xlsx', content_base64: Buffer.from('not-a-table').toString('base64') })
  assert.equal(result.status, 'failed')
  assert.match(result.error, /Excel/)
})

test('同步任务使用 Base64 解析并生成候选字段', () => {
  const result = parseSyncJob({ name: 'ideas.txt', content_base64: Buffer.from('一个足够长的选题\n这是一个值得引用的金句内容').toString('base64') })
  assert.equal(result.status, 'ready')
  assert.ok(result.extracted_fields.candidate_topics.length)
  assert.ok(result.extracted_fields.quotes.length)
})
