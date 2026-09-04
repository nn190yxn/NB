import assert from 'node:assert/strict'
import test from 'node:test'
import { generateHookCandidates, validateHookText } from './draft-workflow.mjs'

test('Hook candidates are distinct, source-aware and length/compliance checked', () => {
  const candidates = generateHookCandidates({ id: 7, title: '真实复盘', content_job: '建立信任' }, { sourceRefs: [{ type: 'topic', id: 7 }] })
  assert.equal(candidates.length, 4)
  assert.equal(new Set(candidates.map(item => item.id)).size, 4)
  assert.ok(candidates.every(item => item.source_refs[0].id === 7 && item.validation.status === 'passed'))
  assert.equal(validateHookText('第一且最好').status, 'blocked')
  assert.equal(validateHookText('a'.repeat(61)).status, 'blocked')
})
