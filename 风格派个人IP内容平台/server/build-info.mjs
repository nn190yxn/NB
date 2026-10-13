import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(moduleDir, '..')
const defaultEntry = path.join(moduleDir, 'index.mjs')

// 只算后台真正会 import 的文件：测试文件、测试用的假模型服务、data.json 改了都不该让角标变红。
// 本仓库的后台全是静态 import（没有 await import），所以走一遍图就是准确集合；
// 真出现解析不到的写法，最坏是"少报"，不会误报成陈旧。
const importPattern = /^\s*import[^'"]*['"]([^'"]+)['"]/gm

function importGraph(entry) {
  const seen = new Set()
  const queue = [path.resolve(entry)]
  while (queue.length) {
    const file = queue.shift()
    if (seen.has(file)) continue
    const stats = statSync(file, { throwIfNoEntry: false })
    if (!stats?.isFile()) continue
    seen.add(file)
    let source = ''
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1]
      // 包名（node_modules）不进图：那不是你刚改的东西
      if (!specifier.startsWith('.') && !path.isAbsolute(specifier)) continue
      queue.push(path.resolve(path.dirname(file), specifier))
    }
  }
  return [...seen]
}

// 磁盘指纹：文件数 + 最新修改时间 + 总字节数。
// 用指纹而不是只比 git commit——工作区有未提交改动时 commit 不变，恰恰是最需要发现「代码比进程新」的时候。
export function sourceFingerprint({ entry = defaultEntry } = {}) {
  const files = importGraph(entry)
  if (!files.length) return { files: 0, newest_at: null, revision: 'no-source' }
  let newest = 0
  let size = 0
  for (const file of files) {
    const stats = statSync(file, { throwIfNoEntry: false })
    if (!stats?.isFile()) continue
    newest = Math.max(newest, Math.floor(stats.mtimeMs))
    size += stats.size
  }
  return { files: files.length, newest_at: new Date(newest).toISOString(), revision: `${files.length}-${newest}-${size}` }
}

// 未跟踪的新文件不进 dirty：规格文档、备份目录改了都不会让在跑的代码变旧。
// 必须用 -z：非 ASCII 路径在默认输出里会被引号和八进制转义（这个仓库就在中文目录下），前缀比对会全部失配。
function trackedChanges(status, prefix) {
  const records = String(status || '').split('\0')
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    const marker = record.slice(0, 2)
    const changed = record.slice(3)
    // 重命名与复制的下一条记录是来源路径，没有状态前缀，要跳过。
    if (marker.includes('R') || marker.includes('C')) index += 1
    if (marker === '??' || marker === '!!' || !changed) continue
    if (prefix && !changed.startsWith(prefix)) continue
    return true
  }
  return false
}

// 取不到 git（打包版、没装 git、不在仓库里）就返回 null，让上层如实说「没有版本号」。
function defaultGitRun(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

export function readGitInfo({ root = defaultRoot, gitRun = defaultGitRun } = {}) {
  const commit = gitRun(['rev-parse', '--short', 'HEAD'], root)
  if (commit === null || commit === '') return { commit: null, dirty: false, source: 'none' }
  const status = gitRun(['status', '--porcelain', '-z'], root)
  // 这个目录可能是被整体提交进上层仓库的，git status 的路径就带着上一层的前缀；
  // 不过滤的话，别的子目录有改动会被当成「工作台代码没提交」，dirty 就是假的。
  const top = gitRun(['rev-parse', '--show-toplevel'], root)
  const prefix = top ? `${path.relative(path.resolve(top), root).replaceAll('\\', '/')}/` : ''
  return { commit, dirty: trackedChanges(status, prefix || undefined), source: 'git' }
}

export function createBuildInfo({ root = defaultRoot, entry = path.join(root, 'server/index.mjs'), now = () => Date.now(), gitRun } = {}) {
  const startedAt = now()
  const boot = sourceFingerprint({ entry })
  const git = readGitInfo({ root, gitRun })
  return {
    // 每次请求重算磁盘指纹：一次 readdir + 几十次 statSync，比调一次 git 便宜，也比缓存可信。
    snapshot(currentNow = now()) {
      const current = sourceFingerprint({ entry })
      const newestMs = current.newest_at ? Date.parse(current.newest_at) : null
      return {
        commit: git.commit,
        git_source: git.source,
        dirty: git.dirty,
        started_at: new Date(startedAt).toISOString(),
        uptime_ms: Math.max(0, currentNow - startedAt),
        source_files: current.files,
        newest_source_at: current.newest_at,
        stale: current.revision !== boot.revision,
        revision: `${git.commit || 'nogit'}:${current.revision}`,
      }
    },
  }
}
