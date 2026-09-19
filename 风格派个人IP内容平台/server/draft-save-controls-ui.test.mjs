import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const ui = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

test('手动保存栏紧跟正文，AI 修改单独成组', () => {
  const bodyInput = ui.indexOf('className="draft-body-input"')
  const saveBar = ui.indexOf("'draft-edit-bar dirty'")
  const aiEdit = ui.indexOf('>AI 修改</label>')
  assert.ok(bodyInput >= 0, '要保留正文编辑框')
  assert.ok(saveBar > bodyInput, '保存栏必须放在正文框后面')
  assert.ok(aiEdit > saveBar, 'AI 修改必须放在手动保存栏后面，不能混成一个动作')
  assert.match(ui, /'保存修改'\}<\/button>/)
  assert.match(ui, />撤销本次修改<\/button>/)
  assert.doesNotMatch(ui, />保存草稿<\/button>/, '旧的远距离保存按钮要移除，避免两个入口')
})

test('撤销使用首次编辑快照，保存成功才清除快照', () => {
  assert.match(ui, /draftEditBaselines = useRef/)
  assert.match(ui, /draftEditBaselines\.current\[draft\.id\] \|\| \{ title: draft\.title, body: draft\.body \}/)
  assert.match(ui, /const undoDraftText/)
  assert.match(ui, /delete draftEditBaselines\.current\[draft\.id\]/)
  assert.match(ui, /保存失败：.*输入已保留/)
})

test('保存栏在窄屏纵向排列，按钮不会挤在一行', () => {
  assert.match(css, /@media \(max-width: 680px\).*\.draft-edit-bar \{ align-items: stretch; flex-direction: column;/s)
  assert.match(css, /\.draft-edit-actions button \{ flex: 1; \}/)
})
