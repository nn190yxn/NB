import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { startSharedLlmMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'
import { findWechatStyle, parseWechatCss, wechatHtmlDocument, wechatHtmlFor, wechatStyles } from './wechat-html.mjs'

const llmMock = await startSharedLlmMock()

test('风格库 15 个都在，每个都带 CSS 和必需选择器', () => {
  assert.equal(wechatStyles.length, 15)
  assert.deepEqual(wechatStyles.slice(0, 6).map(item => item.id), ['minimal', 'medium', 'wired', 'verge', 'stripe', 'apple'])
  for (const style of wechatStyles) {
    for (const selector of ['body', 'h1', 'h2', 'h3', 'p', 'blockquote', 'ul', 'li', 'strong', 'code', 'pre', 'hr']) {
      assert.ok(style.css.includes(`${selector}{`), `${style.id} 缺 ${selector} 规则`)
    }
  }
})

test('CSS 按选择器拆成声明', () => {
  const rules = parseWechatCss('body{color:#111;background:#fff;}p{margin:12px 0;}')
  assert.equal(rules.body, 'color:#111;background:#fff')
  assert.equal(rules.p, 'margin:12px 0')
})

test('正文转换：标题用 h1、空行分段、段末句号保留、段内单换行并成空格、不出现 br', () => {
  const result = wechatHtmlFor({ title: '内容要按成交写', body: '第一句。\n还是同一段。\n\n第二段在这里。', styleId: 'minimal' })
  assert.match(result.html, /<h1[^>]*>内容要按成交写<\/h1>/)
  assert.match(result.html, /还是同一段/)
  assert.ok(!result.html.includes('<br'))
  // 段末句号保留：源技能的「去句号」规则按 Alex 的决定关掉了。
  assert.match(result.html, /<p[^>]*>第一句。 还是同一段。<\/p>/)
  assert.match(result.html, /<p[^>]*>第二段在这里。<\/p>/)
})

test('列表合并成一个 ul，表格降级成列表行（表头算内容、分隔行丢掉）', () => {
  const result = wechatHtmlFor({ title: '', body: '- 第一项\n- 第二项\n\n| 甲 | 乙 |\n| --- | --- |\n| 一 | 二 |', styleId: 'minimal' })
  assert.equal((result.html.match(/<ul/g) || []).length, 2)
  assert.equal((result.html.match(/<li/g) || []).length, 4)
  assert.match(result.html, /甲：乙/)
  assert.match(result.html, /一：二/)
  assert.ok(!result.html.includes('---'))
  assert.ok(!result.html.includes('<table'))
})

test('输出全内联：没有 style 标签、没有 class，关键元素都带 style', () => {
  const result = wechatHtmlFor({ title: '标题', body: '正文一句。', styleId: 'stripe' })
  assert.ok(!result.html.includes('<style'))
  assert.ok(!result.html.includes('class='))
  assert.match(result.html, /<h1 style="/)
  assert.match(result.html, /<p style="/)
  assert.ok(result.body_style.includes('font-family'))
})

test('转义特殊字符、图片留占位、链接只留文字', () => {
  const result = wechatHtmlFor({ title: '', body: '看这个 <script>alert(1)</script> 和 ![封面](https://a.com/x.png) 以及 [教程](https://a.com/t)。', styleId: 'minimal' })
  assert.ok(!result.html.includes('<script>'))
  assert.match(result.html, /&lt;script&gt;/)
  assert.match(result.html, /\[图片：封面\]/)
  assert.ok(!result.html.includes('https://a.com/t'))
  assert.match(result.html, /教程/)
})

test('代码块未闭合时内容不丢，并在 notes 里说明', () => {
  const result = wechatHtmlFor({ title: '', body: '开头一句。\n\n```js\nconst a = 1;', styleId: 'minimal' })
  assert.match(result.html, /const a = 1;/)
  assert.ok(result.notes.some(note => note.includes('没有闭合')))
})

test('风格 id 不认识时落到默认款，文档版带上正文样式', () => {
  assert.equal(findWechatStyle('不存在的风格').id, 'minimal')
  assert.equal(findWechatStyle('').id, 'minimal')
  assert.equal(findWechatStyle('course').id, 'course')
  const doc = wechatHtmlDocument({ title: '标题', body: '正文一句。', styleId: 'medium' })
  assert.match(doc.document, /^<!doctype html>/)
  assert.match(doc.document, /<section style="[^"]*Georgia/)
})

test('接口：公众号版本是纯渲染，不改草稿', async t => {
  const port = testPort(41700, 150)
  const dir = mkdtempSync(join(tmpdir(), 'wechat-html-'))
  const dataFile = join(dir, 'state.json')
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, ...llmMock.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  child.stdout.on('data', chunk => { logs += String(chunk) })
  child.stderr.on('data', chunk => { logs += String(chunk) })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`服务启动超时：${logs.slice(-500)}`)), 15000)
    child.stdout.on('data', chunk => { if (String(chunk).includes('Content IP API listening')) { clearTimeout(timer); resolve() } })
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`服务退出：${code}\n${logs.slice(-800)}`)) })
  })
  t.after(() => { child.kill(); rmSync(dir, { recursive: true, force: true }) })

  const base = `http://127.0.0.1:${port}`
  const headers = { 'x-user-id': 'wechat-html-owner', 'content-type': 'application/json' }
  const generated = await (await fetch(`${base}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title: '内容要按成交写', strategy_layer: 'trust', goal_refs: [] } }) })).json()
  const before = generated[0]

  const response = await fetch(`${base}/api/drafts/${before.id}/wechat-html`, { method: 'POST', headers, body: JSON.stringify({ style_id: 'course' }) })
  const result = await response.json()
  assert.equal(response.status, 200, `渲染失败：${JSON.stringify(result).slice(0, 200)}`)
  assert.equal(result.style_id, 'course')
  assert.ok(result.html.includes('<p style='))
  assert.ok(!result.html.includes('<style'))

  // 纯渲染：草稿一个字段都不该被改。
  const after = await (await fetch(`${base}/api/drafts`, { headers })).json()
  const same = after.find(item => item.id === before.id)
  assert.equal(same.version, before.version)
  assert.deepEqual(same.checks, before.checks)
  assert.deepEqual(same.approval, before.approval)
  assert.equal(same.body, before.body)
})
