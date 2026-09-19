import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const ui = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')

// 2026-09-20 真模型实测：同一段正文、同一套提示词跑 6 次，逻辑检查只有 3 次报出问题。
// 也就是说「模型这次没报」和「查过没问题」是两件事，而界面原来都用「已通过」——
// 用户会把「这次没看出来」读成「安全」。这条测试钉住：逻辑检查的通过必须换一个说法。
test('逻辑检查的「通过」不能和「查过没问题」共用一句话', () => {
  assert.match(ui, /const draftCheckStatusLabels: Record<string, string> = \{ passed: '已通过'/, '其余检查照旧用「已通过」')
  assert.match(ui, /logicCheckStatusLabels[^\n]*passed: '模型这次没指出问题'/, '逻辑检查的通过要说成「模型这次没指出问题」')
  // 取词必须带上是哪个检查（check）——退回通用表就等于把这条又抹掉了。
  assert.match(ui, /const draftCheckStatusLabel = \(check: string, status\?: string\) =>/)
  assert.match(ui, /draftCheckStatusLabel\(check, item\.status\)/, '渲染状态时必须按检查项取词')
  assert.doesNotMatch(ui, /draftCheckStatusLabels\[item\.status\]/, '不许退回不带检查项的取词')
})

// 「没检查」（skipped）跟「查过没问题」也必须分开——这一条是 2026-09-19 修的，别回退。
test('「没检查」和「查过没问题」还是两个词', () => {
  assert.match(ui, /skipped: '没检查'/)
  assert.match(ui, /type DraftCheck = \{ status: 'passed' \| 'warning' \| 'blocked' \| 'skipped'/)
})
