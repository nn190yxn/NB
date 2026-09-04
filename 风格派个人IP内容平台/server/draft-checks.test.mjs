import assert from 'node:assert/strict'
import test from 'node:test'
import { checkPersona, checkPublishChecklist, checkQuality, hasBlockedCheck } from './draft-checks.mjs'

const hook = { id: 'h1', text: '从真实过程开始讲清楚一个方法。', validation: { status: 'passed' } }
const baseDraft = { id: 4, version: 2, title: '真实创业复盘', body: `${hook.text}\n\n我记录一次真实过程，说明问题、证据和可执行步骤。\n\n最后给出方法和复盘建议，帮助读者完成下一步行动。`, platform: '抖音', selected_hook: hook, source_refs: [{ type: 'topic', id: 4 }], fact_check_status: 'needs_review', variant_group_id: 'group-1', checks: {} }

test('persona check warns without blocking and quality returns bounded dimensions', () => {
  const persona = checkPersona(baseDraft, { role: '', audiences: [], pillars: [], prohibited_patterns: [] })
  assert.equal(persona.status, 'warning')
  assert.ok(persona.score >= 0 && persona.score <= 100)
  const quality = checkQuality(baseDraft, { audiences: [], pillars: [], viewpoints: [], problems: [] })
  assert.equal(quality.status, 'passed')
  assert.deepEqual(Object.keys(quality.dimensions), ['hook_clarity', 'audience_fit', 'core_point', 'evidence', 'structure_and_risk'])
  assert.ok(Object.values(quality.dimensions).every(score => score >= 0 && score <= 100))
})

test('quality and publish checks block missing evidence, risk and fact verification', () => {
  const quality = checkQuality({ ...baseDraft, selected_hook: null, source_refs: [], body: '包赚' }, {})
  assert.equal(quality.status, 'blocked')
  assert.ok(quality.evidence.some(item => item.code === 'hook_missing'))
  assert.ok(quality.evidence.some(item => item.code === 'risk_words'))
  const publish = checkPublishChecklist(baseDraft)
  assert.equal(publish.status, 'blocked')
  assert.equal(publish.dimensions.fact_check, false)
  assert.equal(hasBlockedCheck({ checks: { quality } }), true)
  assert.equal(hasBlockedCheck({ checks: { quality: { status: 'passed' } } }), false)
})

test('legacy drafts remain publish-check compatible when otherwise complete', () => {
  const publish = checkPublishChecklist({ ...baseDraft, variant_group_id: null, variant_type: 'legacy', fact_check_status: 'verified' })
  assert.equal(publish.status, 'passed')
})
