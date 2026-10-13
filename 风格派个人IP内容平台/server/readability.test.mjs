// 可读性这一轮的回归（2026-10-13 实测报告里的前两条 P1）。
// 为什么写在这里而不是只改样式：这个缺陷的形状是「代码写了、看着对、实际整条失效」，
// 只有能跑的断言才防得住下一次有人再写 `font: 13.5px/1.75 inherit`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { scanGeneratedBody } from './draft-checks.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = () => readFileSync(join(root, 'src/styles.css'), 'utf8')
const ui = () => readFileSync(join(root, 'src/main.tsx'), 'utf8')

test('样式里不许再用 font 简写末尾接 inherit（整条声明会被浏览器丢掉）', () => {
  const source = css()
  // 光秃秃的 `font: inherit;` 是合法的，被禁的是 `font: 13.5px/1.75 inherit;` 这一类。
  const invalid = source.match(/font:\s*[^;}]*\d+(?:\.\d+)?px[^;}]*\binherit\b/g) || []
  assert.deepEqual(invalid, [], `这些 font 简写无效，会被整条忽略：${invalid.join(' | ')}`)
})

test('正文和几个输入框真的拿到了字号与行距（长属性写在规则里）', () => {
  const source = css()
  const body = source.match(/\.draft-body-input \{([^}]*)\}/g) || []
  const withLineHeight = body.find(rule => /line-height:/.test(rule))
  assert.ok(withLineHeight, `.draft-body-input 里必须有一条显式 line-height，实测界面用的是标题字体加粗、行距走浏览器默认`)
  assert.match(withLineHeight, /font-size:\s*1[5-9](?:\.\d+)?px/, '正文要 15px 以上，这一处是要读几千字的编辑器')
  assert.match(withLineHeight, /font-weight:\s*400/, '正文不许用半粗体')
  assert.match(withLineHeight, /font-family:\s*var\(--font-body\)/, '正文用正文字体，不用标题字体')
  assert.match(source, /\.draft-body-main \{[^}]*min-height:\s*4(?:6[0-9]|[7-9]\d|\d{3})px/, '草稿正文框的下限要高于普通输入框')
})

test('全站字号下限 11.5px，不再出现 10 / 10.5 / 11 这三档', () => {
  const source = css()
  const px = [...source.matchAll(/(?:font-size|font)\s*:\s*(?:\d{1,3}\s+)?(\d+(?:\.\d+)?)px/g)].map(match => Number(match[1]))
  // rem 也算进来：根字号是 16px，.7rem 就是 11.2px，光扫 px 会漏掉这一类。
  const rem = [...source.matchAll(/font-size:\s*\.(\d+)rem/g)].map(match => Number(`0.${match[1]}`) * 16)
  const sizes = [...px, ...rem]
  assert.ok(sizes.length > 50, `解析到的字号条数太少（${sizes.length}），断言可能失效`)
  const tooSmall = [...new Set(sizes.filter(size => size < 11.5))].map(size => size.toFixed(2))
  assert.deepEqual(tooSmall, [], `以下字号低于下限：${tooSmall.join('、')}`)
})

test('small 元素有全局下限，不会被浏览器默认的 80% 拖到 10px', () => {
  const source = css()
  // 实测：首页「待拍摄」是 <small>，父级 12.5px，浏览器算出 10.4167px——任何类名规则都没写它。
  assert.match(source, /small \{\s*font-size: max\(11\.5px, \.8em\);?\s*\}/, '要给 small 兜一个全局下限')
})

test('草稿正文框按内容长高，不再固定一屏', () => {
  const source = ui()
  assert.match(source, /const autoGrowDraftBody = \(el: HTMLTextAreaElement \| null\)/, '要有按内容撑高的实现')
  assert.match(source, /className="draft-body-input draft-body-main" ref=\{el => autoGrowDraftBody\(el\)\} disabled=\{busy\} value=\{draft\.body\}/, '撑高只挂在草稿正文那一个框上，别的形式判断输入框不受影响')
})

test('检查折叠标题分语言层与口播结构计数，不再把长句提醒算进「22 特征」', () => {
  const source = ui()
  assert.doesNotMatch(source, /语言层 22 特征：命中/, '原来那句把 6 条长句提醒也算成 22 特征命中，数字是假的')
  assert.doesNotMatch(source, /视为可选/, '「视为可选」会让人以为这些命中可以不管')
  assert.match(source, /entry\.layer !== 'structure'/, '语言层与口播结构要分开计数')
  assert.match(source, /AI 味检查：语言层/, '标题要说清这两层分别命中几处')
})

// 实测界面出现过这样的文案：正文出现自己的经历数量：第一人称经历｜我们常说……（内部标签 + 同一句重复两遍）
test('案例与经历两条提醒给用户看的是人话，不带内部标签，也不重复引用', () => {
  const body = '我有个客户，三个月涨了 2 万粉。这条路径不难。\n\n我复盘过五个账号，发现问题都在开头。\n\n先把内容发出去，再看数据决定下一步怎么调整。'
  const scan = scanGeneratedBody(body, '抖音')
  const caseHit = scan.evidence.find(item => item.code === 'case_claim')
  const experienceHit = scan.evidence.find(item => item.code === 'experience_claim')
  assert.ok(caseHit, '具体案例与数字仍要挑出来')
  assert.ok(experienceHit, '经历数量仍要挑出来')
  for (const item of [caseHit, experienceHit]) {
    assert.doesNotMatch(item.message, /｜/, '内部标签不能漏进用户可见文案')
    assert.doesNotMatch(item.quote, /｜/, '引用就是原句，不拼标签')
    assert.doesNotMatch(item.message, /第一人称经历|案例人物|结果数字/, '理由要说成人话')
    assert.ok(item.message.includes(item.quote), '引用的那句要真的出现在文案里，不能各说各的')
    assert.ok(!/^\s*$/.test(item.quote), '引用不能是空串')
  }
  assert.match(caseHit.quote, /我有个客户/, '引用指向具体那句原文')
  assert.match(experienceHit.quote, /我复盘过五个账号/, '引用指向具体那句原文')
})
