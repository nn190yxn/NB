import assert from 'node:assert/strict'
import test from 'node:test'
import { approveDraftRecord, defaultApproval, revokeDraftRecord, validateApprovalReadiness } from './draft-approval.mjs'
import { defaultDraftWorkflowFields } from './draft-workflow.mjs'

const checks = {
  persona: { status: 'warning', draft_version: 3, evidence: [] },
  quality: { status: 'passed', draft_version: 3, evidence: [] },
  publish_checklist: { status: 'passed', draft_version: 3, evidence: [] },
}
const readyDraft = { id: 7, version: 3, status: 'draft', workflow_status: 'publish_ready', fact_check_status: 'verified', checks }

test('approval defaults fill legacy records without overwriting existing values', () => {
  const legacy = defaultApproval({ status: 'approved', approved_at: '2026-09-03T00:00:00.000Z' })
  assert.equal(legacy.status, 'approved')
  assert.equal(legacy.approved_at, '2026-09-03T00:00:00.000Z')
  assert.equal(legacy.checks_snapshot, null)
  assert.equal(legacy.revoked_at, null)
})

test('legacy drafts gain complete approval fields without losing existing records', () => {
  const normalized = defaultDraftWorkflowFields({ id: 2, version: 1, approval: { status: 'approved', user_id: 'legacy-owner' } })
  assert.equal(normalized.approval.status, 'approved')
  assert.equal(normalized.approval.user_id, 'legacy-owner')
  assert.equal(normalized.approval.checks_snapshot, null)
  assert.equal(normalized.approval.revoked_at, null)
})

test('approval readiness requires current checks and verified facts', () => {
  assert.deepEqual(validateApprovalReadiness(readyDraft), [])
  assert.ok(validateApprovalReadiness({ ...readyDraft, fact_check_status: 'needs_review' }).some(message => message.includes('事实核验')))
  assert.ok(validateApprovalReadiness({ ...readyDraft, checks: { ...checks, quality: { status: 'passed', draft_version: 2 } } }).some(message => message.includes('质量门')))
  assert.ok(validateApprovalReadiness({ ...readyDraft, checks: { ...checks, publish_checklist: { status: 'blocked', draft_version: 3 } } }).some(message => message.includes('阻断')))
})

test('approval captures an immutable check snapshot and revocation preserves it', () => {
  const approval = approveDraftRecord(readyDraft, 'owner-1', '2026-09-03T08:00:00.000Z')
  assert.equal(approval.status, 'approved')
  assert.equal(approval.draft_version, 3)
  checks.quality.status = 'blocked'
  assert.equal(approval.checks_snapshot.quality.status, 'passed')
  const revoked = revokeDraftRecord({ ...readyDraft, approval, version: 4 }, 'owner-1', '需要修改', '2026-09-03T09:00:00.000Z')
  assert.equal(revoked.status, 'revoked')
  assert.equal(revoked.checks_snapshot.quality.status, 'passed')
  assert.equal(revoked.revoked_draft_version, 4)
  assert.equal(revoked.revoke_reason, '需要修改')
})
