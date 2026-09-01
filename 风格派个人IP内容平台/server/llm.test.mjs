import assert from 'node:assert/strict'
import test from 'node:test'
import { callLlmWithFallback, callVision, testApiCapability } from './llm.mjs'

test('主 API 成功时不调用备用 API', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response(JSON.stringify({ choices: [{ message: { content: 'primary-result' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }) }
  try {
    const result = await callLlmWithFallback({ primary: { base_url: 'https://primary.example/v1', api_key: 'a', model: 'm1' }, fallback: { base_url: 'https://fallback.example/v1', api_key: 'b', model: 'm2' } }, [{ role: 'user', content: 'test' }])
    assert.equal(result.content, 'primary-result')
    assert.deepEqual(calls, ['https://primary.example/v1/chat/completions'])
  } finally { globalThis.fetch = originalFetch }
})

test('主 API 失败时切换备用 API', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => { calls.push(String(url)); if (calls.length === 1) return new Response('{}', { status: 503 }); return new Response(JSON.stringify({ choices: [{ message: { content: 'fallback-result' } }] }), { status: 200 }) }
  try {
    const result = await callLlmWithFallback({ primary: { base_url: 'https://primary.example/v1', api_key: 'a', model: 'm1' }, fallback: { base_url: 'https://fallback.example/v1', api_key: 'b', model: 'm2' } }, [{ role: 'user', content: 'test' }])
    assert.equal(result.provider, 'fallback')
    assert.equal(result.content, 'fallback-result')
    assert.deepEqual(calls, ['https://primary.example/v1/chat/completions', 'https://fallback.example/v1/chat/completions'])
  } finally { globalThis.fetch = originalFetch }
})

test('未配置模型时保持规则引擎通道', async () => {
  assert.equal(await callLlmWithFallback({}, []), null)
})

test('视觉任务只调用 API 3 配置且发送图片内容', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) })
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"platform":"小红书"}' } }] }), { status: 200 })
  }
  try {
    const result = await callVision({ base_url: 'https://vision.example/v1', api_key: 'vision-key', model: 'vision-model' }, ['https://images.example/a.png'], '解析指标')
    assert.equal(result.provider, 'vision')
    assert.deepEqual(calls.map(call => call.url), ['https://vision.example/v1/chat/completions'])
    assert.equal(calls[0].body.messages[0].content[1].type, 'image_url')
  } finally { globalThis.fetch = originalFetch }
})

test('三套配置能力测试区分文本和视觉请求', async () => {
  const originalFetch = globalThis.fetch
  const messageKinds = []
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    messageKinds.push(Array.isArray(body.messages[0].content) ? 'vision' : 'text')
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 })
  }
  try {
    assert.deepEqual(await testApiCapability('text_primary', { base_url: 'https://text.example/v1', api_key: 'a', model: 'm' }), { capability: 'text' })
    assert.deepEqual(await testApiCapability('vision', { base_url: 'https://vision.example/v1', api_key: 'b', model: 'v' }), { capability: 'vision' })
    assert.deepEqual(messageKinds, ['text', 'vision'])
  } finally { globalThis.fetch = originalFetch }
})
