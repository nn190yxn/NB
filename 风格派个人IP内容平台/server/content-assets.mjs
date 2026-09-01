const crossPlatformCollections = ['devices', 'sync_directories', 'sync_files', 'private_files', 'performance_snapshots', 'vision_tasks']
const materialSourceTypes = new Set(['research', 'local_sync', 'mobile_upload', 'manual'])
const materialParseStatuses = new Set(['pending', 'processing', 'ready', 'failed'])
const materialReviewStatuses = new Set(['pending', 'approved', 'rejected'])

export const crossPlatformCollectionNames = Object.freeze([...crossPlatformCollections])

function parseStatusOf(item) {
  if (materialParseStatuses.has(item.parse_status)) return item.parse_status
  if (item.status === 'ready') return 'ready'
  if (item.status === 'failed') return 'failed'
  return 'pending'
}

export function normalizeMaterialRecord(item, fallbackOwnerId = 'demo-user') {
  const sourceType = materialSourceTypes.has(item.source_type)
    ? item.source_type
    : item.source_path
      ? 'local_sync'
      : 'manual'
  return {
    ...item,
    owner_id: item.owner_id || fallbackOwnerId,
    source_type: sourceType,
    source_id: item.source_id ?? null,
    source_path: item.source_path ?? null,
    device_id: item.device_id ?? null,
    source_deleted_at: item.source_deleted_at ?? null,
    parse_status: parseStatusOf(item),
    review_status: materialReviewStatuses.has(item.review_status) ? item.review_status : 'pending',
  }
}

export function normalizeCrossPlatformState(input = {}, fallbackOwnerId = 'demo-user') {
  const state = { ...input }
  for (const name of crossPlatformCollections) state[name] = Array.isArray(input[name]) ? input[name].map(item => ({ ...item, owner_id: item.owner_id || fallbackOwnerId })) : []
  state.materials = Array.isArray(input.materials) ? input.materials.map(item => normalizeMaterialRecord(item, fallbackOwnerId)) : []
  for (const name of ['research', 'structures', 'topics', 'drafts', 'shooting', 'sync_jobs', 'profile_reviews', 'conflicts', 'memories']) {
    state[name] = Array.isArray(input[name]) ? input[name].map(item => ({ ...item, owner_id: item.owner_id || fallbackOwnerId, ...(name === 'shooting' && item.status === 'todo' ? { status: 'ready_to_shoot' } : {}) })) : []
  }
  return state
}
