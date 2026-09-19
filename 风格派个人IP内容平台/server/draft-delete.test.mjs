// 删除草稿：两步走 + 守卫。
// 删除不可逆，所以这里把每条守卫都钉住：没归档的不许删、已确认/已发布/待拍摄的不许删、
// 别人派生的变体还在时不许删。守卫松一条，用户就可能少掉一条找不回来的稿子。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { testPortSequence } from './test-port.mjs'

const allocatePort = testPortSequence(3800, 150)

const archived = '2026-09-01T00:00:00.000Z'
const draft = (id, extra) => ({
  id,
  owner_id: 'del-user',
  platform: '抖音',
  title: `草稿 ${id}`,
  body: '正文内容',
  status: 'draft',
  workflow_status: 'draft',
  version: 1,
  archived_at: null,
  ...extra,
})

// 一条干净的、可删的；其余每一条各踩一个守卫。
const seedDrafts = [
  draft(1, {}),
  draft(2, { archived_at: archived }),
  draft(3, { archived_at: archived, approval: { status: 'approved' } }),
  draft(4, { archived_at: archived, status: 'published', workflow_status: 'published' }),
  draft(5, { archived_at: archived, workflow_status: 'ready_to_shoot' }),
  draft(6, { archived_at: archived }),
  draft(7, { variant_of: 6 }),
]

function startServer() {
  const port = allocatePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const logs = []
  const dataFile = join(mkdtempSync(join(tmpdir(), 'draft-delete-test-')), 'data.json')
  writeFileSync(dataFile, JSON.stringify({ drafts: seedDrafts }))
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile,
      API_CONFIG_ENCRYPTION_KEY: '44'.repeat(32),
      PROJECT_DB_HOST: '', PROJECT_DB_NAME: '', PROJECT_DB_USER: '', PROJECT_DB_PASSWORD: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', data => logs.push(String(data)))
  child.stderr.on('data', data => logs.push(String(data)))
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`删除草稿测试服务启动超时：${logs.join('')}`)), 5000)
    child.stdout.on('data', data => {
      if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve({ child, baseUrl }) }
    })
    child.once('error', reject)
  })
}

async function session(baseUrl, userId) {
  const response = await fetch(`${baseUrl}/api/auth/session`, { method: 'POST', headers: { 'x-user-id': userId } })
  return response.headers.get('set-cookie').split(';', 1)[0]
}

test('删除草稿：没归档不给删，守卫挡住已确认/已发布/待拍摄/有变体的', async t => {
  const { child, baseUrl } = await startServer()
  t.after(() => child.kill())
  const cookie = await session(baseUrl, 'del-user')
  const remove = id => fetch(`${baseUrl}/api/drafts/${id}`, { method: 'DELETE', headers: { cookie } })

  // 没归档的不许删：逼用户先归档，手滑一下还能撤销。
  const notArchived = await remove(1)
  assert.equal(notArchived.status, 409)
  assert.match((await notArchived.json()).error, /先归档/)

  // 已确认 / 已发布 / 待拍摄，各自锁住。
  assert.equal((await remove(3)).status, 409, '已确认的不能删')
  assert.equal((await remove(4)).status, 409, '已发布的不能删')
  assert.equal((await remove(5)).status, 409, '待拍摄的不能删')

  // 还有变体派生自它，删了变体会指向空处。
  const hasVariant = await remove(6)
  assert.equal(hasVariant.status, 409)
  assert.match((await hasVariant.json()).error, /变体/)

  // 不存在的给 404，不是 500。
  assert.equal((await remove(999)).status, 404)

  // 挡住这些之后，那条干净的必须还能删掉——守卫写过头会让功能变成不能用。
  const ok = await remove(2)
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { id: 2, deleted: true })

  const list = await (await fetch(`${baseUrl}/api/drafts`, { headers: { cookie } })).json()
  const ids = list.map(item => item.id)
  assert.equal(ids.includes(2), false, '删掉的不该再出现在列表里')
  // 被守卫挡下的必须原样还在，不能被误删。
  for (const id of [1, 3, 4, 5, 6, 7]) assert.equal(ids.includes(id), true, `草稿 ${id} 不该被删`)
})

test('删除草稿：别人的草稿看不到也删不了', async t => {
  const { child, baseUrl } = await startServer()
  t.after(() => child.kill())
  const cookie = await session(baseUrl, 'other-user')
  const response = await fetch(`${baseUrl}/api/drafts/2`, { method: 'DELETE', headers: { cookie } })
  assert.equal(response.status, 404, '别人的草稿应当当作不存在')
})
