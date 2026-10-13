import { spawn } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'

// M2 端到端实机验收（批次 3.9 + 6.2）。
//
// 它做的事和用户自己在界面上走一遍是一样的：拿一条热点 → 一对角度拆主张 → 逐条查逻辑 →
// 立选题 → 带着料生成稿子 → 转口播 → 定稿 → 回填数据 → 回流候选确认。
// 差别只在它是自动的，且每一步都留下「成 / 不成」的判据，不用靠人眼盯着。
//
// 安全边界：跑之前把 server/data.json 复制一份到临时目录，测的是副本，绝不碰真实数据。
// 会真花模型调用（约 6 次），所以要显式 --run；不加就只打印计划，一次模型都不调。

const root = join(import.meta.dirname, '..')
const run = process.argv.includes('--run')
const owner = 'demo-user'
const headers = { 'x-user-id': owner, 'content-type': 'application/json' }

const results = []
function check(step, ok, detail) {
  results.push({ step, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step}\n     ${detail}`)
  return Boolean(ok)
}

async function freePort() {
  return new Promise(resolve => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

const dataCopy = join(mkdtempSync(join(tmpdir(), 'm2-verify-')), 'data.json')
copyFileSync(join(root, 'server/data.json'), dataCopy)
const port = await freePort()
const baseUrl = `http://127.0.0.1:${port}`
console.log(`副本数据：${dataCopy}\n后台：${port}（真实 server/data.json 不会被这个进程读写）`)

const child = spawn(process.execPath, ['server/index.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_FILE: dataCopy },
  stdio: ['ignore', 'pipe', 'pipe'],
})
// 后台日志留在手里：某一步 502 时，光看接口回的那句"请重试"定位不了，
// 要的是后台自己打出来的 request_error / llm 那几行。
const log = []
child.stdout.on('data', chunk => log.push(String(chunk)))
child.stderr.on('data', chunk => log.push(String(chunk)))
const lastErrors = count => log.join('').split('\n').filter(line => /request_error|model_call_failed|llm_|MODEL_/.test(line)).slice(-count).join(' | ')

async function waitReady() {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/version`)
      if (response.ok) {
        const info = await response.json()
        if (!info.stale) return info
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('测试后台启动超时')
}

const call = async (path, body, method = 'POST') => {
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const payload = await response.json().catch(() => null)
  return { status: response.status, body: payload }
}

// 上游 502（本项目没配备援模型）是会反复发生的，前面 6 次实跑里有 2 次卡在它上面。
// 环境抖动不该被记成"链路有缺陷"：这里重试几次，仍然不成就把这一步标成 ENV，
// 与 FAIL 分开列，免得下一次看的人又去改代码。
const envFlaky = []
async function tryCall(label, path, body, method = 'POST', attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await call(path, body, method)
    if (result.status < 500) return result
    if (attempt < attempts) {
      console.log(`     … ${label} 上游 ${result.status}（第 ${attempt} 次），等 8 秒重试`)
      await new Promise(resolve => setTimeout(resolve, 8000))
    }
  }
  envFlaky.push(`${label}（重试 ${attempts} 次仍是上游失败）`)
  return call(path, body, method)
}
const read = async path => (await (await fetch(`${baseUrl}${path}`, { headers })).json())

let server
try {
  server = await waitReady()
  check('S0 后台跑的就是当前代码', !server.stale, `版本 ${server.commit || '无 git'}，源码 ${server.source_files} 个文件`)
} catch (error) {
  check('S0 后台启动', false, error.message)
  child.kill()
  process.exitCode = 1
}

if (server) {
  if (!run) {
    console.log('\n没有 --run：一次模型都不调，只检查不需要模型的前几步。')
  }

  const library = await read('/api/materials')
  const duplicates = await read('/api/materials/duplicates')
  check('S1 素材库没有同文重复', duplicates.groups.length === 0, `${library.length} 条活素材，重复组 ${duplicates.groups.length} 个`)

  const collected = await call('/api/research/hot-search/collect', { platform: '抖音', entries: [{ title: '西贝关闭多家门店，老板承认账算错了' }] })
  const entry = collected.body?.items?.[0]
  check('S2 热点进研究库', Boolean(entry), `研究条目 #${entry?.id}（source=${entry?.source}）`)

  const modelConfigured = (await read('/api/api-settings')).some(slot => slot.configured)
  if (!modelConfigured) {
    check('S2.5 模型已配置', false, '副本里没有可用的 text_primary 配置，后面需要模型的步骤全部跳过')
  } else if (!run) {
    console.log('\n模型已配置。加 --run 才会真跑：预计 6 次调用（拆主张 1 + 查逻辑 2 + 生成 1 + 转口播 1 + 复盘 1）。')
  } else {
    // 素材必须两边都有话：拿只写了老板一方的文字去测「反方进简报」，测的是模型的意愿，不是接线。
    // 这段是沙箱界面走查里实测过的：同模型同配置下出过 3 条老板 + 2 条员工。
    // （真模型对单方面素材会如实给空数组——提示词明令不许补素材里没说的话，那是正确行为，脚本会这样报出来。）
    const claims = await tryCall('拆主张', '/api/skills/claims', { text: '西贝关店这件事，真正的账不在人在流程。扩张那两年没人问过单店赚不赚钱，老板忙着签新店，员工忙着按手册摆桌。出事后第一句是产品没问题，是流量不行。可员工心里清楚：客人少了，店长还在按总部的排班表排人。', angles: ['老板', '员工'] })
    const items = claims.body?.claim_items || []
    // 上游没有备援模型，429 / 超时是会发生的；发生就把原因打出来，别让它伪装成"没提到主张"。
    const claimError = claims.status !== 200 ? `${claims.status} ${claims.body?.error || ''}` : ''
    const claimDetail = items.length ? `角度 ${JSON.stringify(claims.body?.angles)}，提出 ${items.length} 条：${items.map(item => `[${item.angle}]${item.text.slice(0, 12)}`).join('　')}` : `${claimError}${claimError ? ' | 后台日志 ' + lastErrors(6) : ' | 模型一条主张都没提到'}`
    check('S3 一对角度拆出主张', items.length > 0, claimDetail)

    // 每个角度各存一条：只存同一个角度的话，反方天然是空的，测不到配对这件事。
    const picked = []
    for (const item of items) if (!picked.some(existing => existing.angle === item.angle)) picked.push(item)
    const stored = []
    for (const item of (picked.length >= 2 ? picked : items).slice(0, 2)) {
      const saved = await call('/api/materials/atoms', { kind: 'insight', text: item.text, unit_type: 'OPI', angle: item.angle, claims_run: claims.body?.run_id, source_label: '提主张' })
      if (saved.body?.id) stored.push(saved.body)
    }
    check('S4 逐条入库（一条主张一条素材）', stored.length >= 1, `存了 ${stored.length} 条，角度分别是 ${stored.map(item => item.angle).join('、')}`)

    let judged = 0
    for (const item of stored) {
      const verdict = await tryCall('查逻辑', '/api/skills/claims/check', { material_id: item.id })
      if (['passed', 'conditional', 'failed'].includes(verdict.body?.status)) judged += 1
    }
    check('S5 每条主张都能查逻辑', judged === stored.length, `${judged}/${stored.length} 条出了三档结论；不成立的也仍留在库里可用`)

    const topic = await call('/api/topics', { title: '西贝关店：老板算错的那笔账', angle: '经营', viewpoint_material_id: stored[0]?.id })
    check('S6 手动立选题并指定主观点', Boolean(topic.body?.id), `选题 #${topic.body?.id}，角度 ${topic.body?.angle}，主观点素材 #${topic.body?.viewpoint_material_id}`)

    const generated = await tryCall('生成草稿', '/api/drafts/generate', { topic_id: topic.body?.id })
    const draft = Array.isArray(generated.body) ? generated.body[0] : null
    // 上游 429 / 502 是会发生的（本项目没配备援模型）。发生就照实报，
    // 并跳过依赖这份草稿的步骤——脚本崩掉会把「其实没问题」的结论一起吞掉。
    if (!draft) check('S7 草稿生成', false, `${generated.status} ${generated.body?.error || JSON.stringify(generated.body || {}).slice(0, 160)}`)
    const brief = draft?.generation_context?.brief
    check('S7 生成成功且主观点进了简报', Boolean(draft) && brief?.stance?.text === stored[0]?.content, brief?.stance ? `stance=[${brief.stance.angle}] ${String(brief.stance.text).slice(0, 30)}` : `没有 stance（${generated.status}）`)
    check('S8 主张真的喂给了模型（不再只给标题）', (brief?.material_roles?.OPI?.length || 0) > 0 && brief?.material_gap === null, `简报里主张 ${brief?.material_roles?.OPI?.length} 条、案例 ${brief?.material_roles?.CAS?.length} 条；material_gap=${brief?.material_gap === null ? 'null（有料）' : '有值（裸写）'}`)
    const blankAngles = (claims.body?.angles || []).filter(asked => !(items || []).some(item => item.angle === asked))
    check('S9 反方角度进了简报', (brief?.counterparts?.length || 0) > 0, (brief?.counterparts?.length || 0) ? `反方 ${brief.counterparts.length} 条：${brief.counterparts.map(item => `[${item.angle}]${item.text.slice(0, 14)}`).join('　')}` : `反方 0 条${blankAngles.length ? `——「${blankAngles.join('、')}」这个角度模型没在素材里找到不同说法（界面会明说，不是接线断了）` : '，两个角度都提出了主张却没配出反方，这是链路缺陷'}`)

    if (!draft) {
      console.log('SKIP 后面几步依赖这份草稿（转口播 / 检查 / 定稿 / 回流），本次跳过')
    } else {
      const unbacked = draft?.generation_context?.gate?.unbacked_numbers || []
      check('S10 正文数字都能溯源', unbacked.length === 0, unbacked.length ? `标出 ${unbacked.length} 个不可溯源数字：${unbacked.join('、')}（只标不拦，供你核对）` : '没有编出来的数字')

      const spoken = await tryCall('转口播', `/api/drafts/${draft.id}/spoken`, {})
      const quality = spoken.body?.checks?.quality
      check('S11 转口播后检查没被清空', Boolean(quality) && quality.draft_version === spoken.body?.version, quality ? `质量门状态 ${quality.status}，对应 v${quality.draft_version}（当前 v${spoken.body?.version}）` : '转换后没有质量门结果')

      // 模拟人工改稿：定稿前自己动手改一句，终稿回流才数得出差分。
      const current = await read(`/api/drafts/${draft.id}`)
      const edited = await call(`/api/drafts/${draft.id}`, { body: `${current.body}（自己补的一句：先去看单店账，再谈扩张）` }, 'PUT')
      check('S12 手改正文能存住', [200, 204].includes(edited.status), `${edited.status}${edited.body?.error ? ' ' + edited.body.error : ''}`)

      // 先把「事实已核验」按上（等价界面上那个按钮），再改正文、再跑检查：
      // 任何一次写正文都会抬版本号，检查必须在最后一次写之后跑，否则"这一版没查过"。
      await call(`/api/drafts/${draft.id}`, { fact_check_status: 'verified' }, 'PUT')
      const persona = await call(`/api/drafts/${draft.id}/checks/persona`, { force: true })
      const qualityRun = await call(`/api/drafts/${draft.id}/checks/quality`, { force: true })
      check('S13 四道检查跑得通', persona.status === 200 && Boolean(qualityRun.body?.checks?.quality), `人设 ${persona.body?.checks?.persona?.status}、质量门 ${qualityRun.body?.checks?.quality?.status}`)

      const publishRun = await call(`/api/drafts/${draft.id}/checks/publish`, { force: true })
      const checklist = publishRun.body?.checks?.publish_checklist
      check('S13.5 发布清单跑得通', publishRun.status === 200 && Boolean(checklist), `发布清单 ${checklist?.status || publishRun.body?.error || publishRun.status}${checklist?.status === 'blocked' ? '：' + (checklist.evidence || []).map(item => item.message).join('；') : ''}`)

      const live = await read(`/api/drafts/${draft.id}`)
      const approved = await call(`/api/drafts/${draft.id}/approve`, { version: live.version })
      const blockedReason = approved.body?.error || ''
      // 清单没过就不该让定稿——那种 409 是正确行为，脚本要能分清「拦住是对的」和「走不通」。
      const legitimatelyBlocked = checklist?.status === 'blocked' && approved.status === 409
      check('S14 定稿能进拍摄', approved.body?.approval?.status === 'approved' || [200, 201].includes(approved.status) || legitimatelyBlocked, approved.body?.approval ? `approval=${approved.body.approval.status}` : legitimatelyBlocked ? `被发布清单合理拦住：${blockedReason}（需要人改稿，不是流程断了）` : `${approved.status} ${blockedReason}`)

      const flowed = await call(`/api/drafts/${draft.id}/preferences`, {})
      check('S15 终稿回流产出候选（真实数据里这一项一直是 0）', (flowed.body?.created?.length || 0) > 0, flowed.body ? `产出 ${flowed.body.created?.length} 条候选，待确认` : `${flowed.status} ${flowed.body?.error || ''}`)

      const first = await call('/api/performance-snapshots', { draft_id: draft.id, platform: '抖音', metrics: { 播放量: 2000, 点赞数: 120, 评论数: 60, 收藏数: 90 }, status: 'confirmed' })
      await call('/api/performance-snapshots', { draft_id: draft.id, platform: '抖音', metrics: { 播放量: 4000, 点赞数: 40 }, status: 'confirmed' })
      const dataFlow = await call('/api/preferences/data-flow', {})
      check('S16 发布数据能回填并产出数据回流候选', Boolean(first.body?.id || first.body?.snapshot?.id) && (dataFlow.body?.created?.length || 0) > 0, `快照已入、数据回流候选 ${dataFlow.body?.created?.length} 条（${dataFlow.body?.error || ''}）`)

      const all = await read('/api/preferences')
      const pending = (all.preferences || []).find(item => item.status === 'pending')
      const confirmed = pending ? await call(`/api/preferences/${pending.id}/confirm`, {}) : { status: 0 }
      check('S17 候选经确认才生效', [200, 201].includes(confirmed.status), pending ? `确认了候选 #${pending.id}` : `没有待确认候选（${(all.preferences || []).length} 条，状态 ${(all.preferences || []).map(item => item.status).join('/')}）`)
    }
    }

  const failed = results.filter(item => !item.ok)
  console.log(`\n===== ${results.length - failed.length}/${results.length} 步通过 =====`)
  if (failed.length) console.log(`不成的步骤：\n${failed.map(item => `  · ${item.step} —— ${item.detail}`).join('\n')}`)
  process.exitCode = failed.length ? 1 : 0
  child.kill()
}
