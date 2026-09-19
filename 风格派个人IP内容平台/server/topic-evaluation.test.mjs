import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultTopicFields, evaluateTopic } from './topic-evaluation.mjs'

const context = {
  profile: { role: '创业顾问', audiences: ['个人 IP 创作者'], problems: ['不会持续创作'], pillars: ['真实复盘'], viewpoints: ['先做再优化'], prohibited_patterns: [], source_refs: [] },
  strategy: { stage: 'cold_start' },
  research: [{ title: '创业者失败复盘', captured_at: new Date().toISOString(), metrics: { discussions: 2800, growth: 32 } }],
  materials: [{ id: 1 }],
  structures: [{ id: 2 }],
}

test('evaluateTopic returns exactly seven bounded dimensions and evidence', () => {
  const result = evaluateTopic({ title: '创业者失败复盘', strategy_layer: 'trust' }, context, '2026-09-03T00:00:00.000Z')
  assert.equal(Object.keys(result.dimensions).length, 7)
  assert.ok(Object.values(result.dimensions).every(item => item.score >= 0 && item.score <= 100))
  assert.ok(result.evidence.length >= 7)
  assert.equal(result.evaluated_at, '2026-09-03T00:00:00.000Z')
})

test('missing research does not invent traffic evidence', () => {
  const result = evaluateTopic({ title: '没有来源数据的选题', strategy_layer: 'reach' }, { ...context, research: [] })
  assert.match(result.dimensions.traffic_potential.evidence[0], /没有可用/)
  assert.ok(result.dimensions.traffic_potential.suggestions.length)
})

test('compliance risk lowers score and gives an actionable suggestion', () => {
  const result = evaluateTopic({ title: '第一最好稳赚的方法', strategy_layer: 'conversion' }, context)
  assert.equal(result.dimensions.compliance_risk.score, 10)
  assert.ok(result.dimensions.compliance_risk.suggestions.length)
})

// 阶段 3「减负」第 1 条：前台只需要两句话——做不做、先做什么。
// 七维一个不减，只是不再逼着人先读七个数字。
test('前台两句话：结论和第一步一定有，七维仍然一个不少', () => {
  const cases = [
    { name: '正常选题', topic: { title: '创业者失败复盘', strategy_layer: 'trust' }, ctx: context },
    { name: '全维不及格', topic: { title: '第一最好稳赚的方法', strategy_layer: 'conversion' }, ctx: context },
    { name: '一条来源都没有', topic: { title: '没有来源数据的选题', strategy_layer: 'reach' }, ctx: { ...context, research: [] } },
    { name: '档案也空着', topic: { title: '冷启动第一条', strategy_layer: 'reach' }, ctx: { ...context, profile: {}, research: [] } },
  ]
  for (const item of cases) {
    const result = evaluateTopic(item.topic, item.ctx)
    assert.ok(result.conclusion?.trim(), `${item.name}：要有一句能直接说出口的结论`)
    assert.ok(result.first_step?.trim(), `${item.name}：要有一句「先做这一步」`)
    assert.equal(Object.keys(result.dimensions).length, 7, `${item.name}：七维一个都不能少`)
    assert.ok(['do', 'revise', 'defer'].includes(result.decision), `${item.name}：决策只能是做/改/缓`)
  }
})

test('legacy topic fields receive safe defaults without overwriting evaluation', () => {
  const evaluated = evaluateTopic({ title: '已评估', strategy_layer: 'trust' }, context)
  const topic = defaultTopicFields({ id: 1, title: '已评估', evaluation: evaluated, workflow_status: 'evaluated' })
  assert.equal(topic.workflow_status, 'evaluated')
  assert.deepEqual(topic.evaluation, evaluated)
  assert.deepEqual(topic.evidence, [])
})
