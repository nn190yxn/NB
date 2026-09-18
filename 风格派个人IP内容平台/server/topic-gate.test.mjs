import assert from 'node:assert/strict'
import test from 'node:test'
import { dimensionPassScore, evaluateTopic } from './topic-evaluation.mjs'

const recent = () => new Date().toISOString()

test('选题把关：全部维度不达标才拦停，并给出「不建议做」与第一步', () => {
  const blocked = evaluateTopic({ title: '第一最好最强的内容', strategy_layer: 'reach' }, { research: [], materials: [], structures: [], profile: {}, strategy: {} })
  assert.equal(blocked.blocked, true, '七个维度全部低于及格线，就该明确不建议做')
  assert.equal(blocked.decision, 'defer', '拦停时决策必须落到暂缓，不能还留「建议改方向」')
  assert.match(blocked.conclusion, /不建议做/)
  assert.match(blocked.first_step, /先别做这一条/)
  const scores = Object.values(blocked.dimensions).map(item => item.score)
  assert.equal(scores.length, 7, '维度数量要保持七个，不因为「五维诊断」的说法砍掉制作成本和合规风险')
  assert.ok(scores.every(score => score < dimensionPassScore))
})

test('选题把关：只要有一个维度达标就不拦停，第一步取自最弱的那一维', () => {
  const context = {
    research: [{ title: 'ZZZ', captured_at: recent(), metrics: { discussions: 5000, growth: 30 } }],
    materials: [{}],
    structures: [{}],
    profile: { pillars: ['客户'], audiences: ['老板'] },
    strategy: {},
  }
  const result = evaluateTopic({ title: '客户为什么不来问价', strategy_layer: 'trust' }, context)
  assert.equal(result.blocked, false, '还有维度达标就不该拦停：误杀比放过贵')
  assert.notEqual(result.decision, 'defer')
  assert.match(result.conclusion, /建议/)
  assert.doesNotMatch(result.conclusion, /不建议做/)
  // 最弱的一维是变现空间，第一步应当指向补变现目标或获客路径。
  const weakest = Object.entries(result.dimensions).sort((left, right) => left[1].score - right[1].score)[0][0]
  assert.equal(weakest, 'monetization')
  assert.match(result.first_step, /变现|获客/)
  assert.ok(result.suggestions.length > 0, '建议清单要保留，第一步只是其中一条')
})
