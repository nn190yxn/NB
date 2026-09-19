// 配比账（阶段 1「通电」）。
//
// 问题：layer_ratios 一直被存下来、被校验、被画成滑杆，但没有任何生成逻辑读它——
// 滑杆推成 80/10/10 跟推成 30/40/30，系统给出的选题一模一样。
//
// 这份账把配比变成可执行的东西：按期数各层已出条数与配比该出的条数对账，算出欠额，
// 再把欠额写进选题生成的提示词。它只影响「系统建议你做什么层」，不拦任何操作。

export const strategyLayers = ['reach', 'trust', 'conversion']

export const strategyLayerLabels = { reach: '泛流量触达', trust: '垂直信任', conversion: '核心目标转化' }

// review_period 沿用 ISO 8601 时长（默认 P14D）。解析不了就退回默认天数：
// 这个字段是历史遗留的，不该因为它写错就把整本账算成空的。
export function reviewPeriodDays(value, fallback = 14) {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?$/.exec(String(value ?? '').trim().toUpperCase())
  if (!match) return fallback
  const days = Number(match[1] || 0) * 7 + Number(match[2] || 0)
  return days > 0 ? days : fallback
}

export function layerLedger({ ratios = {}, topics = [], reviewPeriod = 'P14D', now = new Date() } = {}) {
  const days = reviewPeriodDays(reviewPeriod)
  const since = now.getTime() - days * 86400000
  const actual = Object.fromEntries(strategyLayers.map(layer => [layer, 0]))
  for (const topic of topics) {
    const layer = String(topic?.strategy_layer || '')
    if (!(layer in actual)) continue
    // 没有生成时间的选题算「本期之前」。宁可不计，也不要把它猜进本期的账里。
    const at = Date.parse(String(topic?.created_at || ''))
    if (!Number.isFinite(at) || at < since) continue
    actual[layer] += 1
  }
  const ratioOf = layer => Number(ratios?.[layer]) || 0
  const total = strategyLayers.reduce((sum, layer) => sum + actual[layer], 0)
  const expected = Object.fromEntries(strategyLayers.map(layer => [layer, total ? Math.round(ratioOf(layer) / 100 * total) : 0]))
  const deficit = Object.fromEntries(strategyLayers.map(layer => [layer, expected[layer] - actual[layer]]))
  // 欠得最多的层排最前；并列时配比大的优先。这是下一批的建议顺序，不是硬配额。
  const order = [...strategyLayers].sort((a, b) => (deficit[b] - deficit[a]) || (ratioOf(b) - ratioOf(a)))
  return { review_period: reviewPeriod, period_days: days, total, actual, expected, deficit, order }
}

// 交给模型的配比提示：说清这期已经出了什么、还欠什么，但不逼它按配额交作业。
export function layerLedgerNote(ledger, ratios = {}) {
  const ratioText = strategyLayers.map(layer => `${strategyLayerLabels[layer]} ${Number(ratios?.[layer]) || 0}%`).join(' / ')
  if (!ledger?.total) return `本期配比：${ratioText}。本期还没出内容，按这个比例决定这一批各层做几条。`
  const layerText = strategyLayers.map(layer => `${strategyLayerLabels[layer]} ${ledger.actual[layer]} 条`).join('、')
  const behind = ledger.order.filter(layer => ledger.deficit[layer] > 0)
  const lead = behind.length
    ? `还欠：${behind.map(layer => `${strategyLayerLabels[layer]} ${ledger.deficit[layer]} 条`).join('、')}，优先补欠得多的层。`
    : '各层都跟得上配比，按内容本身的合适度选层。'
  return `本期配比：${ratioText}。本期已出：${layerText}（共 ${ledger.total} 条）。${lead}`
}
