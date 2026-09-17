// 素材的五类认知角色：QST 问题 / CON 概念 / OPI 主张 / CAS 案例 / SOL 方案。
// 装配按角色取料，不再按 material_kind 取；material_kind 只留作历史兼容与来源容器识别。
export const unitTypes = ['QST', 'CON', 'OPI', 'CAS', 'SOL']

// material_kind → unit_type 的迁移映射：金句是主张，热点是问题，经历是案例。
const unitTypeFromKindMap = { quote: 'OPI', hotspot: 'QST', experience: 'CAS' }

// insight 分不出是「概念」还是「案例」，article 是容器不是认知单元——两者都不自动生成，
// 前者留空等人工判定，后者本来就不该有角色。
const unitTypePendingKinds = ['insight']

export const unitTypeFromKind = kind => unitTypeFromKindMap[String(kind || '')] || null

export const unitTypeOf = item => unitTypes.includes(item?.unit_type) ? item.unit_type : null

// 就地迁移：只补空的 unit_type，不覆盖已有的（人工定过的不动），不删除任何记录。
// 可重入：数据已经是迁移后的状态时，第二次跑 assigned 一定是 0。
export function migrateUnitTypes(materials = []) {
  const report = { scanned: 0, assigned: 0, pending: 0, skipped: 0 }
  for (const item of materials) {
    if (!item || typeof item !== 'object') continue
    report.scanned += 1
    if (unitTypeOf(item)) continue
    const kind = String(item.material_kind || 'article')
    const mapped = unitTypeFromKind(kind)
    if (mapped) { item.unit_type = mapped; report.assigned += 1 }
    else if (unitTypePendingKinds.includes(kind)) report.pending += 1
    else report.skipped += 1
  }
  return report
}

// 启动时用：迁移完仍返回同一个数组，方便直接放进 state 字面量。
export function materialsWithUnitTypes(materials = []) {
  migrateUnitTypes(materials)
  return materials
}
