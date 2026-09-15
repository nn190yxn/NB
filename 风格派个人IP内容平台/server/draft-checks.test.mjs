import assert from 'node:assert/strict'
import test from 'node:test'
import { checkPersona, checkPublishChecklist, checkQuality, hasBlockedCheck } from './draft-checks.mjs'
import { draftBriefPrompt, draftLengthTargets } from './draft-writing.mjs'

const opening = { option_id: 'structure-2', name: '开头范式一：预测攻击式', source: '对标dbs', applied_at: '2026-09-14T00:00:00.000Z' }
const baseDraft = { id: 4, version: 2, title: '真实创业复盘', body: '很多人以为这件事靠技巧，其实关键是先把真实过程讲清楚。\n\n我记录一次真实过程，说明问题、证据和可执行步骤。\n\n最后给出方法和复盘建议，帮助读者完成下一步行动。', platform: '抖音', opening_ref: opening, source_refs: [{ type: 'topic', id: 4 }], fact_check_status: 'needs_review', variant_group_id: 'group-1', checks: {} }

test('persona check warns without blocking and quality returns bounded dimensions', () => {
  const persona = checkPersona(baseDraft, { role: '', audiences: [], pillars: [], prohibited_patterns: [] })
  assert.equal(persona.status, 'warning')
  assert.ok(persona.score >= 0 && persona.score <= 100)
  const quality = checkQuality(baseDraft, { audiences: [], pillars: [], viewpoints: [], problems: [] })
  assert.equal(quality.status, 'passed')
  assert.deepEqual(Object.keys(quality.dimensions), ['opening_clarity', 'audience_fit', 'core_point', 'evidence', 'structure_and_risk'])
  assert.ok(Object.values(quality.dimensions).every(score => score >= 0 && score <= 100))
})

test('quality and publish checks block missing evidence, risk and fact verification', () => {
  const quality = checkQuality({ ...baseDraft, opening_ref: null, source_refs: [], body: '包赚' }, {})
  assert.equal(quality.status, 'blocked')
  assert.ok(quality.evidence.some(item => item.code === 'opening_missing'))
  assert.ok(quality.evidence.some(item => item.code === 'risk_words'))
  const publish = checkPublishChecklist(baseDraft)
  assert.equal(publish.status, 'blocked')
  assert.equal(publish.dimensions.fact_check, false)
  assert.equal(hasBlockedCheck({ checks: { quality } }), true)
  assert.equal(hasBlockedCheck({ checks: { quality: { status: 'passed' } } }), false)
})

test('质量门把模型不遵守的平台字数不足当成警告而不是拦停', () => {
  // 实测：提示词要求抖音不超 250 字，模型给了 384 字；公众号要求 600-1200，模型给了 514 字。
  const long = checkQuality({ ...baseDraft, platform: '抖音', body: '口'.repeat(384) }, {})
  assert.equal(long.status, 'passed', '字数不合规不应直接拦停发布')
  const lengthEvidence = long.evidence.find(item => item.code === 'platform_length')
  assert.ok(lengthEvidence, '字数超出目标必须留下证据')
  assert.equal(lengthEvidence.severity, 'warning')
  assert.match(lengthEvidence.message, /384 字/)
  assert.match(lengthEvidence.message, /不超过 250 字/)
  assert.ok(long.suggestions.some(item => item.includes('不超过 250 字')))

  const short = checkQuality({ ...baseDraft, platform: '公众号', body: '短'.repeat(514) }, {})
  const shortEvidence = short.evidence.find(item => item.code === 'platform_length')
  assert.match(shortEvidence.message, /514 字/)
  assert.match(shortEvidence.message, /600-1200 字/)

  const fine = checkQuality({ ...baseDraft, platform: '小红书', body: '好'.repeat(507) }, {})
  assert.equal(fine.evidence.some(item => item.code === 'platform_length'), false)
})

test('质量门把设问开头当成警告：提示词要求第一句直给冲突或结论', () => {
  const question = checkQuality({ ...baseDraft, body: '你是不是经常面对空白的文档，觉得没东西可写？\n\n我记录一次真实过程。' }, {})
  const evidence = question.evidence.find(item => item.code === 'opening_question')
  assert.ok(evidence, '首句是问句必须留下证据')
  assert.equal(evidence.severity, 'warning')
  assert.match(evidence.message, /你是不是经常面对空白的文档/)
  assert.ok(question.suggestions.some(item => item.includes('开头句')))
  assert.equal(question.status, 'passed', '设问开头不应直接拦停发布')

  const statement = checkQuality({ ...baseDraft, body: '很多人以为这件事靠技巧，其实是先把过程讲清楚。' }, {})
  assert.equal(statement.evidence.some(item => item.code === 'opening_question'), false)
  // 问句出现在第二句不算开头问题
  const later = checkQuality({ ...baseDraft, body: '先给结论：这件事靠过程。那为什么大家都做不到？' }, {})
  assert.equal(later.evidence.some(item => item.code === 'opening_question'), false)
  // 口播稿开头是镜头提示行时，要看下一行而不是把镜头提示当成句子
  const afterDirection = checkQuality({ ...baseDraft, body: '（镜头怼脸，语速快）\n你以为灵感枯竭是因为没东西写？\n\n其实是因为没素材库。' }, {})
  const directionEvidence = afterDirection.evidence.find(item => item.code === 'opening_question')
  assert.ok(directionEvidence, '镜头提示行之后的问句仍要能被发现')
  assert.match(directionEvidence.message, /你以为灵感枯竭是因为没东西写？$/)
  assert.doesNotMatch(directionEvidence.message, /镜头怼脸/)
  // 首行只有镜头提示、下一行是结论时不应误报
  const clean = checkQuality({ ...baseDraft, body: '（镜头平稳，语速中等）\n别再做灵感奴隶了。\n\n具体怎么做。' }, {})
  assert.equal(clean.evidence.some(item => item.code === 'opening_question'), false)
  // 标题行与「正文：」结构标签不算开头第一句
  const titled = checkQuality({ ...baseDraft, body: '标题：灵感枯竭？那是你没建素材库\n正文：\n别急着怪自己没灵感，先看你的素材库。' }, {})
  assert.equal(titled.evidence.some(item => item.code === 'opening_question'), false)
})

test('提示词里的字数与确定性检查用的是同一套数字', () => {
  const prompt = draftBriefPrompt({})
  assert.match(prompt, new RegExp(`小红书 ${draftLengthTargets.小红书.min}-${draftLengthTargets.小红书.max} 字`))
  assert.match(prompt, new RegExp(`不超过 ${draftLengthTargets.抖音.max} 字`))
  assert.match(prompt, new RegExp(`公众号 ${draftLengthTargets.公众号.min}-${draftLengthTargets.公众号.max} 字`))
})

test('legacy drafts remain publish-check compatible when otherwise complete', () => {
  const publish = checkPublishChecklist({ ...baseDraft, variant_group_id: null, variant_type: 'legacy', fact_check_status: 'verified' })
  assert.equal(publish.status, 'passed')
})
