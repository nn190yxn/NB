import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 47600 + Math.floor(Math.random() * 150)
const baseUrl = `http://127.0.0.1:${port}`
const headers = { 'content-type': 'application/json', 'x-user-id': 'beta-user' }

function startServer(extraEnv = {}) {
  const testDataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-feedback-')), 'data.json')
  writeFileSync(testDataFile, '{}')
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: testDataFile, ADMIN_USERNAMES: 'adminuser', ...extraEnv },
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

const post = (path, body, customHeaders = headers) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: customHeaders, body: JSON.stringify(body) })
const get = (path, customHeaders = headers) => fetch(`${baseUrl}${path}`, { headers: customHeaders })
const put = (path, body, customHeaders = headers) => fetch(`${baseUrl}${path}`, { method: 'PUT', headers: customHeaders, body: JSON.stringify(body) })

test('反馈：提交、按用户隔离、管理员查看与状态更新', async t => {
  const server = await startServer()
  t.after(() => server.kill())

  const badTitle = await post('/api/feedback', { type: 'bug', title: '', description: '描述' })
  assert.equal(badTitle.status, 422)

  const created = await post('/api/feedback', { type: 'bug', title: '搜索结果重复', description: '点了两次搜索，同样的条目进了两条。', page: '热点研究' })
  assert.equal(created.status, 201)
  const item = await created.json()
  assert.equal(item.status, 'open')
  assert.equal(item.username, 'beta-user')

  const own = await (await get('/api/feedback')).json()
  assert.equal(own.is_admin, false)
  assert.equal(own.items.length, 1)

  const adminHeaders = { 'content-type': 'application/json', 'x-user-id': 'adminuser' }
  const adminView = await (await get('/api/feedback', adminHeaders)).json()
  assert.equal(adminView.is_admin, true)
  assert.equal(adminView.items.length, 1)
  assert.equal(adminView.items[0].title, '搜索结果重复')

  const acknowledged = await put(`/api/feedback/${item.id}`, { status: 'acknowledged' }, adminHeaders)
  assert.equal(acknowledged.status, 200)
  assert.equal((await acknowledged.json()).status, 'acknowledged')

  const forbidden = await put(`/api/feedback/${item.id}`, { status: 'resolved' })
  assert.equal(forbidden.status, 403)

  const resolved = await put(`/api/feedback/${item.id}`, { status: 'resolved' }, adminHeaders)
  assert.equal((await resolved.json()).status, 'resolved')

  const invalidStatus = await put(`/api/feedback/${item.id}`, { status: 'closed' }, adminHeaders)
  assert.equal(invalidStatus.status, 422)
})
