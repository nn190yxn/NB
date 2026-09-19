import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collectionNames, userDocNames } from './mysql.mjs'
import { crossPlatformCollectionNames } from './content-assets.mjs'

// 这条测试防的是一整类 bug，不是某一个：
// saveState('<名>') 写的集合，如果不在登记清单里，MySQL 模式下会被白名单过滤掉、
// 静默不落库，而本地 JSON 模式完全看不出来（data.json 照样写）。
// 2026-09-19 审计就是这样查出 preferences 漏登记的。
//
// 登记点有三个，分放在两个文件里，少查一个就会误判——
// 这正是当时第一版脚本只抓一个清单、跑出「10 个集合漏掉」的原因。
// 这里直接把三个清单 import 进来，不再靠正则去抽。
const registered = new Set([...collectionNames, ...userDocNames, ...crossPlatformCollectionNames])

test('持久化：saveState 写过的每个集合都在登记清单里', () => {
  const src = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8')
  const written = [...new Set([...src.matchAll(/saveState\(\s*'([^']+)'/g)].map(m => m[1]))].sort()

  assert.ok(written.length > 0, '没抽到任何 saveState 调用——说明这个测试的抽取方式失效了，要先修测试本身')

  const missing = written.filter(name => !registered.has(name))
  assert.deepEqual(
    missing,
    [],
    `这些集合被 saveState 写了，但不在任何登记清单里：${missing.join(', ')}。` +
      'MySQL 模式下它们的写入会被静默丢弃。要加就加进 mysql.mjs 的 collectionNames（带 owner_id 的多文档集合）。',
  )

  // 顺带确认 preferences 确实登记上了——它是本次审计查出的那个。
  assert.ok(registered.has('preferences'), 'preferences 必须已登记')
})
