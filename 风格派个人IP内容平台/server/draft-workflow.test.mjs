import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultDraftWorkflowFields, openingReadiness, validateHookText } from './draft-workflow.mjs'

test('生成时自带的开头文本仍做长度与合规校验', () => {
  assert.equal(validateHookText('从真实过程讲清楚一个方法。').status, 'passed')
  assert.equal(validateHookText('第一且最好').status, 'blocked')
  assert.equal(validateHookText('a'.repeat(61)).status, 'blocked')
  assert.equal(validateHookText('').status, 'blocked')
})

test('开头是否就位只看开头句槽位记录，旧 Hook 记录继续兼容', () => {
  assert.equal(openingReadiness({}), false)
  assert.equal(openingReadiness({ opening_ref: null }), false)
  assert.equal(openingReadiness({ opening_ref: { option_id: 'structure-2', name: '开头范式一' } }), true)
  // 旧记录：只有通过校验且非空的 Hook 才算数
  assert.equal(openingReadiness({ selected_hook: { text: '旧开头', validation: { status: 'passed' } } }), true)
  assert.equal(openingReadiness({ selected_hook: { text: '旧开头', validation: { status: 'blocked' } } }), false)
  assert.equal(openingReadiness({ selected_hook: { text: '   ', validation: { status: 'passed' } } }), false)
})

test('默认字段补全 opening_ref 且不覆盖已有值', () => {
  assert.equal(defaultDraftWorkflowFields({ id: 1 }).opening_ref, null)
  const kept = defaultDraftWorkflowFields({ id: 1, opening_ref: { option_id: 'structure-6', name: '金句复现' }, workflow_status: 'content_ready' })
  assert.equal(kept.opening_ref.option_id, 'structure-6')
  assert.equal(kept.workflow_status, 'content_ready')
  assert.equal(kept.origin, undefined)
})
