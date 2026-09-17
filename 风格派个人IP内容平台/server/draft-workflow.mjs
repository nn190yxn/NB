import { prohibitedHits } from './redfox.mjs'
import { defaultApproval } from './draft-approval.mjs'

const MAX_HOOK_LENGTH = 60

function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim() }

export function validateHookText(value) {
  const text = clean(value)
  const hits = prohibitedHits(text).map(item => item.word)
  const evidence = []
  if (!text) evidence.push('Hook 不能为空')
  if (text.length > MAX_HOOK_LENGTH) evidence.push(`Hook 不能超过 ${MAX_HOOK_LENGTH} 个字符`)
  if (hits.length) evidence.push(`命中风险表述：${hits.join('、')}`)
  return { status: evidence.length ? 'blocked' : 'passed', evidence, hits, length: text.length }
}

// 开头只保留一个入口：「开头句」槽位（从爆款方法库选范式，模型重写第一段）。
// 旧记录里可能存在规则引擎生成的 hooks/selected_hook，这里只作为开头的兼容判定依据。
export function openingReadiness(draft) {
  if (draft?.opening_ref && draft.opening_ref.option_id) return true
  const hook = draft?.selected_hook
  return Boolean(hook && hook.validation?.status === 'passed' && clean(hook.text))
}

export function supersededDraftsForRegenerate(drafts, { ownerId, topicId }) {
  if (!ownerId || topicId == null || topicId === '') return []
  const id = Number(topicId)
  if (!Number.isFinite(id)) return []
  return (drafts || []).filter(draft =>
    draft.owner_id === ownerId
    && Number(draft.topic_id) === id
    && !draft.archived_at
    && draft.status !== 'published'
    && draft.workflow_status !== 'ready_to_shoot'
    && draft.workflow_status !== 'published'
    && draft.approval?.status !== 'approved'
  )
}

export function defaultDraftWorkflowFields(draft) {
  return {
    ...draft,
    workflow_status: draft.workflow_status || 'draft',
    hooks: Array.isArray(draft.hooks) ? draft.hooks : [],
    selected_hook_id: draft.selected_hook_id || null,
    selected_hook: draft.selected_hook || null,
    opening_ref: draft.opening_ref || null,
    platform_variants: Array.isArray(draft.platform_variants) ? draft.platform_variants : [],
    checks: draft.checks || { persona: null, quality: null, publish_checklist: null },
    approval: defaultApproval(draft.approval),
    variant_group_id: draft.variant_group_id || null,
    variant_type: draft.variant_type || (draft.variant_group_id ? 'platform' : 'legacy'),
    variant_of: draft.variant_of || null,
    archived_at: draft.archived_at || null,
    generation_context: draft.generation_context || null,
  }
}

export { MAX_HOOK_LENGTH }
