// 逻辑检查第一条：痛点-解法错位。
//
// 这套设计里最要紧的是「引用必须真的在正文里」这道闸门：
// 模型最常见的失败不是答错，是把「我认为的问题」写成「原文里的话」。
// 所以这里重点钉住编造引用必须被丢掉，而不是钉模型判得准不准。
import test from 'node:test'
import assert from 'node:assert/strict'

import { logicCheckSystemPrompt, logicCheckVariables, logicSignalSpans, parseLogicFindings, parseLogicOutput, splitSentences } from './draft-logic.mjs'

// 验收用的真稿子。它的毛病是明确的：提了「怕得罪人」「表情不自然」，
// 但后面给的办法（切素材）治的是「不知道说什么」。那两个问题从头到尾没人管。
const realDraft = [
  '情绪丰富，是搞钱的累赘。',
  '你现在的痛点是不是这样：刷到爆款心痒痒，一打开摄像头，脑子一片空白，或者想着“这句话会不会得罪人”、“那个表情自不自然”。这一纠结，半天过去了，视频还没拍。你以为需要灵感，其实你需要的是把念头切成碎片。',
  '我有一个判断：共情力强的人，做产品思维反而弱。因为你们太在意“别人怎么看”，导致动作变形，无法复制。我以前的内耗，就是总想着“感觉对了再动”，结果越等越焦虑，最后啥也没做成。后来我把这种内耗硬改成了生产力，核心就一句：把想法切成原子素材。',
  '不是让你憋大招，而是把一句话、一个场景、一个反直觉的判断，拆开了单发。能卖、能复用，这就是资产。',
  '我拆完素材，强制自己过三关：第一，这个点能发哪个平台？第二，能改几个版本？第三，有没有反常识？只要有一个没过，我都不动嘴，直接扔掉。',
  '很多人失败，是因为先想演，再想拍。我是先评估素材，再决定拍不拍。我不是没情绪，我是没空。情绪留给生活，系统留给生产。',
].join('\n')

test('分句：按中文句读切开，不丢句子', () => {
  const sentences = splitSentences('第一句。第二句！第三句？多行\n下一行')
  // 换行也是一句的边界：口播稿常常一行一句，不切开的话问题句会和别的粘在一起。
  assert.deepEqual(sentences, ['第一句。', '第二句！', '第三句？', '多行', '下一行'])
  assert.deepEqual(splitSentences(''), [])
  assert.deepEqual(splitSentences(null), [])
})

test('圈范围：那篇真稿子必须被判定为值得送模型查', () => {
  const spans = logicSignalSpans(realDraft)
  assert.equal(spans.shouldCheck, true, '既有问题也有办法，就该查')
  // 「会不会得罪人」「自不自然」是这篇真正的病根，必须圈到。
  const problemText = spans.problems.join('\n')
  assert.match(problemText, /会不会得罪人/)
  assert.match(problemText, /自不自然/)
  // 办法句也要圈到，否则模型看不到「治的是什么」。
  assert.match(spans.remedies.join('\n'), /你需要的是/)
  assert.match(spans.remedies.join('\n'), /核心就一句/)
})

test('圈范围：只提出问题、没给办法的，不送模型查', () => {
  const spans = logicSignalSpans('你是不是也这样？是不是很难？为什么总是做不好？')
  assert.equal(spans.problems.length > 0, true)
  assert.equal(spans.shouldCheck, false, '没有办法句就无从判断治没治错病，别浪费一次调用')
})

test('圈范围：平铺直叙的稿子不送模型查', () => {
  const spans = logicSignalSpans('今天讲三个动作。第一个是抬手。第二个是转身。第三个是收工。')
  assert.deepEqual(spans.problems, [])
  assert.equal(spans.shouldCheck, false)
})

test('提示词：把两个问题都问死，并逼模型引用原句', () => {
  const system = logicCheckSystemPrompt.join('\n')
  assert.match(system, /逐字引用/)
  assert.match(system, /引用不到原句就不要报/)
  assert.match(system, /最多报两条/)
  // 短视频本来就靠跳跃制造节奏，这条不写模型会把所有省略都判成毛病。
  assert.match(system, /省略和跳跃/)
  // 规则圈出来的句子必须真的交给模型，否则规则白圈了。
  const vars = logicCheckVariables(realDraft)
  assert.equal(vars.body, realDraft)
  assert.ok(vars.problems.some(text => /会不会得罪人/.test(text)))
  assert.ok(vars.remedies.some(text => /你需要的是/.test(text)))
})

test('解析：编造的引用必须被丢掉', () => {
  // 这句是「我以为的问题」，正文里根本没有——真模型最常犯的错就是这个。
  const content = JSON.stringify({
    findings: [{ problem: '你害怕镜头里的自己不够好看', remedy: '切素材', explain: '治的不是这个' }],
  })
  assert.deepEqual(parseLogicFindings(content, realDraft), [], '引用不在正文里就该丢，不能放行')
})

test('解析：真引用放行，并按 locatable 挂上', () => {
  const content = JSON.stringify({
    findings: [{ problem: '这句话会不会得罪人', remedy: '把念头切成碎片', explain: '切素材治的是不知道说什么，不是怕得罪人' }],
  })
  const findings = parseLogicFindings(content, realDraft)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].code, 'problem_remedy_mismatch')
  assert.equal(findings[0].quote, '这句话会不会得罪人')
  assert.equal(findings[0].scope, 'locatable')
  assert.match(findings[0].message, /怕得罪人|治的是另一件事/)
  // 措辞不能指向用户做不到的操作。
  assert.doesNotMatch(findings[0].message, /定位替换/)
})

test('解析：模型不听话时的三种废物输出都要能兜住', () => {
  // 带代码块围栏
  const fenced = '```json\n{"findings":[{"problem":"这句话会不会得罪人","explain":"没回应"}]}\n```'
  assert.equal(parseLogicFindings(fenced, realDraft).length, 1)
  // 前后带废话
  const chatty = '好的，我分析了一下：{"findings":[{"problem":"这句话会不会得罪人","explain":"没回应"}]} 以上。'
  assert.equal(parseLogicFindings(chatty, realDraft).length, 1)
})

// 2026-09-20 改：这里原来断言「完全不是 JSON 就返回空数组」。那个断言钉住的正是 bug:
// 返回空数组，上层 runLogicCheck 会写 status: 'passed'，界面显示「已通过」——
// 把「模型输出坏了」渲染成「查过没问题」。假阴性比假阳性危险，所以现在抛错，由路由转 502。
// 这个约定跟 claims / deconstruct / 定位 / 选题的 parseXxx 一致（它们也是抛错）。
test('解析：模型返回不可解析时必须报错，不能当成「没问题」', () => {
  const garbage = ['我觉得这篇没问题。', '', null, undefined, 'invalid JSON', '{"findings":"没有"}', '{"其他":[]}']
  for (const content of garbage) {
    assert.throws(
      () => parseLogicFindings(content, realDraft),
      error => error.code === 'MODEL_OUTPUT_INVALID' && /可解析/.test(error.message),
      `这份输出应当被报成「解析失败」而不是「没问题」：${JSON.stringify(content)}`,
    )
  }
  // 真的报了、只是没有条目，算正常结果（"findings":[] 就是模型说没问题）。
  assert.deepEqual(parseLogicFindings('{"findings":[]}', realDraft), [])
})

// 被引用闸门丢掉的条数必须能查：上层靠它把「模型提了几条、丢了几条」说出来。
// 不说的话，「模型提了但全被丢掉」在界面上和「模型说没问题」长得一模一样。
test('解析：模型报了但引用对不上时，条数要单独数出来', () => {
  const content = JSON.stringify({
    findings: [
      { problem: '这句正文里根本没有', explain: 'a' },
      { problem: '这句也没有', explain: 'b' },
      { problem: '这句话会不会得罪人', explain: 'c' },
    ],
  })
  const { findings, reported, unverifiable } = parseLogicOutput(content, realDraft)
  assert.equal(reported, 3, '模型一共报了几条')
  assert.equal(unverifiable, 2, '引用对不上正文的几条要数出来')
  assert.equal(findings.length, 1, '只有引用真在正文里的那条放行')
})

test('解析：过短的片段和过长的整段都不算一个问题', () => {
  const short = JSON.stringify({ findings: [{ problem: '情绪', explain: 'x' }] })
  assert.deepEqual(parseLogicFindings(short, realDraft), [], '两个字算不上一个问题')
  const long = JSON.stringify({ findings: [{ problem: realDraft, explain: 'x' }] })
  assert.deepEqual(parseLogicFindings(long, realDraft), [], '把整篇抄回来不算指得出某一处')
})

// 真模型实测（2026-09-20）：引用了 4 字的「为什么？」——
// 它在正文里确实找得到，能过「必须真的在正文里」那道闸门，但挂上去看不出指哪里。
// 这类丢掉必须计数：不数的话，它和「模型没报」在界面上长得一样。
test('解析：引句在正文里但太短时，要单独计数', () => {
  const content = JSON.stringify({
    findings: [
      { problem: '情绪丰富', explain: '四个字，挂不到具体那一处' },
      { problem: '这句话会不会得罪人', explain: '够长，能挂' },
    ],
  })
  const { findings, reported, unverifiable, unanchored } = parseLogicOutput(content, realDraft)
  assert.equal(reported, 2, '模型一共报了几条')
  assert.equal(unanchored, 1, '引句太短的那条要单独计数')
  assert.equal(unverifiable, 0, '它的引用在正文里，不算「对不上原句」')
  assert.equal(findings.length, 1, '够长的那条照旧放行')
  assert.equal(findings[0].quote, '这句话会不会得罪人')
})

test('解析：报太多也只留两条，同一处不重复报', () => {
  const content = JSON.stringify({
    findings: [
      { problem: '这句话会不会得罪人', explain: 'a' },
      { problem: '这句话会不会得罪人', explain: 'b' },
      { problem: '那个表情自不自然', explain: 'c' },
      { problem: '情绪丰富，是搞钱的累赘', explain: 'd' },
    ],
  })
  const findings = parseLogicFindings(content, realDraft)
  assert.equal(findings.length, 2)
  assert.equal(new Set(findings.map(item => item.quote)).size, 2, '同一处不该报两遍')
})

// 形状契约：findings 会直接当作 DraftCheck.evidence 传给界面（server/index.mjs 的 runLogicCheck），
// 界面按对象取值渲染。这里把契约钉住——2026-09-19 出过一次 bug：当时传的是字符串数组，
// 界面拿不到 .message / .scope，结果在界面上渲染不出来，而 server/ 是纯 JS，tsc 拦不住。
// 这些字段名跟 src/main.tsx 的 DraftCheck.evidence 类型声明一一对应，改前端类型时记得回来同步。
test('形状契约：findings 的字段就是界面 DraftCheck.evidence 要的那几个', () => {
  // 复用同一个 realDraft 夹具，保证引用一定真在正文里（过第一道闸门）。
  const content = JSON.stringify({ findings: [{ problem: '情绪丰富，是搞钱的累赘', explain: '后面讲的是算账，没有回应这句' }] })
  const findings = parseLogicFindings(content, realDraft)
  assert.equal(findings.length, 1, '这条应该被放行')

  const one = findings[0]
  // 三个必填字段：缺任何一个，界面那一行就渲染不出来（不是显示得难看，是根本不显示）。
  for (const key of ['code', 'message', 'severity']) {
    assert.ok(one[key] !== undefined && one[key] !== '', `缺必填字段 ${key}——界面会渲染不出来`)
  }
  assert.equal(typeof one.message, 'string')
  assert.equal(typeof one.severity, 'string')
  // 可定位标记：界面的 MarkerScope 按它决定要不要提示「这一条指得出具体词句，能单独改」。
  assert.equal(one.scope, 'locatable')

  // 原句必须同时出现在 quote 和 message 里。
  // quote 供界面按需单独成行；message 是通用列表实际显示的那行文字，
  // 所以即便界面不专门渲染 quote，用户也不会看不到原文。
  assert.ok(realDraft.includes(one.quote), 'quote 必须真在正文里')
  assert.ok(one.message.includes(one.quote), 'message 里要带上原句，否则通用列表看不到原文')
})
