import assert from 'node:assert/strict'
import test from 'node:test'
import { aiFeatures } from './ai-features.mjs'
import { aiFeatureCodeOf, diagnosticReport, gateCodes, scanGeneratedBody } from './draft-checks.mjs'

const reportOf = body => diagnosticReport({ body, platform: '抖音' })
const hasCode = (body, code) => reportOf(body).entries.some(entry => entry.code === code)
const quoteOf = (body, code) => reportOf(body).entries.find(entry => entry.code === code)?.quote

test('22 个特征每条都有检测器，自媒体口播没有不适用逃生门', () => {
  const mapped = new Set(Object.values(aiFeatureCodeOf))
  assert.equal(aiFeatures.length, 22)
  for (const feature of aiFeatures) {
    assert.equal(mapped.has(feature.code), true, `#${feature.id} ${feature.code} 缺检测器`)
    assert.equal(feature.not_applicable, undefined)
  }
})

test('让步模板：三遍命中，一遍不命中，且不拦生成', () => {
  const hit = '虽然报价低，但是询盘来了。虽然内容少，但是人设清楚。虽然更新慢，但是评论区在问。点赞会撒谎。'
  assert.equal(hasCode(hit, 'repeated_concession'), true)
  assert.ok(hit.includes(quoteOf(hit, 'repeated_concession')))
  assert.equal(scanGeneratedBody(hit, '抖音').failed, false)
  assert.equal(gateCodes.includes('repeated_concession'), false)

  const miss = '虽然报价低，但是询盘来了。点赞会撒谎，询盘不会。'
  assert.equal(hasCode(miss, 'repeated_concession'), false)
})

test('起名仪式：同一句式两次命中，一次不命中', () => {
  const hit = '我称之为素材原子化。后面我称之为信任分层。把一件事讲清楚。'
  assert.equal(hasCode(hit, 'naming_ritual'), true)
  assert.equal(quoteOf(hit, 'naming_ritual'), '我称之为')
  const miss = '我称之为素材原子化。把一件事讲清楚就行。'
  assert.equal(hasCode(miss, 'naming_ritual'), false)
})

test('假精确时间：小数秒命中，整数秒不命中', () => {
  const hit = '他愣了 1.7 秒，才把报价说出来。'
  assert.equal(hasCode(hit, 'fake_precise_emotion'), true)
  assert.match(quoteOf(hit, 'fake_precise_emotion'), /1\.7\s*秒/)
  const miss = '他愣了 3 秒，才把报价说出来。'
  assert.equal(hasCode(miss, 'fake_precise_emotion'), false)
})

test('身体感受收束：身体知道答案命中，身体不舒服不命中', () => {
  const hit = '道理说到这里讲不下去了，身体知道答案。'
  assert.equal(hasCode(hit, 'body_feeling_over_logic'), true)
  assert.match(quoteOf(hit, 'body_feeling_over_logic'), /身体知道/)
  const miss = '身体不舒服就停下来，第二天再拍。'
  assert.equal(hasCode(miss, 'body_feeling_over_logic'), false)
})

test('升维深刻：本质上接人生命中，本质上接报价不命中', () => {
  const hit = '报价说不清，本质上这是人生选择。'
  assert.equal(hasCode(hit, 'overfitting_profundity'), true)
  assert.match(quoteOf(hit, 'overfitting_profundity'), /本质上/)
  const miss = '报价说不清，本质上就是你没把数字写上。'
  assert.equal(hasCode(miss, 'overfitting_profundity'), false)
})

test('堵住反驳：两条预判命中，一条不命中', () => {
  const hit = '你可能会说没时间。我知道你要问从哪开始。先改报价。'
  assert.equal(hasCode(hit, 'block_all_rebuttals'), true)
  assert.equal(quoteOf(hit, 'block_all_rebuttals'), '你可能会说')
  const miss = '有人可能会说没时间。先改报价。'
  assert.equal(hasCode(miss, 'block_all_rebuttals'), false)
})

test('知识倾倒：三个术语命中，一个框架不命中', () => {
  const hit = '先上增长模型，再套转化框架，配一套方法论。询盘还是不来。'
  assert.equal(hasCode(hit, 'dump_all_knowledge'), true)
  const miss = '我用这个框架把报价写清楚。'
  assert.equal(hasCode(miss, 'dump_all_knowledge'), false)
})

test('情绪弧线：从痛到燃命中，改报价过程不命中', () => {
  const hit = '情绪从迷茫到清晰再到爆发，故事就圆了。'
  assert.equal(hasCode(hit, 'smooth_emotion_curve'), true)
  const miss = '去年十月询盘很少，后来改了报价。'
  assert.equal(hasCode(miss, 'smooth_emotion_curve'), false)
})

test('毫无犹豫：两条绝对判断命中，单次一定不命中', () => {
  const hit = '毫无疑问所有人都会先改报价。'
  assert.equal(hasCode(hit, 'no_hesitation'), true)
  const miss = '询盘一定来自报价说清。'
  assert.equal(hasCode(miss, 'no_hesitation'), false)
})

test('脆弱感为论点服务：失败后立刻所以你命中，失败过程不命中', () => {
  const hit = '我曾经崩溃过。所以你一定要坚持。'
  assert.equal(hasCode(hit, 'vulnerability_serves_point'), true)
  const miss = '我去年失败过，中间试错过三次，后来才改报价。'
  assert.equal(hasCode(miss, 'vulnerability_serves_point'), false)
})

test('结论包装成协议：当成协议命中，下一步不命中', () => {
  const hit = '说到这里，把这当成你的协议。'
  assert.equal(hasCode(hit, 'conclusion_as_protocol'), true)
  const miss = '下一步你就先改报价。'
  assert.equal(hasCode(miss, 'conclusion_as_protocol'), false)
})

test('句子节奏均匀：五句差不多长命中，长短混用不命中', () => {
  const hit = '先把报价写清。再把案例备好。然后去问一句。接着看谁回复。最后再约咨询。'
  assert.equal(hasCode(hit, 'even_sentence_rhythm'), true)
  const miss = '报价说不清。询盘就不会来，因为对方不知道你能干什么，也不知道找你要花多少钱。'
  assert.equal(hasCode(miss, 'even_sentence_rhythm'), false)
})

test('钩子痛点承诺：前三句钩子加承诺命中，单句结论不命中', () => {
  const hit = '你是不是拆完爆款还是用不出来？每天发了没人看。看完这条你就知道下一步。'
  assert.equal(hasCode(hit, 'hook_pain_promise'), true)
  assert.equal(quoteOf(hit, 'hook_pain_promise'), '你是不是')
  assert.equal(scanGeneratedBody(hit, '抖音').failed, false)
  const miss = '报价说不清，询盘就不会来。我把报价改成先给一次免费诊断。'
  assert.equal(hasCode(miss, 'hook_pain_promise'), false)
})

test('同义词替换：或者说叠也可以叫命中，单次或者说不命中', () => {
  const hit = '这叫增长，或者说爆发，也可以叫起飞。'
  assert.equal(hasCode(hit, 'synonym_swapping'), true)
  const miss = '或者说你先改报价。'
  assert.equal(hasCode(miss, 'synonym_swapping'), false)
})

// 口播稿写「不是X，是Y」（省掉「而」），原来的正则会整类漏判。
test('短式翻转：三次命中，两次不命中', () => {
  const hit = '你要做的不是老师，是那个让人停一下的东西。这不是忽悠，是用反常识抢注意力。这不是方法，是认知没对上。'
  assert.equal(hasCode(hit, 'ai_tone_phrase'), true)
  assert.ok(hit.includes(quoteOf(hit, 'ai_tone_phrase')))

  // 两次不够：源技能的误伤警告写着「一次是正常修辞」，阈值是 800 字内 3 次以上。
  const twice = '你要做的不是老师，是那个让人停一下的东西。这不是忽悠，是用反常识抢注意力。把画面给足。'
  assert.equal(hasCode(twice, 'ai_tone_phrase'), false)

  // 带「而」的长式仍走原来那条正则，不受密度阈值影响。
  const strict = '这不是方法的问题，而是认知的问题。'
  assert.equal(hasCode(strict, 'ai_tone_phrase'), true)
  assert.ok(strict.includes(quoteOf(strict, 'ai_tone_phrase')), '引文必须是原文里真实存在的片段')
})

// 真实稿回归：629 字里 2 处短式翻转，低于阈值，修完也不该报。
// 记下来是因为修前我用它当「漏判」例子时数成了 4 处；实际只有 2 处，结论必须跟着改。
test('真实口播稿：629 字里 2 处翻转不够密度，修完仍不报', () => {
  const body = '你要做的不是老师，是那个让人停一下的东西。把手里那堆完整的素材敲碎。观众不需要你教育他们，他们需要的是被理解。这不是忽悠，是用反常识去抢注意力。别喂观众完整的观点。'
  assert.equal(hasCode(body, 'ai_tone_phrase'), false)
  // 同一段多加一处翻转就到了阈值，说明卡的是密度而不是漏判。
  const crossed = `${body}这不是方法，是认知没对上。`
  assert.equal(hasCode(crossed, 'ai_tone_phrase'), true)
})

// ===== 下面七条原来有检测器、没有 hit/miss 测试 =====
// `ai_tone_phrase` 就是在这个状态下整类漏判了很久。没有对照样本的检测器，
// 它既可能不报，也可能乱报，两种都发现不了。这里把剩下的补齐。

test('每段收束金句：其实……才是命中，普通转折不命中', () => {
  const hit = '大家都在追技巧。其实，慢才是快。'
  assert.equal(hasCode(hit, 'golden_tail'), true)
  assert.ok(hit.includes(quoteOf(hit, 'golden_tail')))
  const miss = '先说报价，再说交付。两件事都要说清楚。'
  assert.equal(hasCode(miss, 'golden_tail'), false)
})

test('万能收尾：未来可期命中，具体下一步不命中', () => {
  const hit = '这条就到这，未来可期。'
  assert.equal(hasCode(hit, 'generic_ending'), true)
  const miss = '下周我把报价表拆给你看。'
  assert.equal(hasCode(miss, 'generic_ending'), false)
})

test('连接词过度：首先其次命中，口语先后不命中', () => {
  const hit = '首先，报价要写清楚。其次，交付要说明白。'
  assert.equal(hasCode(hit, 'connector_abuse'), true)
  const miss = '先看报价，再谈交付。两件事都要说清楚。'
  assert.equal(hasCode(miss, 'connector_abuse'), false)
})

test('假反驳：有人可能会说命中，直给结论不命中', () => {
  const hit = '有人可能会说，这样做太慢。但你算一下就会发现不慢。'
  assert.equal(hasCode(hit, 'fake_rebuttal'), true)
  const miss = '这样做看起来慢，其实交付更快。'
  assert.equal(hasCode(miss, 'fake_rebuttal'), false)
})

test('排比凑数：抽象词三连命中，具体清单不命中', () => {
  const hit = '你要提升认知、格局、视野。'
  assert.equal(hasCode(hit, 'triple_list'), true)
  const miss = '这条要选题、拍摄、剪辑。'
  assert.equal(hasCode(miss, 'triple_list'), false, '具体清单是正常写作，不该当成 AI 排比')
})

test('没有主体的案例：有个朋友命中，第一人称不命中', () => {
  const hit = '有个朋友做了三年没起号。'
  assert.equal(hasCode(hit, 'vague_case'), true)
  const miss = '我自己做了三年没起号。'
  assert.equal(hasCode(miss, 'vague_case'), false)
})

test('咨询腔：赋能闭环命中，大白话不命中', () => {
  const hit = '我们要赋能客户，形成闭环。'
  assert.equal(hasCode(hit, 'consulting_tone'), true)
  const miss = '我要帮客户把报价说清楚。'
  assert.equal(hasCode(miss, 'consulting_tone'), false)
})

