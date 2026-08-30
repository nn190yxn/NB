import test from 'node:test'
import assert from 'node:assert/strict'
import { validRatios, validateSourceRefs } from './validation.mjs'
import { coalesceFileEvents } from './sync.mjs'

test('策略比例属性在多组有效输入下保持守恒', () => {
  for (let reach = 0; reach <= 100; reach += 5) {
    for (let trust = 0; trust <= 100 - reach; trust += 5) {
      assert.equal(validRatios({ reach, trust, conversion: 100 - reach - trust }), true)
    }
  }
})

test('来源引用属性拒绝缺少类型或标识的记录', () => {
  const valid = [{ type: 'material', id: 1 }, { type: 'research', id: 'r1' }]
  assert.equal(validateSourceRefs(valid), true)
  for (const invalid of [{ type: '', id: 1 }, { type: 'material' }, { id: 1 }, null]) assert.equal(validateSourceRefs([invalid]), false)
})

test('文件事件属性保证每个路径最多保留一个最终事件', () => {
  const events = Array.from({ length: 40 }, (_, index) => ({ path: `notes/${index % 4}.md`, type: index % 7 === 0 ? 'deleted' : 'changed', content: String(index) }))
  const result = coalesceFileEvents(events)
  assert.equal(new Set(result.map(item => item.path)).size, result.length)
  assert.equal(result.length, 4)
})
