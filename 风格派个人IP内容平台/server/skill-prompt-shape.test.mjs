import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolvePrompt } from './llm.mjs'

// 这条测试管两件事：
//   1. skill 模块的提示词导出**只能是约定内的那几种形状**（出现第五种就红）；
//   2. 提示词一律在 `llm.mjs` 那个入口被消化掉，**调用方不用记哪个模块是哪一种**。
//
// 背景（2026-09-19 审计 25.7）：9 个模块的提示词导出三种形状并存，调用方必须记住每个是哪种。
// 2026-09-20 的收口方式是**在调用模型那一层加归一化入口**（`resolvePrompt` / `promptMessages`），
// 而不是挨个改 9 个模块：改模块要动所有调用点，风险更大；归一化只需保证边界认得出。
//
// 顺手堵掉的真实缺陷：`generateStructured` 以前把 instruction 直接跟后缀字符串相加，
// 而 `logicCheckSystemPrompt` 是**逐行数组**——JS 拿逗号把数组串起来，提示词的换行结构就这么没了，
// 而且不报错。现在边界会按换行拼，认不出的形状直接抛。
const EXPECTED = {
  'claims.mjs': { export: 'claimsSystemPrompt', shape: 'string' },
  'content-form.mjs': { export: 'contentFormSystemPrompt', shape: 'string' },
  'deconstruct.mjs': { export: 'deconstructSystemPrompt', shape: 'string' },
  'draft-logic.mjs': { export: 'logicCheckSystemPrompt', shape: 'array' },
  'draft-writing.mjs': { export: 'draftBriefPrompt', shape: 'function' },
  'ideas.mjs': { export: 'titleIdeasPrompt', shape: 'function' },
  'publish-risk.mjs': { export: 'publishRiskPrompt', shape: 'function' },
  'resonance.mjs': { export: 'resonancePrompt', shape: 'function' },
  'script-flow.mjs': { export: 'scriptFlowPrompt', shape: 'function' },
}

// 边界认得出这四种。第五种形状出现就红——要么在边界里加支持，要么把模块改回这四种之一。
const KNOWN_SHAPES = ['string', 'array', 'function', 'object']
const shapeOf = value => (Array.isArray(value) ? 'array' : value && typeof value === 'object' ? 'object' : typeof value)

test('skill 模块的提示词导出只能是约定内的形状', async () => {
  const drift = []
  for (const [file, { export: name, shape }] of Object.entries(EXPECTED)) {
    const mod = await import(new URL(`./${file}`, import.meta.url))
    const value = mod[name]
    assert.notEqual(value, undefined, `${file} 应当导出 ${name}——这个测试的抽取方式可能已失效`)
    const actual = shapeOf(value)
    if (actual !== shape) drift.push(`${file} 的 ${name}：记录是 ${shape}，实际是 ${actual}`)
    if (!KNOWN_SHAPES.includes(actual)) drift.push(`${file} 的 ${name}：形状 ${actual} 不在边界认得出的四种里`)
  }
  assert.deepEqual(drift, [], `提示词导出形状变了：\n${drift.join('\n')}\n若是新增模块或有意的统一，改这份 EXPECTED；若无意改的，边界可能已经不认了。`)
})

test('归一化入口认得出这四种形状，认不出的当场抛', () => {
  // 纯字符串
  assert.deepEqual(resolvePrompt('你是助手'), { system: '你是助手' })
  // 逐行数组：必须按换行拼，不能按逗号（这就是以前那个静默的错法）
  assert.deepEqual(resolvePrompt(['第一行', '第二行']), { system: '第一行\n第二行' })
  assert.deepEqual(resolvePrompt(['第一行', '', '第二行']), { system: '第一行\n第二行' }, '空行应当被丢掉，不要留下空换行')
  // 函数（skill 模块里最常见的那种）
  assert.deepEqual(resolvePrompt(() => '函数给的'), { system: '函数给的' })
  // {system, user} 对象：两段都要保留
  assert.deepEqual(resolvePrompt({ system: ['一', '二'], user: '二段' }), { system: '一\n二', user: '二段' })
  // 认不出的形状：抛，不许悄悄变成 "a,b,c" 那种东西
  assert.throws(() => resolvePrompt(42), /形状不认识/, '数字不是提示词，应当当场抛')
  assert.throws(() => resolvePrompt(null), /形状不认识/)
  assert.throws(() => resolvePrompt({ user: '只有二段' }), /形状不认识/, '对象必须有 system')
  assert.throws(() => resolvePrompt({ system: '   ' }), /是空的/)

  // 反证：把「数组按换行拼」改成按逗号拼，上面第一条断言会红。
  const naive = ['第一行', '第二行'] + ' 后缀'
  assert.equal(naive, '第一行,第二行 后缀', 'JS 默认就是这么串数组的——所以才必须在边界拼')
})

// 静态一条：提示词不许绕过归一化入口直接塞进 messages。
// 这里点名的是本项目 skill 模块的导出名与构造器；`content:` 右边出现它们就是漏了边界。
test('提示词不许绕过归一化入口直接进 messages', () => {
  const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8')
  const names = ['claimsSystemPrompt', 'contentFormSystemPrompt', 'deconstructSystemPrompt', 'logicCheckSystemPrompt', 'draftBriefPrompt(', 'draftDeaiPrompt(', 'draftGateRewritePrompt(', 'draftPlatformRevisePrompt(', 'draftSpokenPrompt(', 'draftReplacePrompt(', 'titleIdeasPrompt(', 'hookIdeasPrompt(', 'publishRiskPrompt(', 'resonancePrompt(', 'scriptFlowPrompt(']
  const bypass = []
  for (const line of source.split('\n')) {
    if (!/content:/.test(line)) continue
    // 允许：content 走 resolvePrompt(...) / promptMessages(...)（即已经从边界过了一遍）
    if (/content:\s*(resolvePrompt|promptMessages)\(/.test(line)) continue
    for (const name of names) if (line.includes(name)) bypass.push(`${name} → ${line.trim().slice(0, 120)}`)
  }
  assert.deepEqual(bypass, [], `这些地方把提示词直接塞进了 messages，没过归一化入口：\n${bypass.join('\n')}`)

  // 防空过：得真扫到了 messages 拼装，不然上面的循环一次都不跑。
  assert.ok(/content:\s*(resolvePrompt|promptMessages)\(/.test(source), 'index.mjs 里应当能看到「提示词过了边界」，否则这条测试可能是空转')
})
