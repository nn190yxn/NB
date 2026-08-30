import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('PWA manifest 声明可安装图标', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'public/manifest.webmanifest'), 'utf8'))
  assert.equal(manifest.display, 'standalone')
  assert.deepEqual(manifest.icons.map(icon => icon.src), ['/icon-192.svg', '/icon-512.svg'])
  for (const icon of manifest.icons) assert.ok(readFileSync(join(root, 'public', icon.src.slice(1))))
})

test('Service Worker 缓存应用壳并绕过 API 请求', () => {
  const serviceWorker = readFileSync(join(root, 'public/sw.js'), 'utf8')
  assert.match(serviceWorker, /caches\.open\(CACHE_NAME\)/)
  assert.match(serviceWorker, /pathname\.startsWith\('\/api\/'\)/)
  assert.match(serviceWorker, /caches\.match\('\/'\)/)
})

test('样式包含键盘焦点和减少动态效果规则', () => {
  const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
  assert.match(styles, /:focus-visible\s*\{/)
  assert.match(styles, /prefers-reduced-motion:\s*reduce/)
  assert.match(styles, /scroll-behavior:\s*auto/)
})

test('前端包含离线同步和冲突恢复入口', () => {
  const source = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  assert.match(source, /flushSyncQueue/)
  assert.match(source, /api\/sync\/conflicts/)
  assert.match(source, /restoreDraft/)
})

test('登录失败时保留引导页，成功后才进入工作台', () => {
  const source = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  assert.match(source, /apiJson\('\/api\/auth\/session', \{ method: 'POST' \}\)\.then\(\(\) => \{ setAuthState\('ok'\); setShowOnboarding\(false\) \}\)/)
  assert.doesNotMatch(source, /apiJson\('\/api\/auth\/session', \{ method: 'POST' \}\)\.finally\(\(\) => setShowOnboarding\(false\)\)/)
})

test('工作台设置按钮打开设置面板且面板含 API 中心', () => {
  const source = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  assert.match(source, /onClick=\{\(\) => setShowSettings\(true\)\}/)
  assert.match(source, /dingweipai:api-settings/)
  assert.match(source, /API 中心/)
  assert.match(source, /\/api\/settings\/test/)
  assert.match(source, /x-redfox-base-url/)
})

test('apiJson 合并请求头而不是整体覆盖', () => {
  const source = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  assert.match(source, /headers: \{ 'content-type': 'application\/json', \.\.\.\(extraHeaders \|\| \{\}\) \}/)
})

test('热点研究集成红狐 Skill 目录、热搜榜、对标与合规检查', () => {
  const source = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  assert.match(source, /红狐 Skill 目录/)
  assert.match(source, /dingweipai:skill-toggles/)
  assert.match(source, /\/api\/research\/search/)
  assert.match(source, /\/api\/research\/suggest/)
  assert.match(source, /\/api\/research\/hot-search/)
  assert.match(source, /\/api\/research\/similar/)
  assert.match(source, /\/api\/drafts\/\$\{draft\.id\}\/compliance/)
  assert.match(source, /热搜榜/)
  assert.match(source, /相似账号对标/)
  assert.match(source, /合规检查/)
})

test('顶栏全局搜索跨模块检索四类内容', () => {
  const source = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  assert.match(source, /function GlobalSearch/)
  assert.match(source, /搜索选题、草稿、素材、结构/)
  assert.match(source, /apiJson<ResearchItem\[\]>\('\/api\/research'\)/)
  assert.match(source, /apiJson<DraftItem\[\]>\('\/api\/drafts'\)/)
  assert.match(source, /apiJson<MaterialItem\[\]>\('\/api\/materials'\)/)
  assert.match(source, /target: '爆款结构库'/)
  const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
  assert.match(styles, /\.global-search\s*\{/)
  assert.match(styles, /\.search-menu\s*\{/)
})

test('素材库原子化与组合生成前端特征', () => {
  const source = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  assert.match(source, /materialKindLabels/)
  assert.match(source, /\/api\/materials\/atoms/)
  assert.match(source, /收为素材/)
  assert.match(source, /已收录/)
  assert.match(source, /kind_counts=1/)
  assert.match(source, /function ComposePanel/)
  assert.match(source, /组合生成/)
  assert.match(source, /quote_ids: quoteIds, experience_ids: experienceIds/)
  const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
  assert.match(styles, /\.kind-tag\s*\{/)
  assert.match(styles, /\.compose-panel\s*\{/)
  assert.match(styles, /\.atom-mini-form\s*\{/)
})

test('AI 记忆层前端特征', () => {
  const source = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  assert.match(source, /function MemoryPanel/)
  assert.match(source, /memoryTypeLabels/)
  assert.match(source, /\/api\/memories/)
  assert.match(source, /从对话自动提炼/)
  assert.match(source, /这条记忆已存在/)
  const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
  assert.match(styles, /\.memory-item\s*\{/)
  assert.match(styles, /\.memory-type-tag\s*\{/)
})
