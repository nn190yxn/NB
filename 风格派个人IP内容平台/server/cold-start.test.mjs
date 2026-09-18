import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

const llmMock = await startSharedLlmMock()
const port = testPort(49100, 150)
const baseUrl = `http://127.0.0.1:${port}`
const dataFile = join(mkdtempSync(join(tmpdir(), 'cold-start-test-')), 'data.json')
writeFileSync(dataFile, '{}')

function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...llmMock.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

test('冷启动：缺定位时给出降级路径，而且降级路径真的能走通', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const owner = 'cold-start-owner'
  const headers = { 'x-user-id': owner, 'content-type': 'application/json' }

  // 新用户：定位、素材库、对标都是空的。先建一条来源，好让请求走到「缺定位」这一步。
  const material = await (await fetch(`${baseUrl}/api/materials/atoms`, { method: 'POST', headers, body: JSON.stringify({ kind: 'insight', text: '一个还没成型的想法', name: '临时来源' }) })).json()
  assert.ok(material.id)

  const blocked = await fetch(`${baseUrl}/api/topics/generate`, { method: 'POST', headers, body: JSON.stringify({ material_ids: [material.id] }) })
  assert.equal(blocked.status, 422)
  const payload = await blocked.json()
  assert.equal(payload.code, 'COLD_START')
  assert.deepEqual(payload.missing_fields, ['role', 'audiences', 'pillars'])
  assert.ok(payload.gain, '第 3 条：要说清补上之后能得到什么')
  assert.deepEqual(payload.paths.map(path => path.key), ['small_sample', 'narrow_scope', 'bare_draft'], '第 2 条：降级路径三条都要在')

  // 第 2 条里最硬的一条：纯选题生成无素材初稿。这条路必须是通的，不是只写在提示里。
  const bare = await fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title: '第一次做内容该从哪开始', strategy_layer: 'trust', goal_refs: [] } }) })
  assert.equal(bare.status, 201, '纯选题无素材初稿这条路必须真能走')
  const drafts = await bare.json()
  assert.ok(drafts.length > 0)
  // 第 4 条：缺素材时不许静默编造，简报必须明确说明在裸写。
  assert.match(drafts[0].generation_context.brief.material_gap, /没有可用素材/)
})
