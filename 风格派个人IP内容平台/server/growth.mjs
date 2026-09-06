// 内测体验闭环的纯函数实现：多平台发布适配、表现复盘启发式、研究机会匹配。
// 指标字段命名来自截图提取或手动填写，这里按关键词模糊匹配（如"播放量/likes/评论数"）。

export const publishChecklists = {
  通用: ['封面/首图已准备', '标题与正文一致', '话题标签已填写'],
  小红书: ['标题不超过 20 字', '正文不超过 1000 字', '话题标签 3-6 个', '配图不少于 3 张'],
  抖音: ['前 3 秒 Hook 明确', '口播不超过 250 字（约 60 秒）', '话题标签与字幕已加'],
  视频号: ['前 3 秒 Hook 明确', '口播不超过 250 字', '封面标题清晰'],
  公众号: ['摘要已填写', '封面图 2.35:1', '正文段落不超过 5 行', '文末引导语已加'],
  B站: ['标题信息量完整', '视频封面已上传', '分区与标签已选'],
  快手: ['前 3 秒 Hook 明确', '话题标签已加'],
  今日头条: ['标题信息量完整', '正文配图不少于 1 张'],
  X: ['正文不超过 280 字符', '附带视觉素材'],
}

const bodyLimitOf = { 小红书: 1000, 抖音: 250, 视频号: 250 }

export function buildChecklist(platform, bodyText, prohibitedHits = []) {
  const checklist = (publishChecklists[platform] || publishChecklists['通用']).map(item => ({ item, status: '待确认', detail: '' }))
  const limit = bodyLimitOf[platform]
  const length = String(bodyText || '').length
  if (limit) {
    const index = checklist.findIndex(entry => entry.item.includes('口播') || entry.item.includes('正文不超过'))
    if (index >= 0) checklist[index] = { ...checklist[index], status: length <= limit ? '通过' : '注意', detail: `当前 ${length} 字 / 建议不超过 ${limit} 字` }
  }
  checklist.unshift({ item: '无违禁词风险', status: prohibitedHits.length ? '风险' : '通过', detail: prohibitedHits.length ? `命中：${prohibitedHits.map(hit => hit.word).join('、')}` : '' })
  return checklist
}

export function deterministicAdaptation(draft, platform, profile, prohibitedHits = []) {
  const body = String(draft.body || '')
  let title = String(draft.title || '').trim()
  if (platform === '小红书' && title.length > 20) title = title.slice(0, 20)
  const tagSource = [...(profile.pillars || []), ...(profile.audiences || [])].map(value => String(value || '').trim()).filter(Boolean)
  const hashtags = platform === '公众号' ? [] : (tagSource.length ? tagSource.slice(0, 3) : ['个人IP']).map(tag => `#${tag.replace(/\s+/g, '').slice(0, 12)}`)
  return { title, body, hashtags, provider: 'builtin' }
}

const metricValue = (metrics, words) => {
  const entry = Object.entries(metrics || {}).find(([key, value]) => Number(value) > 0 && words.some(word => String(key).toLowerCase().includes(word)))
  return entry ? Number(entry[1]) : 0
}

export function retrospectDeterministic(snapshot, draft, peers = []) {
  const metrics = snapshot.metrics || {}
  const views = metricValue(metrics, ['play', 'view', '播放', '阅读'])
  const likes = metricValue(metrics, ['like', '点赞'])
  const comments = metricValue(metrics, ['comment', '评论'])
  const collects = metricValue(metrics, ['collect', '收藏'])
  const shares = metricValue(metrics, ['share', '转发', '分享'])
  const interactions = likes + comments + collects + shares
  const rate = views > 0 ? interactions / views : null
  const rates = peers.map(peer => Number(peer.retrospect?.rate)).filter(value => Number.isFinite(value) && value > 0)
  const average = rates.length ? rates.reduce((sum, value) => sum + value, 0) / rates.length : null
  const verdict = rate != null && average != null ? (rate > average * 1.2 ? 'winner' : rate < average * 0.8 ? 'underperformed' : 'ok') : rate != null && rate >= 0.05 ? 'winner' : 'ok'
  const total = Math.max(interactions, 1)
  const ratios = [
    { key: '评论', ratio: comments / total, lesson: '评论占比突出，说明话题有讨论空间，下一条可以延续提问式结尾。' },
    { key: '收藏', ratio: collects / total, lesson: '收藏占比突出，干货密度是有效因子，保持清单或步骤式表达。' },
    { key: '转发', ratio: shares / total, lesson: '转发占比突出，观点具有传播属性，可再提炼一句可引用的金句。' },
    { key: '点赞', ratio: likes / total, lesson: '点赞占比突出，情绪共鸣有效，沿用同类型开头。' },
  ].sort((a, b) => b.ratio - a.ratio)
  const drivers = ratios.filter(entry => entry.ratio > 0).slice(0, 2).map(entry => entry.key)
  const lessons = ratios.filter(entry => entry.ratio >= 0.25).slice(0, 2).map(entry => entry.lesson)
  if (!lessons.length) lessons.push('数据表现平稳，下一步尝试更强的 Hook 或更具体的案例细节。')
  const rateLabel = rate != null ? `互动率 ${(rate * 100).toFixed(1)}%` : `互动量 ${interactions}`
  const verdictLabels = { winner: '优于往常', ok: '表现持平', underperformed: '低于往常' }
  return {
    verdict,
    summary: `${snapshot.platform} · ${rateLabel} · 判定：${verdictLabels[verdict]}${draft?.title ? ` ·《${draft.title}》` : ''}`,
    lessons: lessons.slice(0, 3),
    drivers,
    rate,
    provider: 'builtin',
    created_at: new Date().toISOString(),
  }
}

export function fitScore(research, profile, strategy, now = new Date()) {
  const haystack = `${research.title || ''} ${research.query || ''}`
  const phrases = [...(profile?.pillars || []), ...(profile?.audiences || []), ...(profile?.problems || []), ...(profile?.role ? [profile.role] : [])]
    .map(value => String(value || '').trim()).filter(value => value.length >= 2)
  const matched = []
  let score = 0
  for (const phrase of phrases) {
    if (haystack.includes(phrase)) { score += 3; matched.push(phrase); continue }
    const chunk = phrase.length >= 4 ? Array.from({ length: Math.floor((phrase.length - 4) / 2) + 1 }, (_, index) => phrase.slice(index * 2, index * 2 + 4)).find(part => haystack.includes(part)) : null
    if (chunk) { score += 1; matched.push(chunk) }
  }
  if ((strategy?.platform_preferences || []).includes(research.platform)) { score += 2; matched.push(research.platform) }
  const captured = Date.parse(String(research.captured_at || ''))
  if (Number.isFinite(captured) && now.getTime() - captured <= 7 * 86400000) score += 1
  return { score: Math.min(Math.round(Math.min(score, 10) * 10) / 10, 10), matched: [...new Set(matched)].slice(0, 4) }
}
