import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDraftBrief, consultingToneWords, defaultDraftStructure, draftBriefPrompt, draftDeaiPrompt, draftGateRewritePrompt, draftLengthTargets, draftPlatformForms, draftPlatformRevisePrompt, draftReviseUserMessage, draftPlatforms, draftVideoFormats, parseDraftBodies, parseReviseBody, parseReplacePairs, validateReplacePairs, applyReplacePairs, draftReplacePrompt } from './draft-writing.mjs'
import { startGenerationMock } from './generation-test-helper.mjs'
import { testPort } from './test-port.mjs'

const port = testPort(46000, 500)
const baseUrl = `http://127.0.0.1:${port}`
const headers = { 'content-type': 'application/json', 'x-user-id': 'draft-writing-user' }
const noModelEnv = { PROJECT_LLM_BASE_URL: '', PROJECT_LLM_API_KEY: '', PROJECT_LLM_MODEL: '' }

function startServer(extraEnv = {}) {
  const dataFile = join(mkdtempSync(join(tmpdir(), 'content-ip-draft-writing-')), 'data.json')
  writeFileSync(dataFile, '{}')
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, ...noModelEnv, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataFile, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('草稿写作 API 启动超时')), 5000)
    child.stdout.on('data', data => { if (String(data).includes('Content IP API listening')) { clearTimeout(timeout); resolve(child) } })
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`草稿写作 API 异常退出: ${code}`)) })
  })
}

const generate = () => fetch(`${baseUrl}/api/drafts/generate`, { method: 'POST', headers, body: JSON.stringify({ topic: { title: '真实正文测试', strategy_layer: 'trust', goal_refs: [] }, quote_ids: [], experience_ids: [] }) })

test('写作简报与模型输出解析保持纯函数行为', () => {
  const brief = buildDraftBrief({ topic: { title: '标题', strategy_layer: 'reach' }, structure: { steps: ['开场', '案例'] }, quotes: [{ content: '金句', name: '对标dbs·金句' }], experiences: [{ content: '经历' }], memories: [{ content: '偏好' }], mechanisms: [{ content: '结尾三选一', source_label: '对标dbs' }, { content: '缺来源的机制' }], hookText: 'Hook' })
  assert.equal(brief.title, '标题')
  assert.equal(brief.strategy_layer, 'reach')
  assert.deepEqual(brief.structure, ['开场', '案例'])
  assert.equal(brief.structure_source, 'library')
  assert.deepEqual(brief.platforms, draftPlatforms)
  assert.deepEqual(brief.platform_forms, draftPlatformForms)
  const emptyStructure = buildDraftBrief({ topic: { title: '无结构' }, quotes: [], experiences: [], memories: [], mechanisms: [] })
  assert.deepEqual(emptyStructure.structure, defaultDraftStructure)
  assert.equal(emptyStructure.structure_source, 'default')
  assert.equal(defaultDraftStructure.length, 4)
  assert.ok(defaultDraftStructure.every(step => !consultingToneWords.some(word => step.includes(word))), '默认四拍不能带工程词')
  assert.deepEqual(brief.quotes, [{ text: '金句', source: '对标dbs·金句' }])
  assert.deepEqual(brief.style, ['偏好'])
  assert.deepEqual(brief.mechanisms, [{ content: '结尾三选一', source: '对标dbs' }, { content: '缺来源的机制', source: '对标账号' }])
  assert.ok(brief.style.every(item => !brief.mechanisms.some(mechanism => mechanism.content === item)), '对标机制不能混进 style')

  const prompt = draftBriefPrompt({ role: '顾问' })
  assert.match(prompt, /身份：顾问/)
  assert.match(prompt, /style 是创作者本人的表达习惯，必须遵守/)
  assert.match(prompt, /mechanisms 是对标账号的可复制机制/)
  assert.match(prompt, /quotes 是对标账号的原话：只能当引用用/)
  assert.match(prompt, /不要提对标、也不要虚构对标来源/)
  assert.match(prompt, /按 structure 的顺序写/)
  assert.match(prompt, /不要把步骤原文、编号、方法名抄进正文/)
  assert.match(prompt, /先驳后立/)
  assert.match(prompt, /能脱离标题单独听懂/)
  assert.match(prompt, /四个平台必须是四种读感，不能同一篇改字数/)
  assert.match(prompt, /小红书是图文笔记/)
  assert.match(prompt, /平台正文上限 1000 字/)
  assert.match(prompt, /把一件事讲清楚比卡时长重要/)
  assert.match(draftPlatformForms.小红书, /不超过 1000 字/)
  assert.match(draftPlatformForms.抖音, /短视频口播/)
  assert.equal(draftLengthTargets.小红书.max, 1000)
  assert.equal(draftLengthTargets.公众号.min, 1000)
  assert.match(draftGateRewritePrompt('四平台同一篇'), /没过验收/)
  assert.match(draftGateRewritePrompt('四平台同一篇'), /不能同一篇改字数/)
  assert.match(draftPlatformRevisePrompt('抖音'), /只重写这一条抖音/)
  assert.match(draftPlatformRevisePrompt('抖音'), /必须按修改意见改/)
  assert.match(draftPlatformRevisePrompt('抖音', undefined, { fromChecks: true }), /不要只压短/)
  assert.match(draftPlatformRevisePrompt('抖音', undefined, { fromChecks: true }), /不要另写一篇更简单的/)
  const checkUser = draftReviseUserMessage({ fromChecks: true, note: '把字数改到不超过 250；第一句直给冲突或结论，不要问句', title: '真实创业复盘', body: '拆完爆款不会用？因为你只学了皮毛。' })
  assert.match(checkUser, /不要只压短/)
  assert.match(checkUser, /- 把字数改到不超过 250/)
  assert.match(checkUser, /当前正文：/)
  assert.match(checkUser, /拆完爆款不会用/)
  assert.doesNotMatch(checkUser, /"note"/)
  assert.match(draftPlatformRevisePrompt('抖音', '中视频'), /中视频口播提纲/)
  assert.match(draftPlatformRevisePrompt('抖音', '长视频'), /长视频大纲/)
  assert.equal(draftVideoFormats.中视频.length.max, 1000)
  assert.equal(draftVideoFormats.长视频.length.min, 600)
  assert.equal(parseReviseBody('按意见改写：再短一点。'), '按意见改写：再短一点。')
  assert.equal(parseReviseBody('```\n口播正文\n```'), '口播正文')
  assert.ok(consultingToneWords.every(word => prompt.includes(word)), '提示词必须带上整份咨询腔词表')
  const deai = draftDeaiPrompt()
  assert.match(deai, /去 AI 味/)
  assert.ok(consultingToneWords.every(word => deai.includes(word)), '去 AI 感必须按同一份词表改写')

  const bodies = parseDraftBodies('前言 {"master":"母版","小红书":"只给了小红书"} 结尾')
  assert.equal(bodies['小红书'], '只给了小红书')
  assert.equal(bodies['抖音'], '母版')
  assert.throws(() => parseDraftBodies('没有 JSON 的回复'), /JSON/)
  assert.throws(() => parseDraftBodies('{"小红书":"缺少母版"}'), /母版/)
})

test('未配置模型时草稿生成 422 且不落库', async t => {
  const server = await startServer()
  t.after(() => server.kill())
  const response = await generate()
  assert.equal(response.status, 422)
  assert.equal((await response.json()).reason, 'llm_not_configured')
  const drafts = await (await fetch(`${baseUrl}/api/drafts`, { headers })).json()
  assert.deepEqual(drafts, [])
})

test('模型返回无效内容时 502 且不落库，成功时正文来自模型', async t => {
  const mock = await startGenerationMock()
  t.after(() => mock.close())
  const server = await startServer(mock.env)
  t.after(() => server.kill())

  mock.setMode('invalid')
  const failed = await generate()
  assert.equal(failed.status, 502)
  assert.deepEqual(await (await fetch(`${baseUrl}/api/drafts`, { headers })).json(), [])

  mock.setMode('success')
  const created = await generate()
  assert.equal(created.status, 201)
  const drafts = await created.json()
  assert.equal(drafts.length, 4)
  assert.equal(drafts[0].body, '小红书正文：真实正文测试')
  assert.equal(drafts.find(item => item.platform === '抖音').body, '抖音口播：真实正文测试')
  assert.equal(drafts[0].generation_context.provider, 'primary')
  assert.equal(drafts[0].generation_context.brief.title, '真实正文测试')
  assert.equal(drafts[0].generation_context.gate.rewritten, false)
  assert.ok(drafts.every(item => item.body && !item.body.includes('平台：')))
})

test('生成验收不过则打回改写，仍不过则不入库', async t => {
  const mock = await startGenerationMock()
  t.after(() => mock.close())
  const server = await startServer(mock.env)
  t.after(() => server.kill())

  mock.setMode('sermon')
  const rewritten = await generate()
  assert.equal(rewritten.status, 201)
  const drafts = await rewritten.json()
  assert.equal(drafts[0].generation_context.gate.rewritten, true)
  assert.match(drafts[0].body, /小红书笔记：/)
  assert.equal(drafts.some(item => item.body.includes('颗粒度')), false)

  mock.setMode('sermon_stuck')
  const blocked = await generate()
  assert.equal(blocked.status, 502)
  const payload = await blocked.json()
  assert.equal(payload.code, 'GENERATION_GATE_FAILED')
  assert.match(payload.error, /未入库/)
  const stored = await (await fetch(`${baseUrl}/api/drafts`, { headers })).json()
  assert.equal(stored.length, 4)
  assert.ok(stored.every(item => item.body.includes('小红书笔记：') || item.body.includes('抖音口播：') || item.body.includes('视频号口播：') || item.body.includes('公众号正文：')))
})

test('只重写一个平台，带修改意见，不动其他平台', async t => {
  const mock = await startGenerationMock()
  t.after(() => mock.close())
  const server = await startServer(mock.env)
  t.after(() => server.kill())

  const created = await generate()
  assert.equal(created.status, 201)
  const drafts = await created.json()
  const douyin = drafts.find(item => item.platform === '抖音')
  const xhs = drafts.find(item => item.platform === '小红书')
  assert.ok(douyin && xhs)
  assert.equal(douyin.content_format, '短视频')
  const xhsBody = xhs.body

  const empty = await fetch(`${baseUrl}/api/drafts/${douyin.id}/revise`, { method: 'POST', headers, body: JSON.stringify({ note: '   ' }) })
  assert.equal(empty.status, 422)
  const wrongPlatform = await fetch(`${baseUrl}/api/drafts/${xhs.id}/revise`, { method: 'POST', headers, body: JSON.stringify({ format: '中视频' }) })
  assert.equal(wrongPlatform.status, 422)

  const revised = await fetch(`${baseUrl}/api/drafts/${douyin.id}/revise`, { method: 'POST', headers, body: JSON.stringify({ note: '再短一点，开头别设问', version: douyin.version }) })
  assert.equal(revised.status, 200)
  const next = await revised.json()
  assert.equal(next.id, douyin.id)
  assert.equal(next.platform, '抖音')
  assert.match(next.body, /按意见改写：再短一点/)
  assert.equal(next.version, douyin.version + 1)
  assert.equal(next.generation_context.revise.note, '再短一点，开头别设问')

  const stored = await (await fetch(`${baseUrl}/api/drafts`, { headers })).json()
  assert.equal(stored.find(item => item.id === xhs.id).body, xhsBody)
  assert.equal(stored.find(item => item.id === douyin.id).body, next.body)

  const mid = await fetch(`${baseUrl}/api/drafts/${douyin.id}/revise`, { method: 'POST', headers, body: JSON.stringify({ format: '中视频', version: next.version }) })
  assert.equal(mid.status, 200)
  const midDraft = await mid.json()
  assert.equal(midDraft.content_format, '中视频')
  assert.equal(midDraft.generation_context.revise.note, '改成中视频')
  const afterMid = await (await fetch(`${baseUrl}/api/drafts`, { headers })).json()
  assert.equal(afterMid.find(item => item.id === xhs.id).body, xhsBody)

  const missingChecks = await fetch(`${baseUrl}/api/drafts/${douyin.id}/revise`, { method: 'POST', headers, body: JSON.stringify({ from_checks: true, version: midDraft.version }) })
  assert.equal(missingChecks.status, 422)

  const saved = await fetch(`${baseUrl}/api/drafts/${douyin.id}`, { method: 'PUT', headers, body: JSON.stringify({ body: `拆完爆款不会用？上周三我翻了后台，${'口'.repeat(360)}`, version: midDraft.version }) })
  assert.equal(saved.status, 200)
  await fetch(`${baseUrl}/api/drafts/${douyin.id}/checks/persona`, { method: 'POST', headers, body: '{}' })
  const qualityRes = await fetch(`${baseUrl}/api/drafts/${douyin.id}/checks/quality`, { method: 'POST', headers, body: '{}' })
  assert.equal(qualityRes.status, 200)
  const withChecks = await qualityRes.json()
  const fromChecks = await fetch(`${baseUrl}/api/drafts/${douyin.id}/revise`, { method: 'POST', headers, body: JSON.stringify({ from_checks: true, version: withChecks.version }) })
  assert.equal(fromChecks.status, 200)
  const rewritten = await fromChecks.json()
  assert.match(rewritten.generation_context.revise.note, /把字数改到/)
})

test('替换对只认原文里唯一存在的句子，越改越短和没变化都丢掉', () => {
  const body = '我上周改了三版。其实高频迭代才是长期主义。观众不欠你注意力。'
  const parsed = parseReplacePairs(JSON.stringify({ pairs: [
    { old: '其实高频迭代才是长期主义。', new: '上周那版改到第四遍才有人来问价。' },
    { old: '我上周改了三版。', new: '改了三版。' },
    { old: '这句原文里没有。', new: '随便写一句。' },
    { old: '观众不欠你注意力。', new: '观众不欠你注意力。' },
  ] }))
  assert.equal(parsed.length, 4)
  const { accepted, dropped } = validateReplacePairs({ body, pairs: parsed })
  assert.equal(accepted.length, 1)
  assert.match(accepted[0].new, /第四遍/)
  assert.equal(dropped.length, 3)
  assert.equal(applyReplacePairs(body, accepted), '我上周改了三版。上周那版改到第四遍才有人来问价。观众不欠你注意力。')
  assert.equal(parseReplacePairs('不是 JSON').length, 0)
  assert.match(draftReplacePrompt({ platform: '抖音', format: '短视频', body, issues: ['ai_tone_phrase'] }), /逐字复制/)
})

test('定点替换只返回能落地的替换对，对不上的原样退回', async t => {
  const mock = await startGenerationMock()
  t.after(() => mock.close())
  const server = await startServer(mock.env)
  t.after(() => server.kill())

  const created = await generate()
  const drafts = await created.json()
  const douyin = drafts.find(item => item.platform === '抖音')
  assert.ok(douyin)
  const body = '改稿这事我上周做了三版。其实高频迭代才是长期主义。观众不欠你注意力。'
  const saved = await fetch(`${baseUrl}/api/drafts/${douyin.id}`, { method: 'PUT', headers, body: JSON.stringify({ body, version: douyin.version }) })
  assert.equal(saved.status, 200)
  const target = await saved.json()

  const replaced = await fetch(`${baseUrl}/api/drafts/${douyin.id}/replacements`, { method: 'POST', headers, body: JSON.stringify({ version: target.version }) })
  assert.equal(replaced.status, 200)
  const result = await replaced.json()
  assert.equal(result.pairs.length, 1, '只有原文里唯一存在的那句能进来')
  assert.equal(result.dropped.length, 1, '原文里没有的句子要退回')
  assert.match(result.pairs[0].new, /第四遍/)
  assert.equal(result.remaining, 0, '替换完这条不该再有命中')
  assert.equal(target.body, body, '预览不该改动草稿')
})
