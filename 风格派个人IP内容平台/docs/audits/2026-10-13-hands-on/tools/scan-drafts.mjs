// 实测脚本：把沙箱数据副本里的每一份草稿正文，用工作台自己的确定性检测器扫一遍。
// 目的：把「有没有很明确的 AI 化问题」变成数字和原文，而不是感觉。
// 用法：node .monkeycode-tmp-files/walk-20261013/scan-drafts.mjs [.monkeycode-tmp-files/walk-20261013/data.json]
// 不调用任何大模型，不花钱，不写数据。
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { scanGeneratedBody, aiFeatureCodeOf } from '../../server/draft-checks.mjs'
import { aiFeatureByCode } from '../../server/ai-features.mjs'

const dataPath = resolve(process.argv[2] || '.monkeycode-tmp-files/walk-20261013/data.json')
const state = JSON.parse(readFileSync(dataPath, 'utf8'))
const drafts = (state.drafts || [])
const archived = drafts.filter(item => item.archived_at)

const byCode = new Map()
const rows = []

const scan = draft => {
  const body = draft.body || ''
  const result = scanGeneratedBody(body, draft.platform)
  const hits = (result.evidence || []).map(item => ({
    code: item.code,
    message: item.message,
    quote: item.quote || item.evidence || '',
    severity: item.severity || '未标',
  }))
  for (const hit of hits) {
    if (!byCode.has(hit.code)) byCode.set(hit.code, { code: hit.code, drafts: 0, hits: 0, samples: [] })
    const entry = byCode.get(hit.code)
    entry.hits += 1
    if (!entry.samples.some(sample => sample.quote === hit.quote)) {
      entry.drafts += 1
      if (entry.samples.length < 4) entry.samples.push({ quote: hit.quote.slice(0, 60), severity: hit.severity })
    }
  }
  return {
    id: draft.id,
    platform: draft.platform,
    title: (draft.title || '').slice(0, 28),
    bodyLen: body.length,
    spoken: draft.spoken_body ? '口播' : '文字稿',
    workflow: draft.workflow_status,
    hitCount: hits.length,
    per100: Number((hits.length / Math.max(body.length / 100, 1)).toFixed(1)),
    codes: [...new Set(hits.map(hit => hit.code))],
  }
}

for (const draft of drafts) rows.push(scan(draft))

const ranked = [...byCode.values()].sort((a, b) => b.hits - a.hits)
const totalHits = ranked.reduce((sum, item) => sum + item.hits, 0)
const zeroHitDrafts = rows.filter(row => row.hitCount === 0).length
const featureCodes = new Set(Object.values(aiFeatureCodeOf))
const featureHits = ranked.filter(item => aiFeatureCodeOf[item.code])
const coveredFeatures = new Set(featureHits.map(item => aiFeatureCodeOf[item.code]))

const summary = {
  扫描范围: { 数据文件: dataPath, 未归档草稿: drafts.length, 已归档: archived.length },
  总命中: totalHits,
  每条平均命中: Number((totalHits / Math.max(drafts.length, 1)).toFixed(1)),
  零命中草稿: zeroHitDrafts,
  检测器覆盖到的22特征数: coveredFeatures.size,
  检测器一次都没命中的22特征: aiFeaturesList().filter(f => !coveredFeatures.has(f.code)).map(f => `${f.name}(${f.severity})`),
  按命中数排序: ranked.map(item => ({
    代号: item.code,
    对应22特征: aiFeatureCodeOf[item.code] ? aiFeatureByCode[aiFeatureCodeOf[item.code]].name : '（不属于22特征，属结构/事实类）',
    命中次数: item.hits,
    出现在几条草稿: item.drafts,
    例子: item.samples,
  })),
  逐条: rows.sort((a, b) => b.per100 - a.per100),
}

function aiFeaturesList() {
  return Object.values(aiFeatureByCode)
}

writeFileSync(resolve('.monkeycode-tmp-files/walk-20261013/scan-result.json'), JSON.stringify(summary, null, 2))
console.log(`未归档草稿 ${drafts.length} 份，总命中 ${totalHits} 次，每条平均 ${summary.每条平均命中} 次，零命中 ${zeroHitDrafts} 份`)
console.log(`22 特征里检测器有命中的 ${coveredFeatures.size} 条`)
for (const item of summary.按命中数排序.slice(0, 14)) {
  console.log(`${String(item.命中次数).padStart(3)} 次 / ${String(item.出现在几条草稿).padStart(2)} 条  ${item.代号}  →  ${item.对应22特征}`)
}
console.log('\从未命中的特征：')
console.log(summary.检测器一次都没命中的22特征.join('、') || '（无）')
