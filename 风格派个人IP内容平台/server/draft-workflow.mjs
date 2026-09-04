import { prohibitedWordlist } from './redfox.mjs'
import { defaultApproval } from './draft-approval.mjs'

const MAX_HOOK_LENGTH = 60
const hookRiskWords = prohibitedWordlist.map(item => item.word)

function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim() }
function safeId(value) { return String(value || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) }

export function validateHookText(value) {
  const text = clean(value)
  const hits = hookRiskWords.filter(word => text.includes(word))
  const evidence = []
  if (!text) evidence.push('Hook 不能为空')
  if (text.length > MAX_HOOK_LENGTH) evidence.push(`Hook 不能超过 ${MAX_HOOK_LENGTH} 个字符`)
  if (hits.length) evidence.push(`命中风险表述：${hits.join('、')}`)
  return { status: evidence.length ? 'blocked' : 'passed', evidence, hits, length: text.length }
}

export function generateHookCandidates(draft, { sourceRefs = [] } = {}) {
  const title = clean(draft.title) || '这个选题'
  const contentJob = clean(draft.content_job)
  const candidates = [
    { label: '反常识切入', text: `很多人以为“${title}”靠的是技巧，其实关键在于先把真实过程讲清楚。` },
    { label: '真实经历切入', text: `我用一次真实经历，讲清楚${title}为什么值得重新做一遍。` },
    { label: '问题切入', text: `如果你也在${contentJob || title}，先回答一个问题：你手里有可验证的证据吗？` },
    { label: '结果切入', text: `做完这件事之后，我才发现${title}真正改变的不是结果，而是方法。` },
  ]
  return candidates.map((candidate, index) => {
    const validation = validateHookText(candidate.text)
    return { id: `hook-${safeId(draft.id)}-${index + 1}`, ...candidate, source_refs: [...sourceRefs], validation: { status: validation.status, evidence: validation.evidence, length: validation.length } }
  })
}

export function selectHook(draft, hookId) {
  const hook = Array.isArray(draft.hooks) ? draft.hooks.find(item => item.id === hookId) : null
  if (!hook) {
    const error = new Error('Hook 不存在或不属于当前草稿')
    error.code = 'resource_not_found'
    throw error
  }
  if (hook.validation?.status !== 'passed') {
    const error = new Error('当前 Hook 未通过校验')
    error.code = 'validation_failed'
    throw error
  }
  return hook
}

export function defaultDraftWorkflowFields(draft) {
  return {
    ...draft,
    workflow_status: draft.workflow_status || 'draft',
    hooks: Array.isArray(draft.hooks) ? draft.hooks : [],
    selected_hook_id: draft.selected_hook_id || null,
    selected_hook: draft.selected_hook || null,
    platform_variants: Array.isArray(draft.platform_variants) ? draft.platform_variants : [],
    checks: draft.checks || { persona: null, quality: null, publish_checklist: null },
    approval: defaultApproval(draft.approval),
    variant_group_id: draft.variant_group_id || null,
    variant_type: draft.variant_type || (draft.variant_group_id ? 'platform' : 'legacy'),
    generation_context: draft.generation_context || null,
  }
}

export { MAX_HOOK_LENGTH }
