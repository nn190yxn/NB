import { parseArgs } from 'node:util'

// 开工前的「跑的是不是最新代码」闸门。
// 后台不热重载：改了 server/ 不重启，界面上看到的行为就不是最新代码的行为。2026-09-20 就这样白测了一整天。
// 判据由后台自己报（它启动时的源码指纹 vs 磁盘当前指纹），不在这里重复算一遍。

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.API_URL || 'http://127.0.0.1:3001' },
    timeout: { type: 'string', default: '2000' },
  },
})

const target = `${values.url.replace(/\/$/, '')}/api/version`
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), Number(values.timeout))

function report(prefix, info) {
  const started = info.started_at ? new Date(info.started_at).toLocaleString('zh-CN', { hour12: false }) : '未知'
  const ageMs = Date.now() - Date.parse(info.started_at || '')
  const age = Number.isFinite(ageMs) ? `${Math.max(0, Math.floor(ageMs / 60000))} 分钟前` : '未知'
  console.log(`${prefix} 后台版本 ${info.commit || '无 git'}${info.dirty ? '（工作区有未提交改动）' : ''}，启动于 ${started}（${age}），源码 ${info.source_files} 个文件`)
  if (info.newest_source_at) console.log(`  磁盘上最新的后台源码文件：${new Date(info.newest_source_at).toLocaleString('zh-CN', { hour12: false })}`)
}

try {
  const response = await fetch(target, { signal: controller.signal })
  clearTimeout(timer)
  if (!response.ok) {
    console.log(`FAIL 后台 ${target} 返回 ${response.status}。要么后台没起来，要么它旧到没有 /api/version——这种情况一律按「跑的是旧代码」处理：重启后台再验证。`)
    process.exitCode = 1
  } else {
    const info = await response.json()
    if (info.stale) {
      report('FAIL', info)
      console.log('  磁盘上的后台代码比正在跑的进程新：你改的东西还没生效。重启后台（关掉窗口重开，或 npm run server:watch）再算验证过。')
      process.exitCode = 1
    } else {
      report('OK  ', info)
    }
  }
} catch (error) {
  clearTimeout(timer)
  console.log(`FAIL 读不到 ${target}：${error instanceof Error ? error.message : String(error)}。后台没起来时也按「无法确认代码是最新」处理。`)
  process.exitCode = 1
}
