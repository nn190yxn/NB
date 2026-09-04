const approvalDefaults = {
  status: 'pending',
  user_id: null,
  approved_at: null,
  revoked_at: null,
  revoked_by: null,
  revoke_reason: null,
  draft_version: null,
  revoked_draft_version: null,
  checks_snapshot: null,
}

export function defaultApproval(existing = {}) {
  return { ...approvalDefaults, ...(existing && typeof existing === 'object' ? existing : {}) }
}

export function validateApprovalReadiness(draft) {
  const version = Number(draft?.version || 1)
  const checks = draft?.checks || {}
  const errors = []
  if (checks.persona?.draft_version !== version) errors.push('当前版本尚未完成人设检查')
  if (checks.quality?.draft_version !== version || checks.quality?.status !== 'passed') errors.push('当前版本尚未通过质量门')
  if (checks.publish_checklist?.draft_version !== version || checks.publish_checklist?.status !== 'passed') errors.push('当前版本尚未通过发布清单')
  if (draft?.fact_check_status !== 'verified') errors.push('当前版本尚未完成事实核验')
  if (Object.values(checks).some(check => check?.draft_version === version && check?.status === 'blocked')) errors.push('当前版本存在阻断检查')
  if (draft?.status === 'published' || draft?.workflow_status === 'published') errors.push('已发布草稿不能重复确认')
  return errors
}

export function approveDraftRecord(draft, userId, approvedAt = new Date().toISOString()) {
  return {
    ...defaultApproval(draft?.approval),
    status: 'approved',
    user_id: userId,
    approved_at: approvedAt,
    revoked_at: null,
    revoked_by: null,
    revoke_reason: null,
    draft_version: Number(draft?.version || 1),
    revoked_draft_version: null,
    checks_snapshot: structuredClone(draft?.checks || {}),
  }
}

export function revokeDraftRecord(draft, userId, reason, revokedAt = new Date().toISOString()) {
  return {
    ...defaultApproval(draft?.approval),
    status: 'revoked',
    revoked_at: revokedAt,
    revoked_by: userId,
    revoke_reason: String(reason || '').trim(),
    revoked_draft_version: Number(draft?.version || 1),
  }
}
