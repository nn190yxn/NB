import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const ui = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')

// 2026-09-20 审计 25.5：`src/main.tsx` 里 30+ 处把失败吞成 undefined，
// 其中一批是「用户主动点了按钮」——失败了界面上一个字都不说。
// 根因不是「懒得写」，而是**默认是安静的**：有没有告诉用户，全靠每一处记得写，
// 所以修完一轮又会攒出新的一批（上一轮修了 20.7/25.5 点名的那处，这一轮又数出 13 处）。
// 现在反过来：apiJson 默认上报，需要安静的调用点显式 opt out。
test('apiJson 失败默认要报，安静的调用点必须显式 opt out', () => {
  assert.match(ui, /let apiFailureReporter: \(\(notice: ApiFailureNotice\) => void\) \| null = null/, '要有全局失败出口')
  assert.match(ui, /if \(response\.status !== 401 && !silent\) apiFailureReporter\?\.\(/, '非 401 失败要默认上报（401 已经走会话过期那条路）')
  assert.match(ui, /type ApiRequestOptions = RequestInit & \{ silent\?: boolean \}/, 'opt out 要显式写出来')
  assert.match(ui, /setApiFailureReporter\(notice => setApiFailure\(notice\)\)/, 'App 要接住并显示')
  assert.match(ui, /className="api-failure-banner" role="alert"/, '提示要能被读屏读到（role=alert）')
  assert.match(ui, /setApiFailure\(null\)/, '要能关掉')
})

// 钩住「静默点会悄悄变多」：现在是探活 + 计数两类，数出来看变化。
test('显式静默的调用点数量要能一眼数出来', () => {
  const silents = ui.match(/\{ silent: true \}/g) || []
  assert.ok(silents.length >= 2, `显式静默的调用点太少，疑似有人把上报告口绕过去了：${silents.length}`)
  assert.ok(silents.length <= 6, `显式静默的调用点变多了（${silents.length} 个），每一个都要能说清为什么可以安静`)
})

// 审计 25.5 的 P1：草稿列表加载失败原来什么都不说，界面显示「还没有草稿」——
// 用户会以为稿子没了。这条钉住「失败」「正在读」「真的没有」三种状态是分开的。
test('草稿加载失败不能说成「还没有草稿」', () => {
  assert.match(ui, /setDraftLoadError\('草稿加载失败，请重试。'\)/, '失败要有自己的话')
  assert.match(ui, /draftsLoading \? <p role="status">正在读取草稿\.\.\.<\/p> : draftLoadError \?/, '「正在读」和「读失败」要有各自的渲染分支')
  assert.match(ui, /onClick=\{loadDrafts\}>重新加载草稿<\/button>/, '失败要能重试')
})

// 审计 25.5：日历加载失败原来是 `catch(() => setEntries([]))`——空日历和「没排内容」长得一样。
test('日历加载失败不能说成「这个月没内容」', () => {
  assert.match(ui, /setLoadError\('日历加载失败，请重试。'\)/)
  assert.match(ui, /\{loadError && <p className="structure-error" role="alert">\{loadError\}/)
  assert.doesNotMatch(ui, /catch\(\(\) => setEntries\(\[\]\)\)/, '失败不能再被当成空数组')
})
