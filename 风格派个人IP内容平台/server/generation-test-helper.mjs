import { createServer } from 'node:http'
import { after } from 'node:test'

// 测试用上游大模型：按系统提示词分派，覆盖定位、选题、草稿正文、适配、改写、记忆提炼与复盘。

// 首轮正文按真实模型的量级给足字数。生成闸门里有「字数严重不足（低于目标下限六成）」一条，
// 正文只写十几个字的话生成会直接走重写路径，测试就看不到首轮正文了。
const fillTo = (seed, min) => { let out = ''; while (out.length < min) out += seed; return out }

export const mockBodies = title => ({
  master: fillTo(`母版正文：${title}。先给判断，再拆常见做法，最后给一步能做的动作。`, 320),
  小红书: fillTo(`小红书正文：${title}。昨天有个做家政的老板来问，账号发了半年还是没人咨询。我让她把最近十条翻出来，发现全在讲行业趋势，没有一条讲她怎么解决客户的具体问题。`, 300),
  抖音: fillTo(`抖音口播：${title}。上周我翻了后台，点赞会撒谎，询盘不会。别再为流量写，为成交写。`, 220),
  视频号: fillTo(`视频号口播：${title}。上周我翻了后台，泛泛而谈找路人，讲具体场面才找得着人。`, 220),
  公众号: fillTo(`公众号正文：${title}。上周我翻了后台，把内容当作品会自嗨。把内容当一次实验，看有没有人来问怎么买。没有就换角度，有就放大。`, 660),
})

export async function startGenerationMock({ adaptBody } = {}) {
  let mode = 'success'
  let lastSystem = ''
  const server = createServer(async (req, res) => {
    if (mode === 'failed') { res.writeHead(503); res.end('test failure'); return }
    let raw = ''
    for await (const chunk of req) raw += chunk
    const payload = JSON.parse(raw)
    const system = String(payload.messages?.[0]?.content || '')
    lastSystem = system
    const last = String(payload.messages?.at(-1)?.content || '')
    const reply = content => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: mode === 'invalid' ? 'invalid JSON' : content } }] })) }

    const sermon = '很多人做IP内容评估，靠的是拍完后的感觉。钱是唯一诚实的反馈。我有个客户花了三天写文案，结果数据惨淡。把内容拆到颗粒度再评估。内容不是艺术品，内容是产品。你只看点赞就是在蒙眼射箭。'.repeat(2)
    const sermonBodies = { master: sermon, 小红书: sermon, 抖音: `你是不是觉得做IP最难的是想选题？${sermon}`, 视频号: sermon, 公众号: sermon }
    const cleanBodies = title => ({
      master: `母版重写：${title}。先给判断，再拆常见做法，最后给一步能做的动作。`,
      小红书: `小红书笔记：${title}。昨天改选题时发现，发完就等数据的人最多。先问这条解决哪个场面。结尾让人评论你现在看的是点赞还是询盘。`,
      抖音: `抖音口播：${title}。上周我翻了后台，点赞会撒谎，询盘不会。别再为流量写，为成交写。`,
      视频号: `视频号口播：${title}。上周我翻了后台，泛泛而谈找路人，讲具体场面才找得着人。`,
      公众号: `公众号正文：${title}。上周我翻了后台，把内容当作品会自嗨。把内容当一次实验，看有没有人来问怎么买。没有就换角度，有就放大。`,
    })
    // 定点替换：给一对能落地的、一对原文里不存在的，测试必须把后者丢掉。
    if (system.includes('只做定点替换')) {
      return reply(JSON.stringify({ pairs: [
        { old: '其实高频迭代才是长期主义。', new: '上周那版改到第四遍才有人来问价。' },
        { old: '这句原文里不存在。', new: '随便一句。' },
      ] }))
    }
    if (system.includes('只重写这一条')) {
      const fromLine = last.match(/^必须按修改意见改：(.+)$/m)
      const note = fromLine?.[1] || '按检查意见改'
      // 真实改写会保留原有判断，只动该动的地方。假模型以前无论原稿多长都回一句二十字的话，
      // 于是「越改越短」这种失败形态在测试里永远看不到。现在按原稿回写，长度基本不变。
      const current = String(last.match(/当前正文：\n([\s\S]*?)(?=\n上一稿(?:没过验收)?：|$)/)?.[1] || '').trim()
      if (mode === 'shrink_revise') return reply('点赞会撒谎，询盘不会。')
      if (!current) return reply(`按意见改写：${note}。点赞会撒谑，询盘不会。`)
      return reply(`按意见改写：${note}。\n${current.replace(/？/g, '。')}`)
    }
    if (system.includes('没过验收')) {
      if (mode === 'sermon_stuck') return reply(JSON.stringify(sermonBodies))
      const payload = JSON.parse(last)
      return reply(JSON.stringify(cleanBodies(payload.brief?.title || '重写')))
    }
    if (system.includes('文案写手')) {
      const brief = JSON.parse(last)
      if (mode === 'sermon' || mode === 'sermon_stuck') return reply(JSON.stringify(sermonBodies))
      return reply(JSON.stringify(mockBodies(brief.title)))
    }
    if (system.includes('多平台内容发布适配')) return reply(JSON.stringify({ title: '适配标题', body: typeof adaptBody === 'function' ? adaptBody(last) : `适配正文：${JSON.parse(last).title}`, hashtags: ['#测试标签'] }))
    if (system.includes('改稿助手')) {
      const payload = JSON.parse(last)
      if (payload.slot === 'title') return reply('对标改法之后的新标题')
      if (payload.slot === 'opening') return reply('改写后的开头段：真实过程比技巧更重要。')
      if (payload.slot === 'ending') return reply('改写后的结尾段')
      return reply('整篇重排后的正文')
    }
    if (system.includes('说回自己')) return reply('改成自己说法之后的正文')
    // Requirement 14：标题与开头的多方案输出。各带一条不合规的，测溯源校验真会丢掉。
    if (system.includes('挑标题')) {
      return reply(JSON.stringify({ plans: [
        { formula_id: 34, title: '90 天把内容做成能成交的系统', why: '结果承诺型，时间和结果都具体' },
        { formula_id: 17, title: '警告！这 3 件事让你的内容白写', why: '损失规避，制造不看就亏' },
        { formula_id: 999, title: '这条公式编号不存在', why: '故意给一个不存在的编号' },
      ] }))
    }
    if (system.includes('写开头')) {
      return reply(JSON.stringify({ plans: [
        { method: '素材提取', opening: '去年我发了 1200 条，咨询只有 3 个。', note: '用了结果数字', used_material: '去年我发了 1200 条' },
        { method: '悬念制造', opening: '发了半年没人问，为什么？', note: '把结论改成问题' },
        { method: '凭空编法', opening: '这个方法不存在', note: '故意给一个不认识的方法名' },
      ] }))
    }
    // Requirement 16：共鸣五维报告。故意给一条判定不在三档内的、一条维度不认识的，测校验会不会丢。
    if (system.includes('共鸣诊断')) {
      return reply(JSON.stringify({
        dimensions: [
          { id: 'silence', verdict: '有效', evidence: '点赞会撒谎，询盘不会', detail: '替受众说出了不敢公开的判断' },
          { id: 'gratification', verdict: '弱', evidence: '别再为流量写，为成交写', detail: '只给了信息价值，没给情绪出口' },
          { id: 'framing', verdict: '有效', evidence: '上周我翻了后台', detail: '站在做事的人这边' },
          { id: 'gateway', verdict: '无效', evidence: '询盘不会', detail: '找不到第一批传播者' },
          { id: 'belief', verdict: '很有效', evidence: '为成交写', detail: '判定不在三档内，这条应该被丢掉' },
          { id: 'unknown', verdict: '有效', evidence: '随便一句', detail: '维度不认识，这条应该被丢掉' },
        ],
        core: { text: '内容要按成交写，不为流量写', verdict: '明确' },
        emotion_core: { text: '被流量数字骗过的无力感', from: 'silence' },
        effective_stance: { text: '站在被数据骗过的服务者这边', from: 'framing' },
        audience_wants: { text: '怎么判断一条内容值不值得写', from: 'unknown' },
        fixes: { cut: ['「点赞会撒谎」后面绕的那句删掉'], compress: ['第二段的解释压成一句'], strengthen: ['「询盘不会」这句单独成行'] },
      }))
    }
    // 移植 dbs-script-flow：逐字稿三维检查。故意给一条判定不在三档内的、一条维度不认识的、一条段落号越界的，
    // 测校验会不会丢（模型给 5 条，落到用户面前只剩 2 条）。
    if (system.includes('逻辑延续检查法')) {
      return reply(JSON.stringify({
        findings: [
          { axis: 'continuity', segment: 1, verdict: '勉强', evidence: '点赞会撒谎，询盘不会', detail: '上一句没交代场景就直接给判断', fix: '在前面补一句你翻的是什么后台' },
          { axis: 'density', segment: 1, verdict: '偏松', evidence: '别再为流量写，为成交写', detail: '同一个判断讲了两遍', fix: '删掉后一句，只留一个' },
          { axis: 'spoken', segment: 1, verdict: '绕口', evidence: '为成交写', detail: '判定不在三档内，这条应该被丢掉' },
          { axis: 'unknown', segment: 1, verdict: '顺', evidence: '随便一句', detail: '维度不认识，这条应该被丢掉' },
          { axis: 'continuity', segment: 9, verdict: '断裂', evidence: '点赞会撒谎，询盘不会', detail: '段落号越界，这条应该被丢掉' },
        ],
        fixes: { cut: ['删掉重复的那句'], transition: ['第 1 段到第 2 段补一句过渡'], merge: [], rewrite: ['把长句拆成两句'] },
      }))
    }
    if (system.includes('记忆')) return reply(JSON.stringify([{ memory_type: 'style', content: '共享模型提炼的记忆' }]))
    if (system.includes('复盘')) return reply(JSON.stringify({ verdict: 'winner', summary: '表现优于往常', lessons: ['真实案例更受欢迎'], drivers: ['真实案例'] }))

    if (system.includes('形式匹配')) {
      const topic = JSON.parse(last).topic
      // 「错形式」用来测范围外的形式会不会被拦下来。
      if (topic.includes('错形式')) return reply(JSON.stringify({ form: '播客', reason: '故意给一个范围外的形式' }))
      const form = topic.includes('长文') ? '长文' : topic.includes('长视频') ? '长视频' : '短视频'
      return reply(JSON.stringify({ form, reason: `「${topic}」只需要把一个判断讲清楚，${form}就够` }))
    }
    if (system.includes('主张提炼')) {
      const text = JSON.parse(last).text
      // 「单一主张」用来测不触发提示的那条路径。
      const claims = text.includes('单一主张')
        ? ['先给判断，再给一步能做的动作']
        : ['内容要按成交写，不按流量写', '点赞会撒谎，询盘不会', '案例比观点更能带来咨询']
      return reply(JSON.stringify({ claims, mechanism: '把内容当成一次可复盘的成交实验', judgement: `核心判断：${claims[0]}`, scope: '适用于已经有成交动作的账号', why: '因为只有询盘能反馈内容有没有用' }))
    }
    if (system.includes('概念拆解')) {
      const term = JSON.parse(last).term
      return reply(JSON.stringify({ assumed: `你以为「${term}」是一种方法`, usages: ['培训场合里当卖点说', '交付场合里当步骤讲'], restored: `「${term}」其实指一组可重复的动作`, plain: '就是每次都能照着做的那套步骤', kind: 'question' }))
    }
    const input = JSON.parse(last)
    const result = input.answers
      ? Array.from({ length: 3 }, (_, index) => ({ name: `方向${index + 1}`, positioning_statement: input.answers['0'] || '根据能力形成内容', audiences: ['创业者'], problems: ['内容难以持续'], pillars: ['真实复盘'], uncertainties: ['需要验证需求'], answer_refs: Object.keys(input.answers).filter(key => input.answers[key]) }))
      : Array.from({ length: 3 }, (_, index) => ({ title: `${input.profile.role}的${input.sources[0].title}分析${index + 1}`, rationale: '基于提供的来源', content_job: '分享经验', strategy_layer: 'trust', source_indexes: [0] }))
    return reply(JSON.stringify(result))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const mock = {
    setMode: value => { mode = value },
    lastSystem: () => lastSystem,
    env: { PROJECT_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}`, PROJECT_LLM_API_KEY: 'test-only', PROJECT_LLM_MODEL: 'mock', LLM_DAILY_LIMIT: '100' },
    close: () => { server.closeAllConnections(); server.close() },
  }
  return mock
}

// 进程级共享 mock：测试文件顶部 await 一次即可，配合 after() 自动关闭。
export async function startSharedLlmMock(options) {
  const mock = await startGenerationMock(options)
  after(() => mock.close())
  return mock
}
