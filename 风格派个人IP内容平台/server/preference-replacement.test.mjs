import assert from 'node:assert/strict'
import test from 'node:test'
import { checkQuality } from './draft-checks.mjs'
import { activeFeatureReplacements, performanceSignalNote } from './return-flow.mjs'

const draft = {
  id: 1,
  version: 1,
  platform: '抖音',
  body: '很多人以为流量就是一切。\n首先，你要知道，内容不是为了发而发。\n其次，我们要明白，持续输出才有复利。\n最后，希望大家都能拿到结果。',
  source_refs: [{ type: 'material', id: 1 }],
}
const profile = { audiences: ['想做内容的人'], pillars: [], viewpoints: [], problems: [] }
const allFeatures = new Set(Array.from({ length: 22 }, (unused, index) => index + 1))

test('确认替换掉的特征不再按通用特征提醒，结构层闸门不受影响', () => {
  const plain = checkQuality(draft, profile)
  assert.ok(plain.reminders.some(item => item.feature), '这版正文本来就该命中至少一条通用特征，否则这条测试证明不了什么')

  // 22 个特征全部被用户偏好替换掉之后，只能特征的提醒清空。
  const replaced = checkQuality(draft, profile, { replacedFeatureIds: allFeatures })
  assert.deepEqual(replaced.reminders.filter(item => item.feature), [])
  // 不属于那 22 个特征的语言层提醒（如 length_severe）不受影响。
  assert.deepEqual(replaced.reminders.map(item => item.code).sort(), plain.reminders.map(item => item.code).filter(code => !plain.reminders.find(item => item.code === code)?.feature).sort())
  // 闸门项走 evidence，是结构层的客观项，不因为语言层被替换而放行。
  assert.deepEqual(replaced.evidence.map(item => item.code), plain.evidence.map(item => item.code))
  assert.deepEqual(replaced.suggestions, plain.suggestions)

  // 没传替换集合时行为不变（老调用方不受影响）。
  assert.deepEqual(checkQuality(draft, profile, {}).reminders, plain.reminders)
  assert.deepEqual(checkQuality(draft, profile, { replacedFeatureIds: new Set() }).reminders, plain.reminders)
})

test('替换集合只认 active 的偏好，待确认与已拒绝的不进替换清单', () => {
  const preferences = [
    { id: 1, status: 'pending', replaces_feature: 4 },
    { id: 2, status: 'rejected', replaces_feature: 5 },
    { id: 3, status: 'active', replaces_feature: 6 },
    { id: 4, status: 'active', replaces_feature: null },
  ]
  const replaced = new Set(activeFeatureReplacements(preferences).keys())
  assert.deepEqual([...replaced], [6])

  // 只替换一条：那一条的提醒该消失，其余照常出现，不是一刀切清空。
  const plain = checkQuality(draft, profile)
  const partial = checkQuality(draft, profile, { replacedFeatureIds: replaced })
  assert.deepEqual(partial.reminders.filter(item => Number(item.feature?.id) === 6), [])
  assert.deepEqual(partial.reminders.map(item => item.code), plain.reminders.filter(item => Number(item.feature?.id) !== 6).map(item => item.code))
  assert.deepEqual(partial.evidence.map(item => item.code), plain.evidence.map(item => item.code))
})

test('只有确认过的发布表现才进下一轮选题指令', () => {
  const confirmed = [
    { id: 1, status: 'confirmed', platform: '抖音', draft_id: 11, metrics: { views: 12000 } },
    { id: 2, status: 'confirmed', platform: '抖音', draft_id: 12, metrics: { views: 800 } },
  ]
  const note = performanceSignalNote(confirmed)
  assert.match(note, /上一轮已确认的发布表现/)
  assert.match(note, /12000/)
  assert.match(note, /下一轮选题可以往这偏/)

  // 待确认、没数字、只有一个平台只有一条：都不产生信号，原样生成。
  assert.equal(performanceSignalNote([]), '')
  assert.equal(performanceSignalNote([{ id: 1, status: 'pending_confirmation', platform: '抖音', metrics: { views: 12000 } }, { id: 2, status: 'confirmed', platform: '抖音', metrics: {} }]), '')
  assert.equal(performanceSignalNote([{ id: 1, status: 'confirmed', platform: '抖音', metrics: { views: 12000 } }]), '')
})
