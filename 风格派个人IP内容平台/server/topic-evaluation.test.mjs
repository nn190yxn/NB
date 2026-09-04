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

test('legacy topic fields receive safe defaults without overwriting evaluation', () => {
  const evaluated = evaluateTopic({ title: '已评估', strategy_layer: 'trust' }, context)
  const topic = defaultTopicFields({ id: 1, title: '已评估', evaluation: evaluated, workflow_status: 'evaluated' })
  assert.equal(topic.workflow_status, 'evaluated')
  assert.deepEqual(topic.evaluation, evaluated)
  assert.deepEqual(topic.evidence, [])
})
