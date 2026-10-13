// 选题的「主观点」与「反方」（批次 3 / Requirement 8、10）。
//
// 主观点不新建实体：它就是素材库里的一条主张素材，选题只记它的编号。
// 这样「我认可这个热点当观点」和「我自己写了一条观点」是同一个动作，
// 而且观点自动带上批次 2 那套逻辑判定与来源。
//
// 反方优先取同一次「提主张」里配对的另一角度（老板 vs 员工），
// 那才是真实的对立面；没有配对时才退回「同一来源、不同角度」的主张。

const text = value => String(value ?? '').trim()

const refKeys = item => (Array.isArray(item?.source_refs) ? item.source_refs : []).map(ref => `${ref?.type}:${ref?.id}`)

function logicStateOfMaterial(item) {
  if (!item?.logic_status) return 'unchecked'
  if (item.logic_source_checksum && item.logic_source_checksum !== item.checksum) return 'stale'
  return item.logic_status
}

export function resolveStance(topic, materials) {
  const id = Number(topic?.viewpoint_material_id)
  if (!Number.isFinite(id) || id <= 0) return null
  const material = (materials || []).find(item => Number(item.id) === id)
  const claim = text(material?.content)
  if (!material || !claim) return null
  return {
    material_id: material.id,
    text: claim,
    angle: text(material.angle) || null,
    run_id: text(material.claims_run) || null,
    logic_state: logicStateOfMaterial(material),
    source: text(material.name) || null,
    ref_keys: refKeys(material),
  }
}

export function counterpartClaims(stance, materials) {
  if (!stance) return []
  const pool = (materials || []).filter(item =>
    Number(item.id) !== stance.material_id
    && (item.unit_type || '') === 'OPI'
    && text(item.content)
    && text(item.angle)
    && item.angle !== stance.angle)
  const paired = stance.run_id ? pool.filter(item => item.claims_run === stance.run_id) : []
  const shared = pool.filter(item => {
    const keys = refKeys(item)
    return keys.some(key => stance.ref_keys?.includes(key))
  })
  const chosen = paired.length ? paired : shared
  return chosen.map(item => ({ material_id: item.id, text: text(item.content), angle: text(item.angle), logic_state: logicStateOfMaterial(item), source: text(item.name) || null }))
}
