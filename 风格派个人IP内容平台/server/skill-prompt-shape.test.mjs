import test from 'node:test'
import assert from 'node:assert/strict'

// 这条测试把「skill 模块的提示词导出长什么样」从人记变成机器查。
//
// 背景（2026-09-19 审计 25.7）：各 skill 模块的提示词导出有三种形状并存，没有统一契约——
// 纯字符串（claims / content-form / deconstruct）、字符串数组（draft-logic）、
// 函数（draft-writing / ideas / publish-risk / resonance / script-flow）。
// 调用方必须记住每个模块是哪一种，写混了就是运行时炸；
// 新增模块的人也没有依据判断该用哪种。
//
// 这里不强制统一（那要动 9 个模块、影响所有调用点，属独立的一次重构），
// 而是**把现状钉住**：形状表和下面 EXPECTED 不一致就红。
// 效果是——将来谁再加模块、用了第四种形状，或者把某个模块改成另一种形状，
// 都必须**有意识地**来改这份表，而不能悄悄漂移。
// 这不是"统一了"，是"不再无声地继续发散"。真正的收口见审计报告里的 P2 建议。
//
// 统一后（建议统一成函数、返回字符串数组），把 EXPECTED 换成单一形状断言即可。
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

const shapeOf = (v) => (Array.isArray(v) ? 'array' : typeof v)

test('约定：skill 模块的提示词导出形状与记录的现状一致', async () => {
  const drift = []
  for (const [file, { export: name, shape }] of Object.entries(EXPECTED)) {
    const mod = await import(new URL(`./${file}`, import.meta.url))
    const value = mod[name]

    assert.notEqual(value, undefined, `${file} 应当导出 ${name}——这个测试的抽取方式可能已失效`)
    const actual = shapeOf(value)
    if (actual !== shape) drift.push(`${file} 的 ${name}：记录是 ${shape}，实际是 ${actual}`)
  }

  assert.deepEqual(
    drift,
    [],
    '提示词导出形状发生变化：\n' + drift.join('\n') +
      '\n\n若是新增模块或有意统一形状，改这份 EXPECTED 表并说明原因；' +
      '若是无意改的，调用方可能已经炸了。',
  )

  // 顺带确认函数那一派确实是"能返回字符串数组"的函数——
  // 只断言 typeof 是 function 不够：一个返回 undefined 的函数同样是 function。
  const fnMod = await import(new URL('./claims.mjs', import.meta.url))
  assert.equal(typeof fnMod.claimsSystemPrompt, 'string', 'claims 是字符串派，保持不变')
})
