import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('工作台展示小姚哥 IP 身份而不是示例创作者', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  assert.match(source, /小姚哥/)
  assert.match(source, /创业过来人/)
  assert.match(source, /钱漏在哪，人卡在哪/)
  assert.doesNotMatch(source, /林默/)

  const data = JSON.parse(readFileSync(join(root, 'server/data.json'), 'utf8'))
  assert.equal(data.profile.role, '小姚哥｜创业过来人')
  assert.equal(data.positioning.positioning_statement, '帮本地生意老板诊断：钱漏在哪，人卡在哪。')
  assert.ok(data.profile.audiences.includes('本地生意老板'))
  assert.match(source, /已确认基础档案/)
  assert.match(source, /待审核变更/)
  assert.match(source, /reviews\.filter\(item => item\.status === 'pending'\)/)
  assert.match(source, /profile-edit-button/)
  assert.match(source, /saveField\(field\)/)
  assert.match(source, /查看最近修改/)
  assert.match(source, /修改后立即用于内容生成/)
})

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
  assert.match(source, /\/api\/redfox-settings/)
  assert.match(source, /https:\/\/redfox\.hk/)
  assert.doesNotMatch(source, /x-redfox-base-url|x-redfox-api-key/)
})

test('apiJson 合并调用方请求头且不再传输浏览器 LLM 密钥', () => {
  const source = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  assert.match(source, /headers: \{ 'content-type': 'application\/json', \.\.\.\(extraHeaders/)
  assert.doesNotMatch(source, /function llmHeaders/)
  assert.match(source, /确认迁移到账号/)
  assert.match(source, /大模型 API 3（视觉）/)
})

test('热点研究集成红狐 Skill 目录、热搜榜、对标与合规检查', () => {
  const source = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  assert.match(source, /红狐 Skill 目录/)
  assert.match(source, /dingweipai:skill-toggles/)
  assert.match(source, /\/api\/research\/search/)
  assert.match(source, /\/api\/research\/keyword-hot-search/)
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
  assert.match(source, /搜索选题、草稿、素材、方法/)
  assert.match(source, /apiJson<ResearchItem\[\]>\('\/api\/research'\)/)
  assert.match(source, /apiJson<DraftItem\[\]>\('\/api\/drafts'\)/)
  assert.match(source, /apiJson<MaterialItem\[\]>\('\/api\/materials'\)/)
  assert.match(source, /target: '爆款方法库'/)
  const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
  assert.match(styles, /\.global-search\s*\{/)
  assert.match(styles, /\.search-menu\s*\{/)
})

test('首页研究使用真实数据并可定位热点研究详情', () => {
  const source = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  assert.match(source, /function ResearchPulse/)
  assert.match(source, /apiJson<ResearchListResponse>\('\/api\/research\?sort=latest'\)/)
  assert.match(source, /onOpen\(item\.id\)/)
  assert.match(source, /focusedResearchId/)
  assert.match(source, /scrollIntoView/)
  assert.match(source, /activeNav === '今日工作台' \? <>/)
})

test('爆款方法库按四类方法组织并保留结构 API', () => {
  const source = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  assert.match(source, /'选题方法', '标题方法', '开头方法', '内容结构'/)
  assert.match(source, /method_category/)
  assert.match(source, /爆款方法库/)
  assert.doesNotMatch(source, /爆款结构库/)
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
