import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseResearchAnalysis, researchAnalysisPrompt, researchAnalysisVariables } from './research-analysis.mjs'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

test('拆解结果：缺判断或没有结构就报错，confidence 夹到 0-1 且允许真的是 0', () => {
  const ok = parseResearchAnalysis(JSON.stringify({ thesis: '真实数据能换信任', structure: ['反常识开场', '案例'], confidence: 0.4 }))
  assert.equal(ok.thesis, '真实数据能换信任')
  assert.deepEqual(ok.quotes, [], '没有引语就给空数组，不替它编一条')
  assert.equal(ok.confidence, 0.4)
  assert.equal(ok.analyzed_by, 'model')

  assert.equal(parseResearchAnalysis(JSON.stringify({ thesis: 't', structure: ['s'], confidence: 0 })).confidence, 0, '0 是合法值，不能被当成"没给"')
  assert.equal(parseResearchAnalysis(JSON.stringify({ thesis: 't', structure: ['s'], confidence: 7 })).confidence, 1)
  assert.equal(parseResearchAnalysis(JSON.stringify({ thesis: 't', structure: ['s'] })).confidence, null, '没给就是没给，不兜一个看着像数的值')

  assert.throws(() => parseResearchAnalysis(JSON.stringify({ structure: ['s'] })), /判断/)
  assert.throws(() => parseResearchAnalysis(JSON.stringify({ thesis: 't', structure: [] })), /段落结构/)
  assert.throws(() => parseResearchAnalysis('[]'), /不是对象/)
  assert.throws(() => parseResearchAnalysis('坏了'), { code: 'MODEL_OUTPUT_INVALID', message: /可解析.*重试一次/ }, '读不出模型回答时要说「这次读不出、重试」，不能报成配置坏了')
})

test('拆解提示词不许再一律给 0.86，变量只带条目本身', () => {
  assert.match(researchAnalysisPrompt, /不要一律 0.86/)
  const vars = researchAnalysisVariables({ title: '西贝关了很多店', platform: '抖音', author: '某号', metrics: { discussions: 12 }, url: 'https://example.com/1' })
  assert.deepEqual(vars, { title: '西贝关了很多店', platform: '抖音', author: '某号', metrics: { discussions: 12 }, url: 'https://example.com/1' })
  assert.equal(researchAnalysisVariables(null).title, '', '缺条目也不能炸')
})

const port = testPort(49900, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'research-analysis-')), 'data.json')
writeFileSync(dataFile, '{}')

function startServerOn(number, env) {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...env, PORT: String(number) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 20000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

const baseEnv = { ...process.env, NODE_ENV: 'test' }

const headers = { 'x-user-id': 'analysis-owner', 'content-type': 'application/json' }

test('没配模型时拆解明确失败，不再落一份写死的假分析', async t => {
  const server = await startServerOn(port, { ...baseEnv, DATA_FILE: dataFile, PROJECT_LLM_BASE_URL: '', PROJECT_LLM_API_KEY: '', PROJECT_LLM_MODEL: '' })
  t.after(() => server.kill())

  const collected = await (await fetch(`${baseUrl}/api/research/hot-search/collect`, { method: 'POST', headers, body: JSON.stringify({ platform: '抖音', entries: [{ title: '西贝关闭多家门店' }] }) })).json()
  const item = collected.items[0]

  const failed = await fetch(`${baseUrl}/api/research/${item.id}/analyze`, { method: 'POST', headers })
  assert.equal(failed.status, 422, '没模型就没能出分析')
  const body = await failed.json()
  assert.equal(body.code, 'MISSING_CONFIG')

  const after = (await (await fetch(`${baseUrl}/api/research`, { headers })).json()).find(row => row.id === item.id)
  assert.equal(after.analysis, null, '失败时不许留下一份来路不明的分析')
})

const mockPort = testPort(49960, 150)
const mockBase = `http://127.0.0.1:${mockPort}`
const mockDataFile = join(mkdtempSync(join(tmpdir(), 'research-analysis-mock-')), 'data.json')
writeFileSync(mockDataFile, '{}')

test('配了模型时拆解跟着条目走，并沉淀成可复用的方法结构', async t => {
  const llmMock = await startSharedLlmMock()
  const server = await startServerOn(mockPort, { ...baseEnv, ...llmMock.env, DATA_FILE: mockDataFile })
  t.after(() => server.kill())

  const collected = await (await fetch(`${mockBase}/api/research/hot-search/collect`, { method: 'POST', headers, body: JSON.stringify({ platform: '抖音', entries: [{ title: '西贝关闭多家门店' }] }) })).json()
  const item = collected.items[0]
  const analyzed = await (await fetch(`${mockBase}/api/research/${item.id}/analyze`, { method: 'POST', headers })).json()

  assert.equal(analyzed.analysis.analyzed_by, 'model')
  assert.match(analyzed.analysis.thesis, /西贝关闭多家门店/, '拆解必须对得上这条热点，不能是全库同一份模板')
  assert.notEqual(analyzed.analysis.confidence, 0.86)
  const structures = await (await fetch(`${mockBase}/api/structures?page=1`, { headers })).json()
  assert.ok(structures.items.some(entry => entry.steps.length === 3), '段落结构要进爆款方法库')
})
