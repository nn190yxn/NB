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

// 钩住「静默点会悄悄变多」：现在两类——启动时的探活 / 计数（失败显示的只是 0 或空），
// 以及**定时轮询**（下面单独一条管）。数出来看变化。
test('显式静默的调用点数量要能一眼数出来', () => {
  const silents = ui.match(/\{ silent: true \}/g) || []
  assert.ok(silents.length >= 5, `显式静默的调用点太少，疑似有人把上报告口绕过去了：${silents.length}`)
  assert.ok(silents.length <= 9, `显式静默的调用点变多了（${silents.length} 个），每一个都要能说清为什么可以安静`)
})

// 真坑（2026-09-20 自查发现）：定时轮询加上「失败默认上报」会变成每几秒弹一次提示，
// 比原来更扰民。所以轮询里的请求必须显式安静（顶部提示十二秒自消，轮询是 2–5 秒一次）。
// 注意：`setInterval(refresh, …)` 和 `refresh` 里那个请求**不在同一行**，
// 所以这条要往前看几行（第一版只看同一行，结果反向验证时没红——是个假绿）。
test('轮询里的请求必须显式安静，不能每隔几秒弹一次', () => {
  const lines = ui.split('\n')
  const polls = lines.map((line, index) => ({ line, index })).filter(item => item.line.includes('setInterval'))
  assert.ok(polls.length >= 1, '至少要扫到一处轮询，否则这条测试是空转')
  const noisy = polls.flatMap(poll => (lines.slice(Math.max(0, poll.index - 6), poll.index + 1).join('\n').match(/apiJson[^\n]*/g) || []).filter(call => !call.includes('{ silent: true }')))
  assert.deepEqual(noisy, [], `轮询会反复弹提示（每几秒一次），这些请求要显式安静：\n${noisy.map(call => call.slice(0, 140)).join('\n')}`)
})

// 审计 25.5 的 P1：草稿列表加载失败原来什么都不说，界面显示「还没有草稿」——
// 用户会以为稿子没了。这条钉住「失败」「正在读」「真的没有」三种状态是分开的。
test('草稿加载失败不能说成「还没有草稿」', () => {
  assert.match(ui, /setDraftLoadError\('草稿加载失败，请重试。'\)/, '失败要有自己的话')
  assert.match(ui, /draftsLoading \? <p role="status">正在读取草稿\.\.\.<\/p> : draftLoadError \?/, '「正在读」和「读失败」要有各自的渲染分支')
  assert.match(ui, /onClick=\{loadDrafts\}>重新加载草稿<\/button>/, '失败要能重试')
})

// 审计 25.5（弱信号那四处的收口）：两个「计数」不能把「没读到」画成 0。
// 侧栏的「今日拍摄」和「反馈」未读数天天被人看，而失败时显示 0 与真的是 0 长得一模一样——
// 现在三态分开：还没读到（什么都不声称）/ 读到了（数字）/ 读失败（“—”或“?”并附悬停说明）。
test('计数读失败不许画成 0', () => {
  assert.match(ui, /const \[shootingCount, setShootingCount\] = useState<number \| 'failed' \| null>\(null\)/, '拍摄计数要记住「读失败」，不能只存数字')
  assert.match(ui, /const \[feedbackUnread, setFeedbackUnread\] = useState<number \| 'failed' \| null>\(null\)/, '反馈未读数要记住「读失败」')
  assert.match(ui, /catch\(\(\) => setShootingCount\('failed'\)\)/, '拍摄计数读失败时不能静默当成 0')
  assert.match(ui, /catch\(\(\) => setFeedbackUnread\('failed'\)\)/, '反馈未读数读失败时不能静默当成 0')
  assert.match(ui, /\{typeof shootingCount === 'number' \? shootingCount : '—'\}/, '侧栏拍摄计数要有「不知道」的渲染分支')
  assert.match(ui, /feedbackUnread === 'failed' \? <b title="没读到反馈列表，稍后重试">\?<\/b>/, '反馈角标要有「不知道」的渲染分支')
  assert.match(ui, /今天的拍摄清单没读到，稍后重试/, '首页卡片要用人的话说清没读到，而不是显示 0 条')
  assert.doesNotMatch(ui, /当前清单 · \{shootingCount\} 条待拍/, '不能把可能失败的计数直接搢进句子')
})

// 审计 25.5：日历加载失败原来是 `catch(() => setEntries([]))`——空日历和「没排内容」长得一样。
test('日历加载失败不能说成「这个月没内容」', () => {
  assert.match(ui, /setLoadError\('日历加载失败，请重试。'\)/)
  assert.match(ui, /\{loadError && <p className="structure-error" role="alert">\{loadError\}/)
  assert.doesNotMatch(ui, /catch\(\(\) => setEntries\(\[\]\)\)/, '失败不能再被当成空数组')
})
