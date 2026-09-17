import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultDraftWorkflowFields, openingReadiness, supersededDraftsForRegenerate, validateHookText } from './draft-workflow.mjs'

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

test('同一选题再生成时只归档本账号未确认的旧稿', () => {
  const drafts = [
    { id: 1, owner_id: 'me', topic_id: 7, archived_at: null, status: 'draft', workflow_status: 'draft', approval: { status: 'pending' } },
    { id: 2, owner_id: 'me', topic_id: 7, archived_at: null, status: 'draft', workflow_status: 'draft', approval: { status: 'pending' }, variant_type: 'manual' },
    { id: 3, owner_id: 'me', topic_id: 7, archived_at: '2026-09-01T00:00:00.000Z', status: 'draft', workflow_status: 'draft', approval: { status: 'pending' } },
    { id: 4, owner_id: 'me', topic_id: 7, archived_at: null, status: 'draft', workflow_status: 'ready_to_shoot', approval: { status: 'approved' } },
    { id: 5, owner_id: 'me', topic_id: 8, archived_at: null, status: 'draft', workflow_status: 'draft', approval: { status: 'pending' } },
    { id: 6, owner_id: 'other', topic_id: 7, archived_at: null, status: 'draft', workflow_status: 'draft', approval: { status: 'pending' } },
    { id: 7, owner_id: 'me', topic_id: 7, archived_at: null, status: 'published', workflow_status: 'published', approval: { status: 'approved' } },
  ]
  assert.deepEqual(supersededDraftsForRegenerate(drafts, { ownerId: 'me', topicId: 7 }).map(item => item.id), [1, 2])
  assert.deepEqual(supersededDraftsForRegenerate(drafts, { ownerId: 'me', topicId: null }), [])
  assert.deepEqual(supersededDraftsForRegenerate(drafts, { ownerId: '', topicId: 7 }), [])
})
