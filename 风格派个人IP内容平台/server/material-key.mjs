import { createHash } from 'node:crypto'

// 素材身份只看「这句话本身」：抹掉空白与标点，不掺来源编号、文件名、草稿编号。
//
// 之前五条入库路径各算各的哈希（atom:来源id:文本、name:正文、文件路径:正文、followup:草稿id:正文、
// 研究转素材干脆没有身份字段），同一句话从两个门进来必然不相等——这就是素材越用越叠的根因。
// 来源不该是身份的一部分：它退化成 source_refs 里的一条引用，同文再入库就追加，不再新增记录。
//
// 归一化口径与终稿回流比对句子时用的是同一把尺子，两边共用这一份，不各写一套。
export function normalizeMaterialText(text) {
  return String(text || '').replace(/\s+/g, '').replace(/[，。！？；：、,.!?;:""''（）()「」]/g, '')
}

export function materialChecksum(content) {
  return createHash('sha256').update(`material:${normalizeMaterialText(content)}`).digest('hex')
}

// 同一条素材可能同时是「金句」和「判断」：身份相同但类型不同，不自动改判用户定过的东西，
// 只把它报出来让人定一个。宁可多问一次，不让机器猜。
export function materialIdentityConflict(existing, incoming) {
  const conflicts = []
  for (const field of ['material_kind', 'unit_type']) {
    const current = existing?.[field]
    const next = incoming?.[field]
    if (current && next && current !== next) conflicts.push({ field, current, next })
  }
  return conflicts
}

export function mergeSourceRefs(...groups) {
  const seen = new Set()
  const merged = []
  for (const group of groups) {
    for (const ref of Array.isArray(group) ? group : []) {
      if (!ref || typeof ref !== 'object') continue
      const key = `${ref.type}:${ref.id}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(ref)
    }
  }
  return merged
}

// 只在当前账号、未删除的素材里找：owner 边界由调用方传进来的列表保证（owned('materials', request)）。
export function findMaterialByContent(materials, content) {
  const checksum = materialChecksum(content)
  return (materials || []).find(item => item.checksum === checksum) || null
}

// 按身份分组出「疑似重复」：只剩一条时不是一组，没什么可合并的。
export function groupMaterialsByIdentity(materials) {
  const groups = new Map()
  for (const item of materials || []) {
    if (!item?.content) continue
    const key = item.checksum || materialChecksum(item.content)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([checksum, items]) => ({ checksum, items: [...items].sort((left, right) => Number(left.id) - Number(right.id)) }))
    .sort((left, right) => right.items.length - left.items.length || Number(left.items[0].id) - Number(right.items[0].id))
}

// 合并保留最早那条：它带着用户第一次入库时定的类型与角色。
// 其余只软删（deleted_at），并记下并进了哪一条，出问题能查回来也能还原。
export function mergeMaterialGroup(group, now = () => new Date().toISOString()) {
  const items = [...(group || [])].sort((left, right) => Number(left.id) - Number(right.id))
  if (items.length < 2) return null
  const [keeper, ...others] = items
  const timestamp = now()
  const merged = { ...keeper, updated_at: timestamp }
  merged.source_refs = mergeSourceRefs(keeper.source_refs, ...others.map(item => item.source_refs))
  merged.merged_from = [...(keeper.merged_from || []), ...others.map(item => item.id)]
  for (const item of others) {
    item.deleted_at = timestamp
    item.status = 'withdrawn'
    item.merged_into = keeper.id
  }
  return { merged, archived: others.map(item => item.id) }
}
