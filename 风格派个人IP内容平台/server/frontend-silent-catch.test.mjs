// 前端「静默吞错」的预算棘轮。
//
// 由来（2026-09-20 审计）：src/main.tsx 里有 30+ 处把失败吞成 undefined 的 catch，
// 其中一批是「用户主动点了按钮」——请求失败了界面上一个字都不说。
// 用户分不清「查了没问题」和「压根没查成」，这跟「没查显示成已通过」是同一类毛病。
//
// **2026-09-20 下午改了口径**：`apiJson` 现在**默认会把失败报出来**（App 顶部一条提示，
// 见 `server/api-failure-visibility.test.mjs`），需要安静的调用点显式传 `{ silent: true }`。
// 所以这里的空捕获**不再等于「用户什么都看不到」**——它只是「这一处没有就地提示」。
// 这道棘轮仍然有价值：它挡住「继续悄悄多出来」，并逼下一个想加空捕获的人做一次有意识的决定。
//
// 它管不住的：位置合不合理、吞掉的是不是用户能看见的事。它只管数量不无声增长。
// 所以数字变小是好事（修一处就往下调一格），变大必须配一句理由。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

// 空捕获的判定：.catch(() => undefined) 和 .catch(() => {})。
// 注意不算 `catch { /* 有注释说明为什么能吞 */ }` 这种——那是带说明的显式决定，代码里有注释可查。
// 也不算**整行都是注释**的行（2026-09-20 补）：注释里提一句这个写法不该把预算抬上去
// （真发生过：某处注释写「原来是 .catch(() => undefined)」，预算就多了一格）。
// 行尾注释里的提及仍会计入——那种少见，宁可多要一格也不漏扫一个真的。
const silentCatch = /\.catch\(\s*\(\s*\)\s*=>\s*(?:undefined|\{\s*\})\s*\)/g
const isCommentOnlyLine = line => /^\s*(?:\/\/|\*)/.test(line)
const countSilentCatches = text => text.split('\n').filter(line => !isCommentOnlyLine(line)).reduce((sum, line) => sum + (line.match(silentCatch) || []).length, 0)

// 扫描范围：前端源码和桌面壳。新文件默认预算 0——新文件里冒出一个空捕获，就该红。
const roots = ['src', 'desktop']
const skipped = /(\.test\.|node_modules|dist)/
const budget = {
  // 2026-09-20：main.tsx 已到 0——每一处吞掉都写明了为什么（顶部提示已报 / 故意安静 / 响应体解析兑底）。
  // 从今往后这里新增**任何**一处空捕获都红，不用再靠「预算还剩几格」这种模糊感觉。
  'src/main.tsx': 0,
  'desktop/main.mjs': 1,
}

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = `${dir}/${entry.name}`
  return entry.isDirectory() ? walk(path) : [path]
})

test('前端静默吞错不许无声增长（棘轮）', () => {
  const files = roots.flatMap(walk).filter(path => /\.(?:tsx?|mjs|jsx?)$/.test(path) && !skipped.test(path))
  // 防「空过」：扫不到文件的话下面的循环一次都不跑，这条测试就永远绿。
  assert.ok(files.includes('src/main.tsx'), '至少要扫到 src/main.tsx，否则这条测试是空转')
  assert.ok(files.includes('desktop/main.mjs'), '至少要扫到 desktop/main.mjs')

  const actual = {}
  for (const path of files) {
    const count = countSilentCatches(readFileSync(path, 'utf8'))
    if (count) actual[path] = count
  }

  const grew = Object.entries(actual).filter(([path, count]) => count > (budget[path] || 0))
  const messages = grew.map(([path, count]) => `${path}: ${budget[path] || 0} → ${count}`)
  assert.deepEqual(grew, [], [
    '空捕获变多了。两种处理方式，选一个：',
    '1. 把失败说出来（用户点了按钮没反应 / 数据加载失败显示成空，都是这一类）；',
    `2. 确实可以吞，就把 budget 里的数字改成实际值，并在上面写清为什么。\n${messages.join('\n')}`,
  ].join('\n'))

  // 数量下降了也要来改数字：不然后面可以悄悄加回去，棘轮就失效了。
  const stale = Object.entries(budget).filter(([path, count]) => (actual[path] || 0) < count)
  assert.deepEqual(stale, [], `空捕获比预算少了，把 budget 里的数字调小（往下只许一次一格）：${stale.map(([path, count]) => `${path}: ${count} → ${actual[path] || 0}`).join('、')}`)

  // 顺带把「现在允许有多少」钉在断言里，让人一眼看到基数。
  assert.equal(Object.values(actual).reduce((sum, count) => sum + count, 0), Object.values(budget).reduce((sum, count) => sum + count, 0), '预算表中的文件与实际扫描结果不一致')
})
