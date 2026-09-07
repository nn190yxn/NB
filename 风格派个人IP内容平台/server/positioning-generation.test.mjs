import test from 'node:test'
import assert from 'node:assert/strict'
import { interviewDigest, parsePositioning, fillProfile, parseTopics } from './positioning-generation.mjs'
const doc = { interview_answers: { 0: '真实经历' } }
const candidate = { name: '经验分享者', positioning_statement: '分享工作经验', audiences: [], problems: [], pillars: ['过程复盘'], uncertainties: ['受众待补充'], answer_refs: ['0'] }
test('定位解析拒绝无效引用和虚构字段结构', () => {
  assert.equal(parsePositioning(JSON.stringify([candidate, candidate, candidate]), doc).length, 3)
  assert.throws(() => parsePositioning(JSON.stringify([candidate, candidate, { ...candidate, answer_refs: ['2'] }]), doc))
  assert.throws(() => parsePositioning('不是 JSON', doc))
  assert.throws(() => parsePositioning(JSON.stringify([{ ...candidate, audiences: '所有人' }, candidate, candidate]), doc))
})
test('访谈摘要对答案变化敏感但忽略无关定位字段', () => {
  assert.equal(interviewDigest(doc), interviewDigest({ ...doc, version: 9, role: '新角色' }))
  assert.notEqual(interviewDigest(doc), interviewDigest({ interview_answers: { 0: '不同经历' } }))
})
test('确认只补空档案，已有手填内容保留且重复确认不增加历史', () => {
  const original = { role: '手填角色', audiences: ['手填受众'], pillars: [], version: 2 }
  const next = fillProfile(original, candidate, 'now')
  assert.equal(next.role, original.role)
  assert.deepEqual(next.audiences, original.audiences)
  assert.deepEqual(next.pillars, candidate.pillars)
  assert.deepEqual(original.pillars, [])
  assert.equal(next.history.length, 1)
  assert.deepEqual(fillProfile(next, candidate, 'later'), next)
})
test('选题解析只允许提供的来源编号', () => {
  const topic = { title: '真实过程', rationale: '来源', content_job: '解释', strategy_layer: 'trust', source_indexes: [0] }
  assert.equal(parseTopics(JSON.stringify([topic]), [{ type: 'material', id: 1 }])[0].source_refs[0].id, 1)
  assert.throws(() => parseTopics(JSON.stringify([{ ...topic, source_indexes: [1] }]), [{}]))
})
