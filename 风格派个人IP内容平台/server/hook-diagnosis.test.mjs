import assert from 'node:assert/strict'
import test from 'node:test'
import { contentCompleteness, findHookMethod, hookMaterialPriorities, hookMethods, materialRichness, openingDiagnosis, suspenseRules, validateHookPlans } from './hook-diagnosis.mjs'

test('开头诊断三个维度齐全，判不出的两项如实留白不猜', () => {
  const report = openingDiagnosis({ body: '很多人以为做内容是靠灵感。其实靠的是把过程写清楚。昨天有个学员来问，为什么发了半年还是没人咨询。' })
  assert.equal(report.dimensions.length, 6)
  // 规则判得出的四项要给出真假判断。
  ;['hook', 'suspense', 'credibility', 'spoken'].forEach(id => {
    const item = report.dimensions.find(entry => entry.id === id)
    assert.equal(item.judged, true)
    assert.equal(typeof item.problem, 'boolean')
  })
  // 独立性、匹配度要读懂语义：标成判不了，问题留 null，不能编一个结论。
  ;['independence', 'match'].forEach(id => {
    const item = report.dimensions.find(entry => entry.id === id)
    assert.equal(item.judged, false)
    assert.equal(item.problem, null)
    assert.match(item.note, /判不了/)
  })
  assert.ok(report.first.includes('很多人以为'), '诊断要指出第一句是哪句')
})

test('悬念看第一句：给完结论算问题，问句不算', () => {
  const gaveAway = openingDiagnosis({ body: '其实做内容的关键是选题。后面都是展开。' })
  assert.equal(gaveAway.dimensions.find(item => item.id === 'suspense').problem, true)
  const asked = openingDiagnosis({ body: '为什么你发了半年还是没人咨询？后面是展开。' })
  assert.equal(asked.dimensions.find(item => item.id === 'suspense').problem, false)
  // Hook：第一句有数字或反差算有抓手。
  const withNumber = openingDiagnosis({ body: '去年我发了 1200 条内容，咨询只有 3 个。' })
  assert.equal(withNumber.dimensions.find(item => item.id === 'hook').problem, false)
  const flat = openingDiagnosis({ body: '今天我们来聊聊内容这件事。还有别的。' })
  assert.equal(flat.dimensions.find(item => item.id === 'hook').problem, true)
})

test('口播友好复用结构层那把尺子，长句和书面语要判成问题', () => {
  const long = openingDiagnosis({ body: `${'这个开头我要一口气说很长很长'.repeat(3)}。` })
  assert.equal(long.dimensions.find(item => item.id === 'spoken').problem, true)
  const written = openingDiagnosis({ body: '综上所述，内容是系统的产物。' })
  assert.equal(written.dimensions.find(item => item.id === 'spoken').problem, true)
})

test('素材丰富度按源技能分三档，并把缺的维度列出来', () => {
  const none = materialRichness({ body: '今天说说我的想法。做内容这件事挺重要的。' })
  assert.equal(none.verdict, 'stop')
  assert.equal(none.count, 0)
  assert.equal(none.missing.length, 5)
  assert.match(none.message, /写不出好开头/)

  const two = materialRichness({ body: '去年有个学员来问，为什么发了半年没人看。' })
  assert.equal(two.count, 2)
  assert.equal(two.verdict, 'limited')
  assert.match(two.message, /冲击力会受限/)

  const many = materialRichness({ body: '去年我发了 1200 条内容，学员说焦虑到想放弃。其实关键是选题。老师也讲过。' })
  assert.ok(many.count >= 3)
  assert.equal(many.verdict, 'ready')
  assert.match(many.message, /可以出方案/)
  // 素材库里的金句也算素材，不只看正文。
  assert.equal(materialRichness({ body: '今天说说想法。', materialText: '其实选题决定一切。' }).dimensions.find(item => item.id === 'quote').found, true)
})

test('内容完整性沿用源技能的三档：没有正文就停，太短就警告', () => {
  assert.equal(contentCompleteness({ body: '' }).verdict, 'stop')
  assert.match(contentCompleteness({ body: '' }).message, /先把正文写出来/)
  assert.equal(contentCompleteness({ body: '短'.repeat(120) }).verdict, 'warn')
  assert.match(contentCompleteness({ body: '短'.repeat(120) }).message, /正文太短/)
  assert.equal(contentCompleteness({ body: '正'.repeat(300) }).verdict, 'ok')
})

test('三种生成方法照源技能抄全，方法二要说清真素材得用户给', () => {
  assert.deepEqual(hookMethods.map(item => item.id), ['素材提取', '素材增补', '悬念制造'])
  assert.equal(findHookMethod('素材增补').needsUserMaterial, true)
  assert.match(findHookMethod('素材增补').note, /不替你编/)
  assert.equal(findHookMethod('悬念制造').note.includes('为什么'), true)
  assert.equal(findHookMethod('不存在的方法'), null)
  // Hook 类型优先级表照抄，晒结果+反转排最高。
  assert.equal(hookMaterialPriorities[0].type, '晒结果 + 反转')
  assert.equal(hookMaterialPriorities[0].stars, 5)
  assert.deepEqual(suspenseRules.principles, ['不要直接给答案', '用「为什么」而不是「证明」', '用「问题」而不是「结论」'])
  assert.match(suspenseRules.good, /为什么赚不到钱/)
})

test('开头方案必须溯源到三种方法之一，编的、空的、重复的一律丢掉', () => {
  const plans = validateHookPlans([
    { method: '素材提取', opening: '去年我发了 1200 条，咨询只有 3 个。', note: '用了结果数字' },
    { method: '凭空编法', opening: '这个方法不存在', note: '编的方法名' },
    { method: '悬念制造', opening: '   ' },
    { method: '素材提取', opening: '去年我发了 1200 条，咨询只有 3 个。', note: '重样' },
    { method: '素材增补', opening: '我连线了 300 个人，发现同一个问题。', note: '补了连线数据' },
  ])
  assert.deepEqual(plans.map(item => item.method), ['素材提取', '素材增补'])
  assert.equal(plans[0].method_label, '方法一：素材提取')
  // 方法二的方案要带上「素材得用户提供」这个标记，避免把编的数字当既有素材用。
  assert.equal(plans[1].needs_user_material, true)
  assert.equal(plans[0].needs_user_material, false)
  assert.deepEqual(validateHookPlans(null), [])
})
