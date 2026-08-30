import test from 'node:test'
import assert from 'node:assert/strict'
import { createRedFoxAdapter, normalizeResearchItem } from './redfox.mjs'

test('RedFox 响应归一化并保留原始载荷', async () => {
  const item = normalizeResearchItem({ title: '测试热点', comments: 12, source_url: 'https://example.com/item' }, { platform: '抖音', query: '测试' })
  assert.deepEqual(item.metrics, { discussions: 12, growth: 0 })
  assert.equal(item.platform, '抖音')
  assert.equal(item.raw_payload.title, '测试热点')
})

test('RedFox 额度不足返回可识别错误', async () => {
  const adapter = createRedFoxAdapter({ baseUrl: 'https://redfox.example', apiKey: 'test-key', fetchImpl: async () => ({ ok: false, status: 429 }) })
  await assert.rejects(() => adapter.trending(), error => error.code === 'QUOTA_EXCEEDED' && error.retryable === true && error.message === 'RedFox 额度不足')
})

test('RedFox 不可用返回可重试错误', async () => {
  const adapter = createRedFoxAdapter({ baseUrl: 'https://redfox.example', apiKey: 'test-key', fetchImpl: async () => { throw new Error('连接失败') } })
  await assert.rejects(() => adapter.trending(), error => error.code === 'UPSTREAM_UNAVAILABLE' && error.retryable === true)
})

test('RedFox 无效响应返回可重试错误', async () => {
  const adapter = createRedFoxAdapter({ baseUrl: 'https://redfox.example', apiKey: 'test-key', fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid response') } }) })
  await assert.rejects(() => adapter.trending(), error => error.code === 'UPSTREAM_ERROR' && error.retryable === true && error.message === 'RedFox 返回了无效数据')
})
