import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startSharedLlmMock } from './generation-test-helper.mjs'

// 适配返回的正文里带「最好」，草稿母版里没有 —— 检查清单必须针对要发出去的那份文本。
const llmMock = await startSharedLlmMock({ adaptBody: () => '适配正文：最好的一课，包赚不赔。' })

const port = 47300 + Math.floor(Math.random() * 200)
const baseUrl = `http://127.0.0.1:${port}`
const headers = { 'content-type': 'application/json', 'x-user-id': 'adapt-user' }

function startServer(extraEnv = {}) {
  const testDataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-adapt-')), 'data.json')
  writeFileSync(testDataFile, '{}')
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: testDataFile, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

const post = (path, body = {}) => fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
const put = (path, body = {}) => fetch(`${baseUrl}${path}`, { method: 'PUT', headers, body: JSON.stringify(body) })

test('发布适配：清单检查的是适配后的文本，且记住基于哪一版正文', async t => {
  const server = await startServer(llmMock.env)
  t.after(() => server.kill())

  await put('/api/profile', { role: '帮本地生意老板做诊断', pillars: ['本地生意'], audiences: ['实体店老板'] })
  const drafts = await (await post('/api/drafts/generate', { topic: { title: '真实过程一课', strategy_layer: 'trust', goal_refs: [] } })).json()
  const draft = drafts[0]
  assert.ok(!String(draft.body).includes('最好'), '前提：草稿母版里没有风险词')

  const adapted = await (await post(`/api/drafts/${draft.id}/adapt`, { platform: '小红书' })).json()
  const version = adapted.adaptations['小红书']
  assert.equal(version.body, '适配正文：最好的一课，包赚不赔。')
  const risk = version.checklist.find(entry => entry.item === '无违禁词风险')
  assert.equal(risk.status, '风险', '适配正文里的风险词必须被清单拦下')
  assert.match(risk.detail, /最好/)
  assert.match(risk.detail, /包赚/)
  assert.equal(version.draft_version, adapted.version, '要记住这个版本基于第几版正文')

  // 改正文后版本号前进，适配记录仍指向旧版本 —— 界面据此提示「复制出去的是旧文案」
  const edited = await (await put(`/api/drafts/${draft.id}`, { body: `${draft.body}\n\n补了一句真实过程。` })).json()
  assert.ok(edited.version > version.draft_version)
  assert.equal(edited.adaptations['小红书'].draft_version, version.draft_version, '适配记录不会被改动，界面靠版本号对比给提示')
})
