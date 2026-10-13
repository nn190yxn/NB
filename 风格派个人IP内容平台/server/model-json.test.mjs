import test from 'node:test'
import assert from 'node:assert/strict'
import { jsonCandidates, modelJson } from './model-json.mjs'

test('模型常见的三种「不干净」写法都救得回来', () => {
  assert.deepEqual(modelJson('{"claims":["甲"]}'), { claims: ['甲'] })
  assert.deepEqual(modelJson('```json\n{"claims":["甲"]}\n```'), { claims: ['甲'] })
  assert.deepEqual(modelJson('好的，下面是结果：\n{"claims":["甲"]}\n希望有帮助'), { claims: ['甲'] })
  assert.deepEqual(modelJson('前面有一句铺垫。[{"a":1}]'), [{ a: 1 }])
})

test('字符串值里的裸换行被转义回来，不会整条回答作废', () => {
  const parsed = modelJson('{"judgement":"第一行\n第二行"}')
  assert.equal(parsed.judgement, '第一行\n第二行')
  assert.equal(modelJson('{"note":"缩进\t在这里"}').note, '缩进\t在这里')
})

test('救不回来时报的是「这次回答读不出」，不是「你配置坏了」', () => {
  let error = null
  try { modelJson('我不知道该说什么') } catch (caught) { error = caught }
  assert.equal(error?.code, 'MODEL_OUTPUT_INVALID')
  assert.match(error.message, /重试一次/)
  assert.doesNotMatch(error.message, /配置/)
  assert.match(error.message, /开头「我不知道该说什么」/)
})
test('转义修复不碰合法的转义序列和字符串外的换行', () => {
  assert.deepEqual(modelJson('{"path":"C:\\\\dir\\\\file","multi":"一\n二"}'), { path: 'C:\\dir\\file', multi: '一\n二' })
  assert.deepEqual(modelJson('{"a":1}\n\n'), { a: 1 })
  assert.deepEqual(jsonCandidates('{"a": 1,\n"b": 2}'), ['{"a": 1,\n"b": 2}'], '字符串外的换行是合法空白，不该多出一种候选')
})

test('空回答也报的是同一个码，不会被当成「查过了没问题」', () => {
  assert.throws(() => modelJson('   '), { code: 'MODEL_OUTPUT_INVALID' })
  assert.throws(() => modelJson(null), { code: 'MODEL_OUTPUT_INVALID' })
})
