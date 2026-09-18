import assert from 'node:assert/strict'
import test from 'node:test'
import { aiFeatures } from './ai-features.mjs'
import { aiFeatureCodeOf, diagnosticReport, gateCodes, scanGeneratedBody } from './draft-checks.mjs'

const reportOf = body => diagnosticReport({ body, platform: '抖音' })
const hasCode = (body, code) => reportOf(body).entries.some(entry => entry.code === code)
const quoteOf = (body, code) => reportOf(body).entries.find(entry => entry.code === code)?.quote

test('22 个特征每条要么有检测器，要么有不适用理由，没有第三种状态', () => {
  const mapped = new Set(Object.values(aiFeatureCodeOf))
  assert.equal(aiFeatures.length, 22)
  for (const feature of aiFeatures) {
    const detected = mapped.has(feature.code)
    const reason = String(feature.not_applicable || '').trim()
    assert.equal(detected && reason ? 'both' : detected || reason ? 'one' : 'none', 'one', `#${feature.id} ${feature.code} 必须二选一`)
    if (reason) assert.ok(reason.length > 12, `#${feature.id} 的不适用理由太短`)
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
