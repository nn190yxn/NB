const DOCUMENT_FIELDS = {
  profile: ['role', 'audiences', 'problems', 'pillars', 'viewpoints', 'tone_preferences', 'prohibited_patterns', 'source_refs', 'version', 'updated_at'],
  strategy: ['stage', 'layer_ratios', 'publishing_rhythm', 'review_period', 'platform_preferences', 'version', 'history'],
}
const SENSITIVE_KEY = /(api.?key|password|secret|authorization|access.?token|refresh.?token|private.?key|credential)/i

function requiredOwner(ownerId) {
  const value = String(ownerId || '').trim()
  if (!value) {
    const error = new Error('任务上下文缺少 owner_id')
    error.code = 'missing_context'
    throw error
  }
  return value
}

function safeClone(value) {
  if (Array.isArray(value)) return value.map(safeClone)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SENSITIVE_KEY.test(key)).map(([key, item]) => [key, safeClone(item)]))
}

function ownedRecord(state, collection, ownerId, id) {
  const record = (state?.[collection] || []).find(item => item?.owner_id === ownerId && !item.deleted_at && item.id === id)
  if (!record) {
    const error = new Error(`上下文资源不存在或无权访问: ${collection}/${id}`)
    error.code = 'resource_not_found'
    throw error
  }
  return safeClone(record)
}

function ownedRecords(state, collection, ownerId, ids = []) {
  if (!Array.isArray(ids) || !ids.length) return []
  const allowed = new Set(ids)
  return (state?.[collection] || []).filter(item => item?.owner_id === ownerId && !item.deleted_at && allowed.has(item.id)).map(safeClone)
}

function userDocument(state, collection, ownerId) {
  const document = state?.[`${collection}_by_user`]?.[ownerId] || (ownerId === 'demo-user' ? state?.[collection] : null) || {}
  const fields = DOCUMENT_FIELDS[collection] || []
  return safeClone(Object.fromEntries(fields.filter(field => Object.prototype.hasOwnProperty.call(document, field)).map(field => [field, document[field]])))
}

function selectedIds(task, name) {
  return Array.isArray(task?.[name]) ? task[name] : []
}

export function buildContentContext(state, options = {}) {
  const ownerId = requiredOwner(options.ownerId)
  const task = options.task || {}
  const topic = options.topicId == null ? null : ownedRecord(state, 'topics', ownerId, Number(options.topicId))
  const draft = options.draftId == null ? null : ownedRecord(state, 'drafts', ownerId, Number(options.draftId))
  const structures = ownedRecords(state, 'structures', ownerId, selectedIds(task, 'structureIds'))
  const memories = ownedRecords(state, 'memories', ownerId, selectedIds(task, 'memoryIds'))
  const performanceSnapshots = ownedRecords(state, 'performance_snapshots', ownerId, selectedIds(task, 'performanceSnapshotIds'))

  return {
    owner_id: ownerId,
    profile: userDocument(state, 'profile', ownerId),
    strategy: userDocument(state, 'strategy', ownerId),
    task: {
      topic_id: options.topicId == null ? null : Number(options.topicId),
      draft_id: options.draftId == null ? null : Number(options.draftId),
      platform: options.platform || null,
      content_type: options.contentType || null,
    },
    topic,
    draft,
    research: ownedRecords(state, 'research', ownerId, selectedIds(task, 'researchIds')),
    materials: ownedRecords(state, 'materials', ownerId, selectedIds(task, 'materialIds')),
    structures,
    memories,
    performance_snapshots: performanceSnapshots,
  }
}
