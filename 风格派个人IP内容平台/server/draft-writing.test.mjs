import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDraftBrief, consultingToneWords, defaultDraftStructure, draftBriefPrompt, draftDeaiPrompt, draftFormatOf, draftGateRewritePrompt, draftLengthTargets, draftPlatformBaselineText, draftPlatformBaselines, draftPlatformForms, draftPlatformRevisePrompt, draftPlainFormOf, draftReviseUserMessage, draftSpokenPrompt, draftPlatforms, draftVideoFormats, parseDraftBodies, parseReviseBody, parseReplacePairs, validateReplacePairs, applyReplacePairs, draftReplacePrompt } from './draft-writing.mjs'
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
    const timeout = setTimeout(() => reject(new Error('草稿写作 API 启动超时')), 20000)
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
  assert.match(prompt, /本期只写抖音和视频号两条/)
  assert.match(prompt, /两者必须是两种读感/)
  assert.match(prompt, /两平台长度目标相同，差异不在字数/)
  assert.match(prompt, /平铺直叙/)
  assert.doesNotMatch(prompt, /完整口播句/)
  assert.doesNotMatch(prompt, /短视频口播/)
  assert.match(prompt, /把一件事讲清楚比卡时长重要/)
  assert.match(draftPlatformForms.小红书, /不超过 1000 字/)
  assert.match(draftPlatformForms.抖音, /短视频口播/)
  assert.equal(draftLengthTargets.小红书.max, 1000)
  assert.equal(draftLengthTargets.公众号.min, 1000)
  assert.match(draftGateRewritePrompt('两平台同一篇'), /没过验收/)
  assert.match(draftGateRewritePrompt('两平台同一篇'), /不能同一篇改字数/)
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
  // Requirement 11 第 4 条：不以「去 AI 味」为目标表述，目标是让作者把话说回自己。
  assert.equal(/去 ?AI ?味|去 ?AI ?感/.test(deai), false, '提示词里不许出现「去 AI 味 / 去 AI 感」这类目标表述')
  assert.match(deai, /说回自己/, '要说清真正的目标是把话说回自己')
  assert.ok(consultingToneWords.every(word => deai.includes(word)), '改写必须按同一份词表')
  assert.match(draftPlainFormOf('短视频'), /平铺直叙/)
  assert.match(draftSpokenPrompt('抖音', '短视频'), /改成可以直接拍摄/)
  assert.match(draftSpokenPrompt('抖音', '短视频'), /不许另写一篇/)
  assert.match(draftSpokenPrompt('抖音', '短视频'), /完整口播句/)
  assert.match(draftPlatformRevisePrompt('抖音', '短视频', { scriptStage: 'plain' }), /平铺直叙/)
  assert.doesNotMatch(draftPlatformRevisePrompt('抖音', '短视频', { scriptStage: 'plain' }), /短视频口播/)

  const bodies = parseDraftBodies('前言 {"master":"母版","抖音":"只给了抖音"} 结尾')
  assert.equal(bodies['抖音'], '只给了抖音')
  assert.equal(bodies['视频号'], '母版')
  assert.throws(() => parseDraftBodies('没有 JSON 的回复'), /JSON/)
  assert.throws(() => parseDraftBodies('{"抖音":"缺少母版"}'), /母版/)
})

test('平台收敛到抖音与视频号，历史平台仍可读，平台基座被生成与改稿引用', () => {
  assert.deepEqual(draftPlatforms, ['抖音', '视频号'])
  // 两平台的差异不是字数：长度目标相同，差的是观众心理、开头、节奏、结尾和失败形态。
  assert.deepEqual(draftLengthTargets.抖音, draftLengthTargets.视频号)
  assert.notEqual(draftPlatformBaselines.抖音.rhythm, draftPlatformBaselines.视频号.rhythm)
  assert.notEqual(draftPlatformBaselines.抖音.ending, draftPlatformBaselines.视频号.ending)

  const prompt = draftBriefPrompt({})
  for (const platform of draftPlatforms) assert.ok(prompt.includes(draftPlatformBaselineText(platform)), `${platform} 基座必须进生成提示词`)
  assert.doesNotMatch(prompt, /四个平台/, '生成提示词不该再提四个平台')
  assert.match(prompt, /"抖音":"\.\.\."/)

  const rewrite = draftGateRewritePrompt('')
  for (const platform of draftPlatforms) assert.ok(rewrite.includes(draftPlatformBaselineText(platform)), `${platform} 基座必须进打回重写提示词`)
  assert.doesNotMatch(rewrite, /四个平台/)

  assert.match(draftPlatformRevisePrompt('抖音', '短视频'), /平台读感（抖音）/)

  // 历史小红书 / 公众号草稿仍能取到体裁与长度目标，只是不再新生成。
  assert.match(draftPlatformForms.小红书, /不超过 1000 字/)
  assert.deepEqual(draftLengthTargets.公众号, { min: 1000, max: 2500 })
  assert.equal(draftFormatOf({ platform: '公众号', content_format: null }), '长文')
  assert.equal(draftPlatformBaselineText('小红书'), '', '历史平台不在基座里，返回空串而不是报错')
  assert.equal(draftPlatformRevisePrompt('公众号', '长文').includes('平台读感'), false)
})

test('层级进生成提示词：三层各给一套写法，选哪层只调哪层', () => {
  // 通电（阶段 1）：strategy_layer 以前只躺在简报里，提示词看都不看——
  // 同一个题目写成拉新还是写成转化，稿子一模一样。
  const reach = draftBriefPrompt({}, undefined, 'reach')
  const trust = draftBriefPrompt({}, undefined, 'trust')
  const conversion = draftBriefPrompt({}, undefined, 'conversion')
  assert.match(reach, /泛流量触达/)
  assert.match(trust, /垂直信任/)
  assert.match(conversion, /核心目标转化/)
  assert.notEqual(reach, trust)
  assert.notEqual(trust, conversion)
  assert.doesNotMatch(reach, /垂直信任|核心目标转化/, '选一层只调一层，不能把三层都塞进去')
  assert.doesNotMatch(trust, /泛流量触达/)

  // 没给层级（老调用方式）时维持原样，不塞进任何层级话术。
  const plain = draftBriefPrompt({})
  assert.doesNotMatch(plain, /泛流量触达|垂直信任|核心目标转化/)
  assert.equal(draftBriefPrompt({}, undefined, '不存在的层'), plain, '不认识的层级退回原样，不抛错')

  // 加了层级不能把平台基座、体裁、长度这些挤掉。
  for (const prompt of [reach, trust, conversion]) {
    for (const platform of draftPlatforms) assert.ok(prompt.includes(draftPlatformBaselineText(platform)))
    assert.match(prompt, /"抖音":"\.\.\."/)
  }
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
  assert.equal(drafts.length, 2)
  assert.ok(drafts[0].body.startsWith('抖音口播：真实正文测试'))
  assert.ok(drafts.find(item => item.platform === '视频号').body.startsWith('视频号口播：真实正文测试'))
  assert.equal(drafts[0].generation_context.provider, 'primary')
  assert.equal(drafts[0].generation_context.brief.title, '真实正文测试')
  assert.equal(drafts[0].generation_context.gate.rewritten, false)
  assert.ok(drafts.every(item => item.body && !item.body.includes('平台：')))
  assert.equal(drafts[0].script_stage, 'plain')
  assert.equal(drafts[0].plain_body, drafts[0].body)
  assert.equal(drafts[0].spoken_body, null)

  const spoken = await fetch(`${baseUrl}/api/drafts/${drafts[0].id}/spoken`, { method: 'POST', headers, body: JSON.stringify({ version: drafts[0].version }) })
  assert.equal(spoken.status, 200)
  const spokenDraft = await spoken.json()
  assert.equal(spokenDraft.script_stage, 'spoken')
  assert.equal(spokenDraft.plain_body, drafts[0].body)
  assert.match(spokenDraft.body, /口播稿/)
  assert.equal(spokenDraft.spoken_body, spokenDraft.body)
  assert.equal(spokenDraft.version, drafts[0].version + 1)

  const again = await fetch(`${baseUrl}/api/drafts/${drafts[0].id}/spoken`, { method: 'POST', headers, body: JSON.stringify({ version: spokenDraft.version }) })
  assert.equal(again.status, 200)
  assert.equal((await again.json()).version, spokenDraft.version, '已经是口播稿再点一次不能再堆一版')
})

test('生成验收不过则打回改写，仍不过则入库标待修改（A 方案）', async t => {
  const mock = await startGenerationMock()
  t.after(() => mock.close())
  const server = await startServer(mock.env)
  t.after(() => server.kill())

  mock.setMode('sermon')
  const rewritten = await generate()
  assert.equal(rewritten.status, 201)
  const drafts = await rewritten.json()
  assert.equal(drafts[0].generation_context.gate.rewritten, true)
  assert.match(drafts[0].body, /抖音口播：真实正文测试/)
  assert.equal(drafts.some(item => item.body.includes('颗粒度')), false)

  mock.setMode('sermon_stuck')
  const blocked = await generate()
  assert.equal(blocked.status, 201)
  const blockedDrafts = await blocked.json()
  assert.equal(blockedDrafts.length, 2)
  assert.ok(blockedDrafts.every(item => item.workflow_status === 'needs_revision'))
  assert.ok(blockedDrafts.every(item => item.generation_context.gate.failed === true))
  assert.ok(blockedDrafts.every(item => item.generation_context.gate.rewritten === true))
  assert.ok(blockedDrafts.every(item => item.generation_context.gate.summary))
  // A 方案的关键：拦停的稿子照常入库（不再 502 丢弃），用户可以在草稿页按句定位替换。
  const stored = await (await fetch(`${baseUrl}/api/drafts`, { headers })).json()
  const storedById = new Map(stored.map(item => [item.id, item]))
  assert.ok(blockedDrafts.every(item => storedById.get(item.id)?.workflow_status === 'needs_revision'))
  assert.ok(blockedDrafts.every(item => typeof item.body === 'string' && item.body.trim()))
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
  const shipinhao = drafts.find(item => item.platform === '视频号')
  assert.ok(douyin && shipinhao)
  assert.equal(douyin.content_format, '短视频')
  const otherBody = shipinhao.body

  const empty = await fetch(`${baseUrl}/api/drafts/${douyin.id}/revise`, { method: 'POST', headers, body: JSON.stringify({ note: '   ' }) })
  assert.equal(empty.status, 422)
  // 平台收敛后不再生成非视频平台，改用不属于短中长体裁的格式验证同一条 422。
  const badFormat = await fetch(`${baseUrl}/api/drafts/${shipinhao.id}/revise`, { method: 'POST', headers, body: JSON.stringify({ format: '图文笔记' }) })
  assert.equal(badFormat.status, 422)

  const revised = await fetch(`${baseUrl}/api/drafts/${douyin.id}/revise`, { method: 'POST', headers, body: JSON.stringify({ note: '再短一点，开头别设问', version: douyin.version }) })
  assert.equal(revised.status, 200)
  const next = await revised.json()
  assert.equal(next.id, douyin.id)
  assert.equal(next.platform, '抖音')
  assert.match(next.body, /按意见改写：再短一点/)
  assert.equal(next.version, douyin.version + 1)
  assert.equal(next.generation_context.revise.note, '再短一点，开头别设问')

  const stored = await (await fetch(`${baseUrl}/api/drafts`, { headers })).json()
  assert.equal(stored.find(item => item.id === shipinhao.id).body, otherBody)
  assert.equal(stored.find(item => item.id === douyin.id).body, next.body)

  const mid = await fetch(`${baseUrl}/api/drafts/${douyin.id}/revise`, { method: 'POST', headers, body: JSON.stringify({ format: '中视频', version: next.version }) })
  assert.equal(mid.status, 200)
  const midDraft = await mid.json()
  assert.equal(midDraft.content_format, '中视频')
  assert.equal(midDraft.generation_context.revise.note, '改成中视频')
  const afterMid = await (await fetch(`${baseUrl}/api/drafts`, { headers })).json()
  assert.equal(afterMid.find(item => item.id === shipinhao.id).body, otherBody)

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
    { old: '其实高频迭代才是长期主义。', new: '上周那版发出去，当天就有人来问价。' },
    { old: '我上周改了三版。', new: '改了三版。' },
    { old: '这句原文里没有。', new: '随便写一句。' },
    { old: '观众不欠你注意力。', new: '观众不欠你注意力。' },
  ] }))
  assert.equal(parsed.length, 4)
  const { accepted, dropped } = validateReplacePairs({ body, pairs: parsed })
  assert.equal(accepted.length, 1)
  assert.match(accepted[0].new, /当天就有人来问价/)
  assert.equal(dropped.length, 3)
  assert.equal(applyReplacePairs(body, accepted), '我上周改了三版。上周那版发出去，当天就有人来问价。观众不欠你注意力。')
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
  // 定点替换的正文也要写够：生成闸门有「字数严重不足（低于目标下限六成）」一条，
  // 正文太短会让扫描结果多出 length_severe，remaining 就不是 0 了。
  const body = `改稿这事我上周做了三版。其实高频迭代才是长期主义。${'上周三改到第三版，第四条才有人来问价。'.repeat(10)}`
  const saved = await fetch(`${baseUrl}/api/drafts/${douyin.id}`, { method: 'PUT', headers, body: JSON.stringify({ body, version: douyin.version }) })
  assert.equal(saved.status, 200)
  const target = await saved.json()

  const replaced = await fetch(`${baseUrl}/api/drafts/${douyin.id}/replacements`, { method: 'POST', headers, body: JSON.stringify({ version: target.version }) })
  assert.equal(replaced.status, 200)
  const result = await replaced.json()
  assert.equal(result.pairs.length, 1, '只有原文里唯一存在的那句能进来')
  assert.equal(result.dropped.length, 1, '原文里没有的句子要退回')
  assert.match(result.pairs[0].new, /当天就有人来问价/)
  assert.equal(result.remaining, 0, '替换完这条不该再有命中')
  assert.equal(target.body, body, '预览不该改动草稿')
})
