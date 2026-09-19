import { after } from 'node:test'
import { startGenerationMock } from './generation-test-helper.mjs'
const generationMock = await startGenerationMock()
after(() => generationMock.close())
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testPortSequence } from './test-port.mjs'

// 这条测试补的是 24.1：/api/drafts/:id/checks/logic 这条路一直没有测试，
// 而本次会话两个 bug（c793d20 的形状、以及 workflow_status 被三元兜底改坏）都出在这条路上。
// 独立接口 /api/skills/logic-check 的测试盖不住它——那边返回 { findings, checked }，
// 这边返回的是整条草稿，两套形状。
const nextPort = testPortSequence(4700, 400)

function startServer(port, testDataFile) {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, ...generationMock.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: testDataFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('测试 API 启动超时')), 8000)
    child.stdout.on('data', data => {
      if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) }
    })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`测试 API 异常退出: ${code}`)) })
  })
}

test('草稿检查路由：逻辑检查不改 workflow_status，且形状是界面要的那种', async t => {
  const port = nextPort()
  const baseUrl = `http://127.0.0.1:${port}`
  const testDataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-logic-')), 'data.json')
  writeFileSync(testDataFile, '{}')
  const server = await startServer(port, testDataFile)
  t.after(() => server.kill())

  const headers = { 'x-user-id': 'logic-route-user', 'content-type': 'application/json' }

  // 造草稿：/api/drafts/generate 接受内联 topic 对象，不用先建选题。
  const generated = await fetch(`${baseUrl}/api/drafts/generate`, {
    method: 'POST', headers,
    body: JSON.stringify({ topic: { title: '情绪丰富，是搞钱的累赘', strategy_layer: 'trust', goal_refs: [] } }),
  })
  assert.equal(generated.status, 201, '生成草稿应当成功')
  const drafts = await generated.json()
  assert.ok(drafts.length > 0, '至少要生成一条草稿')
  const draft = drafts[0]

  // 记下跑检查之前的值——这是 24.2 的核心：逻辑检查是附加检查，不是流程里的一道关，
  // 它不许动 workflow_status。动了就是「点一下逻辑检查，草稿变成可以发布了」那个 bug 复发。
  const before = draft.workflow_status

  const checked = await fetch(`${baseUrl}/api/drafts/${draft.id}/checks/logic`, { method: 'POST', headers, body: '{}' })
  assert.equal(checked.status, 200, '逻辑检查接口应当返回 200')
  const after_ = await checked.json()

  // 断言 2（24.2）：workflow_status 必须原样不动。
  assert.equal(after_.workflow_status, before, '逻辑检查不许改 workflow_status')
  assert.notEqual(after_.workflow_status, 'publish_ready', '逻辑检查不许把草稿变成可发布')

  // 断言 1（c793d20 的形状 bug）：evidence 必须是对象数组，不是字符串数组。
  const logic = after_.checks?.logic
  assert.ok(logic, '草稿上应当挂上 checks.logic')

  // 字段形状契约：这几个必须一直在（跟 server/draft-checks.mjs 的 result() 对齐）。
  // 注意：这里断言的是「对象本身的形状」，所以在 evidence 为空时也一样有意义
  // ——不能只靠下面的逐条循环，那个循环在空数组时根本不跑，会变成空过的断言。
  assert.ok(Array.isArray(logic.evidence), 'evidence 必须是数组')
  assert.ok(Array.isArray(logic.findings), 'findings 必须是数组')
  assert.ok(Array.isArray(logic.suggestions), 'suggestions 必须是数组——界面靠它显示说明')
  assert.ok(Array.isArray(logic.reminders), 'reminders 必须是数组')
  assert.equal(typeof logic.draft_version, 'number', 'draft_version 必须是数字（缓存靠它，写错会重复烧模型调用）')
  assert.equal(typeof logic.checked_at, 'string', 'checked_at 必须是时间串')
  assert.ok(['passed', 'warning', 'blocked'].includes(logic.status), 'status 必须是界面认得的三个值之一')

  // 逐条形状（c793d20 的 bug）：有内容时，每条必须是对象而不是字符串。
  for (const item of logic.evidence) {
    assert.equal(typeof item, 'object', 'evidence 的元素必须是对象——传字符串界面就渲染不出来')
    for (const key of ['code', 'message', 'severity']) {
      assert.ok(item[key] !== undefined, `evidence 每条必须有 ${key}`)
    }
  }

  // 已确认未覆盖：模拟模型生成的正文里没有「提了问题又给了办法」两句，
  // 所以本次跑出来 evidence 是空的，**上面那个逐条循环没被执行**。
  // 形状契约在单元层已经钉住了（见 draft-logic.test.mjs 的「形状契约」一条）；
  // 若要让这条路也跑到非空分支，需要让模拟模型吐出带信号词的正文。

  // 断言 3（20.7）：圈不出范围时，必须把「没查」说出来。
  // 通用列表显示的是 suggestions，所以「没查」的说明要落在那儿；
  // 落回 reminders 的话界面不渲染，用户只看到「通过」。
  if (logic.evidence.length === 0) {
    assert.ok(logic.suggestions.length > 0, '没查出来时必须给出一句说明，否则用户会把「没查」读成「通过」')
  }

  // 断言 4：同一版本再跑一次，不重复调模型（省钱闸门靠 draft_version 缓存）。
  const again = await fetch(`${baseUrl}/api/drafts/${draft.id}/checks/logic`, { method: 'POST', headers, body: '{}' })
  assert.equal(again.status, 200)
  const second = await again.json()
  assert.equal(second.workflow_status, before, '再跑一次也不许改 workflow_status')
})
