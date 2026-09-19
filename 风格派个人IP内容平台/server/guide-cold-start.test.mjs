import assert from 'node:assert/strict'
import test from 'node:test'
import { guideState, hasContent } from './guide.mjs'

// 回归：真实界面路径下，新账号看完 4 步定位访谈点「稍后填写」，
// 服务端会留下 { status: 'draft', interview_answers: {}, ... } 这样一份空定位文档。
// 它不能被当成「写过定位」，否则 1/11 直接变成已完成，冷启动降级永远不出现。

test('跳过访谈留下的空定位文档不算做过定位', () => {
  // 这是真实界面走查里服务端实际存下来的形状：键在不等于内容在。
  const skipped = {
    status: 'draft',
    monetization_goals: [],
    acquisition_goals: [],
    other_goals: [],
    interview_answers: { 0: '' },
    updated_at: '2026-09-19T01:58:28.767Z',
    interview_step: 0,
    onboarding_seen_at: '2026-09-19T01:58:28.759Z',
  }
  assert.equal(hasContent(skipped), false)

  // 真写过就必须算：用户自己填的回答就是内容。
  assert.equal(hasContent({ status: 'draft', interview_answers: { 0: '我做家政代运营' } }), true)
  assert.equal(hasContent({ status: 'draft', money_statement: '靠陪跑收费' }), true)
  // 写法不同的空值也不能算。
  assert.equal(hasContent({ audiences: [''] }), false)
  assert.equal(hasContent({ audiences: ['创业者'] }), true)
})

test('新账号（含跳过访谈的那种）走新手教程并给冷启动降级', () => {
  const skipped = { status: 'draft', interview_answers: { 0: '' }, interview_step: 0, onboarding_seen_at: '2026-09-19T01:58:28.759Z' }
  const state = guideState({ positioning: skipped, materials: [], research: [] }, {})
  assert.equal(state.mode, '新手教程')
  assert.equal(state.done_count, 0)
  assert.equal(state.next.id, 'positioning')
  assert.equal(state.degraded.active, true)
  assert.deepEqual(state.degraded.missing, ['定位', '素材', '对标'])
  assert.equal(state.degraded.paths.length, 3)

  // 一旦真写了定位，降级就不再触发，下一步顺着链路往下走。
  const positioned = guideState({ positioning: { status: 'draft', interview_answers: { 0: '我做家政代运营' } }, materials: [], research: [] }, {})
  assert.equal(positioned.mode, '任务前路由')
  assert.equal(positioned.done_count, 1)
  assert.equal(positioned.next.id, 'materials')
  assert.equal(positioned.degraded.active, false)
})
