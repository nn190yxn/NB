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
  // 新手也不再被指向「定位」：主线从选题开始，四段资产随时能补（阶段 3「减负」第 4 条）。
  assert.equal(state.next.id, 'topics')
  assert.equal(state.degraded.active, true, '资产全空时降级提示仍然要给，只是不再当门槛')
  assert.deepEqual(state.degraded.missing, ['定位', '素材', '对标'])
  assert.equal(state.degraded.paths.length, 3)

  // 一旦真写了定位，降级就不再触发，下一步顺着链路往下走。
  const positioned = guideState({ positioning: { status: 'draft', interview_answers: { 0: '我做家政代运营' } }, materials: [], research: [] }, {})
  assert.equal(positioned.mode, '任务前路由')
  assert.equal(positioned.done_count, 1)
  // 阶段 3「减负」第 4 条：前四段（定位/素材/对标/结构库）移出主线，下一步从「选题」开始，
  // 不再因为没写定位就没路可走。
  assert.equal(positioned.next.id, 'topics', '主线从选题开始，不被四段准备工作挡住')
  assert.equal(positioned.next.index, 1, '主线第一步就是选题')
  assert.equal(positioned.degraded.active, false)
})

test('链路分主线和资产：十一段一段不删，只改出现在哪里', () => {
  const state = guideState({}, {})
  assert.equal(state.total, 11, '十一段一段都没删')
  assert.equal(state.main_total, 7, '主线是选题→初稿→诊断→定稿→拍摄→发布→回流七段')
  assert.equal(state.stages.length, 11, 'stages 仍是完整十一段，界面想全展开也有数据')
  assert.deepEqual(state.asset_stages.map(stage => stage.id), ['positioning', 'materials', 'research', 'structures'])
  assert.ok(state.asset_stages.every(stage => stage.track === 'asset'))
  assert.equal(state.stages.filter(stage => stage.track === 'main').length, 7)
  assert.equal(state.next.id, 'topics', '资产全空也要能走到选题——这就是「不拦」')

  // 资产都补齐了也只是「手头有东西」，主线仍然从选题开始。
  const stocked = guideState({ positioning: { positioning_statement: '做家政代运营' }, materials: [{ id: 1 }], research: [{ id: 1 }], structures: [{ id: 1 }] }, {})
  assert.equal(stocked.next.id, 'topics', '补了资产不等于做了内容，主线还是从选题开始')
  assert.equal(stocked.main_done_count, 0)
  assert.equal(stocked.done_count, 4, '资产仍然算进总进度，没有丢')

  // 主线真的推着走：有了选题就指向初稿。
  const progressed = guideState({ topics: [{ id: 1 }] }, {})
  assert.equal(progressed.next.id, 'draft')
  assert.equal(progressed.next.index, 2)
  assert.equal(progressed.main_done_count, 1)
})
