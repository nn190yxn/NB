import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 3800 + Math.floor(Math.random() * 150)
const baseUrl = `http://127.0.0.1:${port}`

function startServer(extraEnv = {}) {
  const testDataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-atoms-')), 'data.json')
  writeFileSync(testDataFile, '{}')
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: testDataFile, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 5000)
    child.stdout.on('data', data => {
      if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) }
    })
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

const jsonPost = (path, body) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('素材原子化：收录、去重、类型筛选与组合生成', async t => {
  const server = await startServer()
  t.after(() => server.kill())

  const article = await jsonPost('/api/materials/upload', { name: '访谈记录', content: '这是一个足够长的金句，用来测试收录。\n第二个主题行也是够长的内容。\n短行\n第三个长句子同样满足提取条件，用于金句测试。' })
  assert.equal(article.status, 201)
  const source = await article.json()

  const kindsResponse = await fetch(`${baseUrl}/api/materials?kind_counts=1`)
  const kinds = await kindsResponse.json()
  assert.equal(kinds.kind_counts.article, 1)

  const collect = await jsonPost('/api/materials/atoms', { source_id: source.id, kind: 'quote', text: '这是一个足够长的金句，用来测试收录。' })
  assert.equal(collect.status, 201)
  const atom = await collect.json()
  assert.equal(atom.material_kind, 'quote')
  assert.equal(atom.origin_source_id, source.id)
  assert.equal(atom.origin_material_name, '访谈记录')
  assert.equal(atom.source_refs.length, 1)

  const collectAgain = await jsonPost('/api/materials/atoms', { source_id: source.id, kind: 'quote', text: '这是一个足够长的金句，用来测试收录。' })
  assert.equal(collectAgain.status, 200)
  assert.equal((await collectAgain.json()).duplicate, true)

  const sourceAfter = await (await fetch(`${baseUrl}/api/materials?q=访谈&page=1`)).json()
  assert.deepEqual(sourceAfter.items[0].extracted_fields.collected.quote, ['这是一个足够长的金句，用来测试收录。'])

  const experience = await jsonPost('/api/materials/atoms', { kind: 'experience', text: '去年我把一次交付失败写成了公开复盘。' })
  assert.equal(experience.status, 201)
  const expAtom = await experience.json()
  assert.equal(expAtom.origin_source_id, null)
  assert.deepEqual(expAtom.source_refs, [])

  const badKind = await jsonPost('/api/materials/atoms', { kind: 'article', text: '文本' })
  assert.equal(badKind.status, 422)
  const missingSource = await jsonPost('/api/materials/atoms', { source_id: 99999, kind: 'quote', text: '文本' })
  assert.equal(missingSource.status, 422)

  const quoteList = await (await fetch(`${baseUrl}/api/materials?kind=quote&page=1`)).json()
  assert.equal(quoteList.items.length, 1)
  assert.equal(quoteList.total, 1)
  const countsAfter = await (await fetch(`${baseUrl}/api/materials?kind_counts=1`)).json()
  assert.equal(countsAfter.kind_counts.quote, 1)
  assert.equal(countsAfter.kind_counts.experience, 1)
  assert.equal(countsAfter.kind_counts.article, 1)

  const noAnchor = await jsonPost('/api/drafts/generate', { quote_ids: [] })
  assert.equal(noAnchor.status, 422)

  const composed = await jsonPost('/api/drafts/generate', { topic: { title: '从失败账本讲信任资产', strategy_layer: 'trust', goal_refs: [] }, quote_ids: [atom.id], experience_ids: [expAtom.id] })
  assert.equal(composed.status, 201)
  const drafts = await composed.json()
  assert.equal(drafts.length, 4)
  assert.match(drafts[0].body, /金句参考/)
  assert.match(drafts[0].body, /这是一个足够长的金句/)
  assert.match(drafts[0].body, /公开复盘/)
  const materialRefs = drafts[0].source_refs.filter(ref => ref.type === 'material')
  assert.deepEqual(materialRefs.map(ref => ref.id).sort((a, b) => a - b), [atom.id, expAtom.id].sort((a, b) => a - b))

  const removeAtom = await fetch(`${baseUrl}/api/materials/atoms/${atom.id}`, { method: 'DELETE' })
  assert.equal(removeAtom.status, 200)
  const sourceRestored = await (await fetch(`${baseUrl}/api/materials?q=访谈&page=1`)).json()
  assert.deepEqual(sourceRestored.items[0].extracted_fields.collected.quote, [])
})
