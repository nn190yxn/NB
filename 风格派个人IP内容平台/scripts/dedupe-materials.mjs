import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { groupMaterialsByIdentity, materialChecksum, mergeMaterialGroup } from '../server/material-key.mjs'

// 把历史上叠出来的同文素材并成一条。
// 只软删（deleted_at）：被并掉的记录留在原地，能查回并进了哪条，也能还原。
// 默认只出报告不落盘；确认过报告再加 --apply 才真改，并且改之前一定先备份。
// 只支持 JSON 数据文件模式；MySQL 模式请另走一次备份再手工执行同样的合并。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dataFile = path.resolve(root, args.find(arg => arg.startsWith('--data='))?.split('=')[1] || 'server/data.json')
const dryRun = !args.includes('--apply')

function report(lines) {
  console.log(lines.join('\n'))
}

if (!existsSync(dataFile)) {
  report([`FAIL 找不到数据文件：${dataFile}`])
  process.exitCode = 1
} else {
  const state = JSON.parse(readFileSync(dataFile, 'utf8'))
  const materials = Array.isArray(state.materials) ? state.materials : []
  const live = materials.filter(item => item && !item.deleted_at)
  // 老数据可能压根没有身份字段：按正文现算一次再归组，否则这批恰恰是重复最多的却抓不到。
  const normalized = live.map(item => (item.checksum ? item : { ...item, checksum: materialChecksum(item.content) }))
  const groups = groupMaterialsByIdentity(normalized)

  const merged = []
  for (const group of groups) {
    const result = mergeMaterialGroup(group.items, () => new Date().toISOString())
    if (result) merged.push({ kept: result.merged.id, kept_content: result.merged.content, archived: result.archived, refs: result.merged.source_refs?.length || 0 })
  }

  const lines = [
    `数据文件：${dataFile}`,
    `活着的素材 ${live.length} 条，同文分组 ${groups.length} 组，可并掉 ${merged.reduce((sum, item) => sum + item.archived.length, 0)} 条`,
  ]
  for (const item of merged) {
    lines.push(`  保留 #${item.kept}「${String(item.kept_content || '').slice(0, 40)}」，归档 ${item.archived.map(id => `#${id}`).join('、')}，来源并成 ${item.refs} 条`)
  }
  if (!merged.length) lines.push('  没有同文素材，什么都不用做。')

  if (dryRun) {
    lines.push('')
    lines.push('这是预览，没有动数据。看清了再加 --apply 执行。')
    report(lines)
  } else if (!merged.length) {
    report(lines)
  } else {
    if (!existsSync(path.join(root, 'backups'))) mkdirSync(path.join(root, 'backups'))
    const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
    const backup = path.join(root, 'backups', `data-before-dedupe-${stamp}.json`)
    copyFileSync(dataFile, backup)
    const archiveIds = new Set(merged.flatMap(item => item.archived))
    state.materials = materials.map(item => {
      const target = merged.find(entry => entry.kept === item.id)
      if (target) return { ...item, source_refs: normalized.find(entry => entry.id === item.id)?.source_refs || item.source_refs, merged_from: target.archived, updated_at: new Date().toISOString() }
      if (archiveIds.has(item.id)) return { ...item, deleted_at: new Date().toISOString(), status: 'withdrawn', merged_into: merged.find(entry => entry.archived.includes(item.id))?.kept }
      return item
    })
    writeFileSync(dataFile, JSON.stringify(state, null, 2))
    lines.push('')
    lines.push(`已执行。备份在 ${path.relative(root, backup)}，要还原就把备份文件复制回去。`)
    report(lines)
  }
}
