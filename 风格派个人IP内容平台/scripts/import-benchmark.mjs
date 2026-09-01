#!/usr/bin/env node
// 通用对标账号资料包导入器：把 benchmarks/*.json 资料包通过 API 导入结构库 / 素材原子 / AI 记忆。
// 用法: node scripts/import-benchmark.mjs <pack.json> [--base http://localhost:3001] [--user demo-user] [--password <访问密码>]
// 幂等：按标题/文本去重，重复执行不会产生重复数据。

import { readFileSync } from 'node:fs'

function parseArgs(argv) {
  const args = { base: 'http://localhost:3001', user: 'demo-user' }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key === '--base') args.base = argv[++i]
    else if (key === '--user') args.user = argv[++i]
    else if (key === '--password') args.password = argv[++i]
    else rest.push(key)
  }
  args.pack = rest[0]
  return args
}

const args = parseArgs(process.argv.slice(2))
if (!args.pack) {
  console.error('用法: node scripts/import-benchmark.mjs <pack.json> [--base http://localhost:3001] [--user demo-user] [--password <访问密码>]')
  process.exit(1)
}

const pack = JSON.parse(readFileSync(args.pack, 'utf8'))
const headers = { 'content-type': 'application/json' }
let sessionCookie = null

async function api(pathname, options = {}) {
  const res = await fetch(`${args.base}${pathname}`, {
    ...options,
    headers: { ...headers, ...(sessionCookie ? { cookie: sessionCookie } : {}), ...(options.headers || {}) },
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie && !sessionCookie) sessionCookie = setCookie.split(';')[0]
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${text}`)
  return body
}

async function listAll(pathname, pageKey = 'page') {
  const items = []
  let page = 1
  for (;;) {
    const sep = pathname.includes('?') ? '&' : '?'
    const body = await api(`${pathname}${sep}${pageKey}=${page}`)
    const batch = Array.isArray(body) ? body : body.items || []
    items.push(...batch)
    const total = Array.isArray(body) ? items.length : body.total ?? items.length
    if (!batch.length || items.length >= total) break
    page += 1
  }
  return items
}

async function main() {
  if (args.password) {
    await api('/api/auth/session', { method: 'POST', body: JSON.stringify({ password: args.password }) })
    console.log('✓ 密码认证成功')
  } else {
    headers['x-user-id'] = args.user
  }

  const [existingStructures, existingMaterials, existingMemories] = await Promise.all([
    listAll('/api/structures').catch(() => []),
    listAll('/api/materials').catch(() => []),
    listAll('/api/memories').catch(() => []),
  ])
  const structureTitles = new Set(existingStructures.map(item => item.title))
  const atomTexts = new Set(existingMaterials.filter(item => item.material_kind).map(item => item.content))
  const memoryKeys = new Set(existingMemories.filter(item => item.status !== 'archived').map(item => `${item.memory_type}:${item.content}`))

  const summary = { structures: { created: 0, skipped: 0 }, atoms: { created: 0, skipped: 0 }, memories: { created: 0, skipped: 0 } }
  let errors = 0

  const defaultPlatform = pack.defaults?.platform || '通用'
  for (const item of pack.structures || []) {
    if (structureTitles.has(item.title)) { summary.structures.skipped++; continue }
    try {
      await api('/api/structures', { method: 'POST', body: JSON.stringify({ title: item.title, steps: item.steps, platform: item.platform || defaultPlatform, content_type: item.content_type || '观点' }) })
      summary.structures.created++
    } catch (error) { console.error(`✖ 结构「${item.title}」: ${error.message}`); errors++ }
  }
  for (const item of pack.atoms || []) {
    if (atomTexts.has(item.text)) { summary.atoms.skipped++; continue }
    try {
      await api('/api/materials/atoms', { method: 'POST', body: JSON.stringify({ kind: item.kind, name: item.name, text: item.text }) })
      summary.atoms.created++
    } catch (error) { console.error(`✖ 原子「${(item.text || '').slice(0, 20)}…」: ${error.message}`); errors++ }
  }
  for (const item of pack.memories || []) {
    if (memoryKeys.has(`${item.memory_type}:${item.content}`)) { summary.memories.skipped++; continue }
    try {
      await api('/api/memories', { method: 'POST', body: JSON.stringify({ memory_type: item.memory_type, content: item.content }) })
      summary.memories.created++
    } catch (error) { console.error(`✖ 记忆「${item.content.slice(0, 20)}…」: ${error.message}`); errors++ }
  }

  console.log(`\n资料包「${pack.name}」导入完成：`)
  console.log(`  结构库   新增 ${summary.structures.created}，跳过 ${summary.structures.skipped}（共 ${pack.structures?.length || 0} 条）`)
  console.log(`  素材原子 新增 ${summary.atoms.created}，跳过 ${summary.atoms.skipped}（共 ${pack.atoms?.length || 0} 条）`)
  console.log(`  AI 记忆  新增 ${summary.memories.created}，跳过 ${summary.memories.skipped}（共 ${pack.memories?.length || 0} 条）`)
  if (errors) { console.error(`\n${errors} 条失败，修正后重跑即可（幂等，不会重复导入）`); process.exit(1) }
}

main().catch(error => { console.error(`导入失败: ${error.message}`); process.exit(1) })
