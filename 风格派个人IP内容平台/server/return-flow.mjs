// Requirement 17：双通道回流。判据从用户自己的改稿和发布数据里长出来，不由系统发明。
//
// 两个通道产出的都只是候选：
//   终稿回流 = 拿最早留下的那一版和用户确认的那一版认真比一次，数出改了什么；
//   数据回流 = 把用户确认过的发布表现按平台归档，得出下一轮选题该往哪偏。
// 候选默认 pending，用户确认（confirm）后才 active；系统绝不自动改写判据。
//
// 每条候选都带 source（哪份草稿、哪两版、哪几条快照），确认后能顺着查回去，
// 确认时还可以指明它替换掉 22 个通用特征里的哪一条，替换过程同样留在记录里。

import { aiFeatures } from './ai-features.mjs'
import { normalizeMaterialText } from './material-key.mjs'
import { viewsMetricWords } from './growth.mjs'

export const preferenceKinds = ['终稿回流', '数据回流']
export const preferenceStatuses = ['pending', 'active', 'rejected']

// AC4：偏好可以替换 22 个通用特征里的某一条，替换目标必须真实存在，不能写一个查不回来的编号。
const featureIds = new Set(aiFeatures.map(feature => feature.id))
export const isFeatureId = value => Number.isInteger(Number(value)) && featureIds.has(Number(value))

const structureLine = /^(#{1,6}\s*|标题[:：]|正文[:：])/
const explanationMarkers = ['因为', '所以', '这是因为', '意思是', '也就是说', '举个例子']
const summaryMarkers = ['总之', '所以说', '记住', '一句话', '归根到底']

// 比句子用的是素材身份那把尺子，两处共用一份实现（见 material-key.mjs）。
const normalize = normalizeMaterialText

export function splitSentences(body) {
  const sentences = []
  for (const rawLine of String(body || '').split('\n')) {
    const line = rawLine.trim().replace(/^[（(][^）)]*[）)]\s*/, '')
    if (!line || structureLine.test(line)) continue
    for (const sentence of line.split(/(?<=[。！？；])/)) {
      const text = sentence.trim()
      if (text) sentences.push(text)
    }
  }
  return sentences
}

// 原稿 = 草稿历史里最早留下的那一版；定稿 = 用户确认定稿时冻下来的那一版。
// 两版都拿不到就返回 changed:false，不硬编一份差分出来。
export function draftVersions(draft) {
  const history = Array.isArray(draft?.history) ? draft.history : []
  const approved = draft?.approval?.status === 'approved' && Number(draft.approval.draft_version) === Number(draft.version)
  const final = approved ? String(draft?.body || '') : history.length ? String(history[history.length - 1].body || '') : ''
  const original = history.length ? String(history[0].body || '') : final
  return {
    original, final,
    original_label: history.length ? `最早留下的第 ${history[0].version ?? 1} 版` : '当前版本（只有一版，没法比）',
    final_label: approved ? `你确认的第 ${draft.version} 版` : history.length ? `最近留存的第 ${history[history.length - 1].version ?? '?'} 版` : '当前版本',
    changed: Boolean(original.trim()) && Boolean(final.trim()) && normalize(original) !== normalize(final),
  }
}

function countLabel(before, after) {
  const delta = Math.round((1 - normalize(after).length / Math.max(normalize(before).length, 1)) * 100)
  return delta > 0 ? `少了 ${delta}%` : `多了 ${Math.abs(delta)}%`
}

// 终稿回流：只数得出来的差分。每条都是观察 + 一句可改写的偏好提议，不是替用户下结论。
export function finalDraftCandidates(draft) {
  const versions = draftVersions(draft)
  if (!versions.changed) return []
  const source = { draft_id: draft.id, from_version: Array.isArray(draft?.history) ? draft.history[0]?.version ?? 1 : 1, to_version: draft?.version ?? 1 }
  const candidates = []

  const beforeLen = normalize(versions.original).length
  const afterLen = normalize(versions.final).length
  const ratio = afterLen / Math.max(beforeLen, 1)
  if (ratio <= 0.8 || ratio >= 1.2) {
    candidates.push({
      local_id: 'length',
      kind: '终稿回流',
      observation: `你把稿子从 ${beforeLen} 字改到 ${afterLen} 字（${countLabel(versions.original, versions.final)}）`,
      proposal: ratio <= 0.8 ? '偏好：更短，直接给判断，少铺垫。' : '偏好：多说一层，把判断背后的原因讲清楚。',
      evidence: { before: versions.original, after: versions.final },
      source,
    })
  }

  const beforeSet = new Set(splitSentences(versions.original).map(normalize))
  const afterSet = new Set(splitSentences(versions.final).map(normalize))
  const deleted = splitSentences(versions.original).filter(sentence => !afterSet.has(normalize(sentence)))
  const added = splitSentences(versions.final).filter(sentence => !beforeSet.has(normalize(sentence)))

  if (deleted.length) {
    const explains = deleted.filter(sentence => explanationMarkers.some(marker => sentence.includes(marker))).length
    const summarizes = deleted.filter(sentence => summaryMarkers.some(marker => sentence.includes(marker))).length
    const proposal = explains >= Math.ceil(deleted.length / 2) ? '偏好：少解释，判断说完就走。' : summarizes >= Math.ceil(deleted.length / 2) ? '偏好：不要总结句，观众自己会总结。' : '偏好：删掉铺垫，直接进正文。'
    candidates.push({
      local_id: 'deleted',
      kind: '终稿回流',
      observation: `你删掉了 ${deleted.length} 句，例如「${deleted[0].slice(0, 40)}」`,
      proposal,
      evidence: { deleted: deleted.slice(0, 5) },
      source,
    })
  }
  if (added.length) {
    candidates.push({
      local_id: 'added',
      kind: '终稿回流',
      observation: `你自己加了 ${added.length} 句，例如「${added[0].slice(0, 40)}」`,
      proposal: '偏好：这类句子是你想要的效果，出稿时可以直接往这个方向写。',
      evidence: { added: added.slice(0, 5) },
      source,
    })
  }
  if (draft?.opening_ref?.name) {
    candidates.push({
      local_id: 'opening',
      kind: '终稿回流',
      observation: `开头你选了「${draft.opening_ref.name}」`,
      proposal: `偏好：开头优先用「${draft.opening_ref.name}」这一路。`,
      evidence: { option_id: draft.opening_ref.option_id, name: draft.opening_ref.name },
      source,
    })
  }
  return candidates
}

// Requirement 17 第 2 条：把确认过的表现数据拼成一句能进选题生成指令的话。
// 没有任何确认过的快照时返回空串，调用方原样生成，不多说一句。
export function performanceSignalNote(snapshots = []) {
  const lines = performanceCandidates(snapshots).map(candidate => [candidate.observation, candidate.proposal].filter(Boolean).join(' '))
  if (!lines.length) return ''
  return `【上一轮已确认的发布表现】${lines.join(' ')}据此调整选题方向；没有数据支撑的方向不要照搬。`
}

// 数据回流：只认用户确认过的快照。待确认的表现数据不算数，免得拿着没核过的数字去改选题。
export function performanceCandidates(snapshots = []) {
  // 原来这里读 metrics.views（英文键），而界面回填的是「播放量」，
  // 于是数据回流一条候选都产不出来——闭环最后一段一直是断的（真实数据 preferences 恒为 0 就是这个）。
  const viewsOf = item => {
    const entry = Object.entries(item?.metrics || {}).find(([key, value]) => Number(value) > 0 && viewsMetricWords.some(word => String(key).toLowerCase().includes(word)))
    return entry ? Number(entry[1]) : null
  }
  const confirmed = snapshots.map(item => (item ? { ...item, views: viewsOf(item) } : item)).filter(item => item?.status === 'confirmed' && typeof item.views === 'number')
  const byPlatform = new Map()
  for (const item of confirmed) {
    const list = byPlatform.get(item.platform) || []
    list.push(item)
    byPlatform.set(item.platform, list)
  }
  const candidates = []
  for (const [platform, list] of byPlatform) {
    if (list.length < 2) continue
    const ranked = [...list].sort((a, b) => (b.views || 0) - (a.views || 0))
    const best = ranked[0]
    const worst = ranked[ranked.length - 1]
    if (best.id === worst.id) continue
    candidates.push({
      local_id: `platform-${platform}`,
      kind: '数据回流',
      observation: `${platform} 上「${best.draft_id ? `草稿 ${best.draft_id}` : '某条'}」拿了 ${best.views} 播放，最低那条只有 ${worst.views}`,
      proposal: `偏好：${platform} 这条选题方向值得再做，下一轮选题可以往这偏。`,
      evidence: { platform, best: { draft_id: best.draft_id, views: best.views }, worst: { draft_id: worst.draft_id, views: worst.views } },
      source: { snapshot_ids: [best.id, worst.id] },
    })
  }
  return candidates
}

// 确认后才生效：pending 的候选不算判据，rejected 的留着痕迹，避免同一件事反复问用户。
export function buildPreferenceRecords(candidates, { ownerId, existing = [], now = new Date().toISOString() } = {}) {
  const seen = new Set(existing.map(item => `${item.kind}|${item.local_id}|${item.source?.draft_id ?? ''}`))
  return candidates
    .filter(candidate => !seen.has(`${candidate.kind}|${candidate.local_id}|${candidate.source?.draft_id ?? ''}`))
    .map(candidate => ({ ...candidate, id: null, owner_id: ownerId, status: 'pending', replaces_feature: null, trace: [{ at: now, action: 'produced' }], created_at: now, updated_at: now }))
}

// 语言层通用特征被替换成什么样：只算 active 的，pending 不算，rejected 不算。
export function activeFeatureReplacements(preferences = []) {
  const map = new Map()
  for (const item of preferences) {
    if (item?.status !== 'active' || item.replaces_feature === null || item.replaces_feature === undefined) continue
    const featureId = Number(item.replaces_feature)
    if (!Number.isInteger(featureId)) continue
    map.set(featureId, { preference_id: item.id, proposal: item.proposal, confirmed_at: item.confirmed_at, source: item.source })
  }
  return map
}
