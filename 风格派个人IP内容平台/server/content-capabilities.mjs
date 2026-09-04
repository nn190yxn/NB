const CAPABILITIES = Object.freeze([
  Object.freeze({ id: 'topic_matrix', label: '选题矩阵', stage: 'planning', requires: ['profile', 'strategy'], writes: ['topics'], human_confirmation: true }),
  Object.freeze({ id: 'topic_evaluate', label: '选题评估', stage: 'planning', requires: ['profile', 'topic'], writes: ['topics.evaluation'], human_confirmation: true }),
  Object.freeze({ id: 'hook_generate', label: 'Hook 生成', stage: 'production', requires: ['profile', 'topic'], writes: ['drafts.hooks'], human_confirmation: false }),
  Object.freeze({ id: 'draft_generate', label: '草稿生成', stage: 'production', requires: ['profile', 'topic', 'hook'], writes: ['drafts'], human_confirmation: true }),
  Object.freeze({ id: 'platform_adapt', label: '平台适配', stage: 'production', requires: ['draft', 'platform'], writes: ['drafts.platform_variants'], human_confirmation: true }),
  Object.freeze({ id: 'persona_check', label: '人设检查', stage: 'review', requires: ['profile', 'draft'], writes: ['drafts.checks.persona'], human_confirmation: false }),
  Object.freeze({ id: 'quality_gate', label: '质量与合规检查', stage: 'review', requires: ['draft', 'platform'], writes: ['drafts.checks.quality'], human_confirmation: false }),
  Object.freeze({ id: 'publish_checklist', label: '发布完整性检查', stage: 'review', requires: ['draft', 'platform'], writes: ['drafts.checks.publish_checklist'], human_confirmation: false }),
  Object.freeze({ id: 'content_postmortem', label: '内容复盘', stage: 'review', requires: ['draft', 'performance_snapshots'], writes: ['postmortems'], human_confirmation: true }),
  Object.freeze({ id: 'memory_candidate', label: '经验候选', stage: 'review', requires: ['postmortem'], writes: ['memories', 'structures'], human_confirmation: true }),
])

function cloneCapability(capability) {
  return { ...capability, requires: [...capability.requires], writes: [...capability.writes] }
}

export function listCapabilities() {
  return CAPABILITIES.map(cloneCapability)
}

export function getCapability(id) {
  const capability = CAPABILITIES.find(item => item.id === id)
  return capability ? cloneCapability(capability) : null
}

export function isCapabilityId(id) {
  return CAPABILITIES.some(item => item.id === id)
}
