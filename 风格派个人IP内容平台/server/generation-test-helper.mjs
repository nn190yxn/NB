import { createServer } from 'node:http'
import { after } from 'node:test'

// 测试用上游大模型：按系统提示词分派，覆盖定位、选题、草稿正文、适配、去 AI 感、记忆提炼与复盘。
export async function startGenerationMock({ adaptBody } = {}) {
  let mode = 'success'
  const server = createServer(async (req, res) => {
    if (mode === 'failed') { res.writeHead(503); res.end('test failure'); return }
    let raw = ''
    for await (const chunk of req) raw += chunk
    const payload = JSON.parse(raw)
    const system = String(payload.messages?.[0]?.content || '')
    const last = String(payload.messages?.at(-1)?.content || '')
    const reply = content => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: mode === 'invalid' ? 'invalid JSON' : content } }] })) }

    if (system.includes('文案写手')) {
      const brief = JSON.parse(last)
      return reply(JSON.stringify({
        master: `母版正文：${brief.title}`,
        小红书: `小红书正文：${brief.title}`,
        抖音: `抖音口播：${brief.title}`,
        视频号: `视频号口播：${brief.title}`,
        公众号: `公众号正文：${brief.title}`,
      }))
    }
    if (system.includes('多平台内容发布适配')) return reply(JSON.stringify({ title: '适配标题', body: typeof adaptBody === 'function' ? adaptBody(last) : `适配正文：${JSON.parse(last).title}`, hashtags: ['#测试标签'] }))
    if (system.includes('改稿助手')) {
      const payload = JSON.parse(last)
      if (payload.slot === 'title') return reply('对标改法之后的新标题')
      if (payload.slot === 'opening') return reply('改写后的开头段：真实过程比技巧更重要。')
      if (payload.slot === 'ending') return reply('改写后的结尾段')
      return reply('整篇重排后的正文')
    }
    if (system.includes('去 AI 味')) return reply('去 AI 感之后的正文')
    if (system.includes('记忆')) return reply(JSON.stringify([{ memory_type: 'style', content: '共享模型提炼的记忆' }]))
    if (system.includes('复盘')) return reply(JSON.stringify({ verdict: 'winner', summary: '表现优于往常', lessons: ['真实案例更受欢迎'], drivers: ['真实案例'] }))

    const input = JSON.parse(last)
    const result = input.answers
      ? Array.from({ length: 3 }, (_, index) => ({ name: `方向${index + 1}`, positioning_statement: input.answers['0'] || '根据能力形成内容', audiences: ['创业者'], problems: ['内容难以持续'], pillars: ['真实复盘'], uncertainties: ['需要验证需求'], answer_refs: Object.keys(input.answers).filter(key => input.answers[key]) }))
      : Array.from({ length: 3 }, (_, index) => ({ title: `${input.profile.role}的${input.sources[0].title}分析${index + 1}`, rationale: '基于提供的来源', content_job: '分享经验', strategy_layer: 'trust', source_indexes: [0] }))
    return reply(JSON.stringify(result))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const mock = {
    setMode: value => { mode = value },
    env: { PROJECT_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}`, PROJECT_LLM_API_KEY: 'test-only', PROJECT_LLM_MODEL: 'mock', LLM_DAILY_LIMIT: '100' },
    close: () => { server.closeAllConnections(); server.close() },
  }
  return mock
}

// 进程级共享 mock：测试文件顶部 await 一次即可，配合 after() 自动关闭。
export async function startSharedLlmMock(options) {
  const mock = await startGenerationMock(options)
  after(() => mock.close())
  return mock
}
