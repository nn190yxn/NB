import { createServer } from 'node:http'
export async function startGenerationMock() {
  let mode = 'success'
  const server = createServer(async (req, res) => {
    if (mode === 'failed') { res.writeHead(503); res.end('test failure'); return }
    let raw = ''; for await (const chunk of req) raw += chunk
    const input = JSON.parse(JSON.parse(raw).messages.at(-1).content)
    const result = input.answers ? Array.from({ length: 3 }, (_, index) => ({ name: `方向${index + 1}`, positioning_statement: input.answers['0'] || '根据能力形成内容', audiences: ['创业者'], problems: ['内容难以持续'], pillars: ['真实复盘'], uncertainties: ['需要验证需求'], answer_refs: Object.keys(input.answers).filter(key => input.answers[key]) })) : Array.from({ length: 3 }, (_, index) => ({ title: `${input.profile.role}的${input.sources[0].title}分析${index + 1}`, rationale: '基于提供的来源', content_job: '分享经验', strategy_layer: 'trust', source_indexes: [0] }))
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: mode === 'invalid' ? 'invalid JSON' : JSON.stringify(result) } }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { setMode: value => { mode = value }, env: { PROJECT_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}`, PROJECT_LLM_API_KEY: 'test-only', PROJECT_LLM_MODEL: 'mock', LLM_DAILY_LIMIT: '100' }, close: () => { server.closeAllConnections(); server.close() } }
}
