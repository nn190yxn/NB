const DEFAULT_TIMEOUT_MS = 20_000

function normalizeConfig(config) {
  if (!config || !String(config.base_url || '').trim() || !String(config.api_key || '').trim() || !String(config.model || '').trim()) return null
  let baseUrl
  try { baseUrl = new URL(String(config.base_url).trim()) } catch { return null }
  if (!['http:', 'https:'].includes(baseUrl.protocol)) return null
  return { baseUrl: baseUrl.toString().replace(/\/$/, ''), apiKey: String(config.api_key), model: String(config.model).trim() }
}

async function callPayload(config, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`服务返回 ${response.status}`)
    const payload = await response.json()
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('响应内容为空或格式无效')
    return content.trim()
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('请求超时')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function callOne(config, messages, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return callPayload(config, { model: config.model, messages, temperature: 0.7 }, timeoutMs)
}

export async function callLlmWithFallback(configs, messages) {
  const candidates = [
    { name: 'primary', config: normalizeConfig(configs?.primary) },
    { name: 'fallback', config: normalizeConfig(configs?.fallback) },
  ].filter(item => item.config)
  if (!candidates.length) return null
  const errors = []
  for (const candidate of candidates) {
    try { return { content: await callOne(candidate.config, messages), provider: candidate.name } } catch (error) { errors.push(`${candidate.name}: ${error.message}`) }
  }
  const error = new Error('两个大模型 API 均不可用')
  error.details = errors
  error.retryable = true
  throw error
}

export async function callVision(config, imageUrls, prompt, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const normalized = normalizeConfig(config)
  if (!normalized) throw new Error('视觉模型未配置')
  if (!Array.isArray(imageUrls) || !imageUrls.length) throw new Error('视觉任务至少需要一张图片')
  const content = [{ type: 'text', text: String(prompt || '请描述图片内容') }, ...imageUrls.map(url => ({ type: 'image_url', image_url: { url: String(url) } }))]
  return { content: await callPayload(normalized, { model: normalized.model, messages: [{ role: 'user', content }], temperature: 0 }, timeoutMs), provider: 'vision' }
}

export async function testApiCapability(slot, config, timeoutMs = 8_000) {
  const normalized = normalizeConfig(config)
  if (!normalized) throw new Error('API 配置不完整')
  if (slot === 'vision') {
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII='
    await callVision(config, [pixel], '请只回复 OK', timeoutMs)
    return { capability: 'vision' }
  }
  await callOne(normalized, [{ role: 'user', content: '请只回复 OK' }], timeoutMs)
  return { capability: 'text' }
}

export function llmConfigFromHeaders(headers) {
  return {
    primary: { base_url: headers['x-llm-primary-base-url'], api_key: headers['x-llm-primary-api-key'], model: headers['x-llm-primary-model'] },
    fallback: { base_url: headers['x-llm-fallback-base-url'], api_key: headers['x-llm-fallback-api-key'], model: headers['x-llm-fallback-model'] },
  }
}
