import assert from 'node:assert/strict'
import test from 'node:test'
import { layerLedger, layerLedgerNote, reviewPeriodDays, strategyLayers } from './layer-ledger.mjs'

const now = new Date('2026-09-19T00:00:00.000Z')
const daysAgo = days => new Date(now.getTime() - days * 86400000).toISOString()
const ratios = { reach: 50, trust: 30, conversion: 20 }

test('周期解析：认 ISO 8601 的周/天，认不出就退回默认，不把账算成空的', () => {
  assert.equal(reviewPeriodDays('P14D'), 14)
  assert.equal(reviewPeriodDays('P1W'), 7)
  assert.equal(reviewPeriodDays('P2W3D'), 17)
  assert.equal(reviewPeriodDays('p14d'), 14, '大小写不该影响')
  assert.equal(reviewPeriodDays(''), 14)
  assert.equal(reviewPeriodDays('每两周'), 14, '认不出的格式退回默认天数，不抛错')
  assert.equal(reviewPeriodDays('P0D'), 14, '零天不是有效周期')
  assert.equal(reviewPeriodDays('每月', 30), 30, '默认天数可覆盖')
})

test('配比账：本期一条没出时不下判断，三层都算平', () => {
  const ledger = layerLedger({ ratios, topics: [], reviewPeriod: 'P14D', now })
  assert.equal(ledger.total, 0)
  assert.deepEqual(ledger.actual, { reach: 0, trust: 0, conversion: 0 })
  assert.deepEqual(ledger.deficit, { reach: 0, trust: 0, conversion: 0 })
  assert.match(layerLedgerNote(ledger, ratios), /本期还没出内容/)
})

test('配比账：三层都按配比出满时没有欠额，提示说跟得上', () => {
  const topics = [
    ...Array.from({ length: 5 }, () => ({ strategy_layer: 'reach', created_at: daysAgo(1) })),
    ...Array.from({ length: 3 }, () => ({ strategy_layer: 'trust', created_at: daysAgo(1) })),
    ...Array.from({ length: 2 }, () => ({ strategy_layer: 'conversion', created_at: daysAgo(1) })),
  ]
  const ledger = layerLedger({ ratios, topics, reviewPeriod: 'P14D', now })
  assert.equal(ledger.total, 10)
  assert.deepEqual(ledger.deficit, { reach: 0, trust: 0, conversion: 0 })
  assert.match(layerLedgerNote(ledger, ratios), /都跟得上配比/)
})

test('配比账：滞后层算出正欠额，欠得最多的排最前', () => {
  const topics = Array.from({ length: 3 }, () => ({ strategy_layer: 'reach', created_at: daysAgo(1) }))
  const ledger = layerLedger({ ratios, topics, reviewPeriod: 'P14D', now })
  assert.equal(ledger.total, 3)
  assert.deepEqual(ledger.actual, { reach: 3, trust: 0, conversion: 0 })
  assert.deepEqual(ledger.expected, { reach: 2, trust: 1, conversion: 1 })
  assert.deepEqual(ledger.deficit, { reach: -1, trust: 1, conversion: 1 })
  // 信任与转化同为欠 1 条，配比大的一层排前面；超额的触达排最后。
  assert.deepEqual(ledger.order, ['trust', 'conversion', 'reach'])
  const note = layerLedgerNote(ledger, ratios)
  assert.match(note, /垂直信任 1 条/)
  assert.match(note, /核心目标转化 1 条/)
  assert.match(note, /优先补欠得多的层/)
})

test('配比账：周期外的选题和没有生成时间的选题都不计进本期', () => {
  const topics = [
    { strategy_layer: 'trust', created_at: daysAgo(1) },
    { strategy_layer: 'reach', created_at: daysAgo(20) },
    { strategy_layer: 'reach' },
    { strategy_layer: 'reach', created_at: '不是时间' },
    { strategy_layer: '不存在的层', created_at: daysAgo(1) },
  ]
  const ledger = layerLedger({ ratios, topics, reviewPeriod: 'P14D', now })
  assert.deepEqual(ledger.actual, { reach: 0, trust: 1, conversion: 0 }, '只认周期内、有生成时间、层级合法的选题')
  assert.equal(ledger.total, 1)
})

test('配比账：周期按 review_period 变，P7D 与 P28D 口径不同', () => {
  const topics = [{ strategy_layer: 'trust', created_at: daysAgo(10) }]
  assert.equal(layerLedger({ ratios, topics, reviewPeriod: 'P7D', now }).total, 0, '十天前出的内容不在七天的账里')
  assert.equal(layerLedger({ ratios, topics, reviewPeriod: 'P28D', now }).total, 1, '但在二十八天的账里')
})

test('配比账：配比推成 80/10/10 后，欠额跟着变', () => {
  const topics = [
    ...Array.from({ length: 5 }, () => ({ strategy_layer: 'reach', created_at: daysAgo(1) })),
    ...Array.from({ length: 3 }, () => ({ strategy_layer: 'trust', created_at: daysAgo(1) })),
    ...Array.from({ length: 2 }, () => ({ strategy_layer: 'conversion', created_at: daysAgo(1) })),
  ]
  const heavy = layerLedger({ ratios: { reach: 80, trust: 10, conversion: 10 }, topics, reviewPeriod: 'P14D', now })
  // 十条里按 80/10/10 该是 8/1/1，实际 5/3/2：触达还欠 3 条，信任与转化各超 2 条和 1 条。
  assert.deepEqual(heavy.deficit, { reach: 3, trust: -2, conversion: -1 })
  assert.equal(heavy.order[0], 'reach', '推高触达占比后，触达变成最欠的一层')
  assert.notDeepEqual(heavy.deficit, layerLedger({ ratios, topics, reviewPeriod: 'P14D', now }).deficit, '配比不同，账就必须不同')
})

test('配比账：三层之外不认，缺字段不炸', () => {
  const ledger = layerLedger()
  assert.deepEqual(ledger.actual, { reach: 0, trust: 0, conversion: 0 })
  assert.deepEqual(Object.keys(ledger.actual), strategyLayers, '账目只跟三层对齐')
  assert.equal(ledger.total, 0)
  assert.match(layerLedgerNote(ledger, {}), /泛流量触达 0%/)
})
