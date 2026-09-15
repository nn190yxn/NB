#!/usr/bin/env node
// 存量对标记忆迁移：把被错记为 style/topic 的对标机制改成 benchmark 并补来源标记。
// 判定依据是内容与资料包逐条精确匹配，不做猜测；可重复执行，已迁移的会跳过。
// 用法: node scripts/migrate-benchmark-memories.mjs [--pack scripts/benchmarks/dontbesilent.json] [--base http://localhost:3001] [--user demo-user] [--password <访问密码>] [--dry-run]

import { readFileSync } from 'node:fs'

function parseArgs(argv) {
  const args = { base: 'http://localhost:3001', user: 'demo-user', pack: 'scripts/benchmarks/dontbesilent.json', dryRun: false }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key === '--base') args.base = argv[++i]
    else if (key === '--user') args.user = argv[++i]
    else if (key === '--password') args.password = argv[++i]
    else if (key === '--pack') args.pack = argv[++i]
    else if (key === '--dry-run') args.dryRun = true
    else rest.push(key)
  }
  if (rest[0]) args.pack = rest[0]
  return args
}

const args = parseArgs(process.argv.slice(2))
const pack = JSON.parse(readFileSync(args.pack, 'utf8'))
const sourceLabel = String(pack.source_label || pack.name || '对标账号').trim()
const packContents = new Set((pack.memories || []).map(item => String(item.content || '').trim()).filter(Boolean))
if (!packContents.size) {
  console.error(`资料包「${args.pack}」里没有 memories，无法判定哪些是标的记忆`)
  process.exit(1)
}

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

async function main() {
  if (args.password) {
    await api('/api/auth/session', { method: 'POST', body: JSON.stringify({ password: args.password }) })
    console.log('✓ 密码认证成功')
  } else {
    headers['x-user-id'] = args.user
  }

  const memories = await api('/api/memories')
  const targets = memories.filter(item => packContents.has(String(item.content || '').trim()) && item.memory_type !== 'benchmark')
  const already = memories.filter(item => item.memory_type === 'benchmark' && packContents.has(String(item.content || '').trim())).length
  console.log(`记忆共 ${memories.length} 条；与资料包内容匹配且还不是对标机制的 ${targets.length} 条，已是标的 ${already} 条`)

  for (const memory of targets) {
    const label = `#${memory.id} [${memory.memory_type}] ${String(memory.content).slice(0, 24)}…`
    if (args.dryRun) { console.log(`→ 将迁移 ${label}`); continue }
    await api(`/api/memories/${memory.id}`, { method: 'PUT', body: JSON.stringify({ memory_type: 'benchmark', source_label: sourceLabel }) })
    console.log(`✓ 迁移 ${label}`)
  }
  console.log(args.dryRun ? '预览模式，未改动任何数据' : `完成：迁移 ${targets.length} 条为对标机制（来源「${sourceLabel}」）`)
}

main().catch(error => { console.error(`迁移失败: ${error.message}`); process.exit(1) })
