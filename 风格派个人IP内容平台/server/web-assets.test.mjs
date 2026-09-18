import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { draftLengthTargets, draftVideoFormats } from './draft-writing.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('访谈保存等待响应并恢复账号进度，失败保留输入', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  const onboarding = source.slice(source.indexOf('function Onboarding('), source.indexOf('type PositioningCandidate'))
  assert.match(onboarding, /useEffect\(loadInterview, \[\]\)/)
  assert.match(onboarding, /interview_step: leave \? round/)
  assert.match(onboarding, /await apiJson[\s\S]*setDirty\(false\); setAnswers/)
  assert.match(onboarding, /保存失败，输入已保留/)
  assert.match(onboarding, /savingRef\.current = true/)
  assert.doesNotMatch(onboarding, /setMonetizationGoal\(''\)/)
  assert.match(onboarding, /beforeunload/)
})

test('草稿覆盖动作受脏状态保护，保存失败不清除脏状态', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  for (const name of ['runDraftCheck', 'restoreDraft', 'deaiDraft', 'applySlot']) {
    const start = source.indexOf(`const ${name} =`)
    assert.ok(start > 0)
    assert.match(source.slice(start, source.indexOf('\n', start)), /draftActionBlocked\(draft\)/)
  }
  assert.match(source, /draftLeaveGuard\.current\(\)/)
  assert.match(source, /draft-title-input" disabled=\{busy\}/)
  assert.match(source, /保存失败，输入已保留，请重试/)
})

test('工作台使用通用空白账号文案并保留 IP 档案能力', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  assert.match(source, /我的内容工作台/)
  assert.match(source, /我的账号/)
  assert.match(source, /还没有选题/)
  assert.doesNotMatch(source, /早上好，小姚哥/)
  assert.doesNotMatch(source, /消费降级之后/)
  assert.match(source, /已确认基础档案/)
  assert.match(source, /待审核变更/)
  assert.match(source, /reviews\.filter\(item => item\.status === 'pending'\)/)
  assert.match(source, /profile-edit-button/)
  assert.match(source, /saveField\(field\)/)
  assert.match(source, /查看最近修改/)
  assert.match(source, /修改后立即用于内容生成/)
})

test('档案列表字段提示短词并与质量门 12 字口径一致', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  assert.match(source, /const profileEntryMaxLength = 12/)
  assert.match(source, /建议每项 2-8 字短词/)
  assert.match(source, /按短词匹配的正文检查、话题标签与选题评分都会失效/)
  const checks = readFileSync(join(root, 'server/draft-checks.mjs'), 'utf8')
  assert.match(checks, /value\.length > 12/)
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

test('首次登录会检查账号引导状态，稍后填写后不重复自动出现', () => {
  const source = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  assert.match(source, /const checkFirstUse/)
  assert.match(source, /onboarding_seen_at/)
  assert.match(source, /稍后填写/)
  assert.match(source, /04 \/ YOUR GOAL/)
  assert.doesNotMatch(source, /05 \/ YOUR ANGLE/)
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

test('今日工作台单步路由卡片：新手教程、三条降级路径、点定位进访谈而不是内容创作', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  assert.match(source, /function NextStepCard/)
  assert.match(source, /guide\.mode/)
  assert.match(source, /guide\.degraded\.missing\.join\('、'\)/)
  assert.match(source, /看全部环节/)
  assert.match(source, /positioning: '定位发现'/)
  assert.match(source, /shooting: '今日拍摄'/)
  assert.match(source, /nav === '定位发现'/)
  assert.match(source, /setShowOnboarding\(true\)/)
  assert.match(source, /nav === '今日拍摄'/)
  assert.match(source, /setShowShooting\(true\)/)
  assert.match(source, /path => <li key=\{path\.id\}/)
})

test('爆款方法库按四类方法组织并保留结构 API', () => {
  const source = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  assert.match(source, /'选题方法', '标题方法', '开头方法', '内容结构'/)
  assert.match(source, /method_category/)
  assert.match(source, /爆款方法库/)
  assert.match(source, /structure-group/)
  assert.match(source, /calendar-more/)
  assert.doesNotMatch(source, /爆款结构库/)
  const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
  assert.match(styles, /\.structure-group\s*\{/)
  assert.match(styles, /\.calendar-more\s*\{/)
})

test('发布能力并入内容创作，侧栏不再单独列出发布中心', () => {
  const source = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  assert.match(source, /function DraftPublishPanel/)
  assert.match(source, /\/api\/drafts\/\$\{draft\.id\}\/adapt/)
  assert.match(source, /多平台发布/)
  assert.doesNotMatch(source, /label: '发布中心'/)
  assert.doesNotMatch(source, /function PublishCenter/)
})

test('选题评估与决策入口用主按钮，关键动作不被当成正文', () => {
  const source = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  assert.match(source, /<button className="primary-action" disabled=\{busy\} onClick=\{\(\) => evaluateTopicItem\(topic\)\}>七维评估<\/button>/)
  // 「确认做」在把关拦停时必须不可点，并直接显示「不建议做」：这是内容层唯一允许拦停的位置。
  assert.match(source, /<button className="primary-action" disabled=\{busy \|\| evaluation\.blocked\} onClick=\{\(\) => decideTopic\(topic, 'do'\)\}>\{evaluation\.blocked \? '不建议做' : '确认做'\}<\/button>/)
  assert.match(source, /<button className="primary-action" disabled=\{busy\} onClick=\{\(\) => openComposeFor\(topic\)\}>查看这组草稿<\/button>/)
  assert.match(source, /topic_id: topic\.id/)
  assert.match(source, /选题已确认，但草稿生成失败/)
  assert.match(source, /请等当前选题操作完成后再点/)
  const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
  assert.match(styles, /\.topic-actions \.primary-action\s*\{/)
})

test('草稿生成入口收敛到已确认选题，不再从面板手打标题', () => {
  const source = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  // 面板只提供已确认选题，且 POST 携带 topic_id
  assert.match(source, /apiJson<TopicItem\[\]>\('\/api\/topics'\)\.then\(items => setTopics\(items\.filter\(item => item\.workflow_status === 'approved'\)\)\)/)
  assert.match(source, /topic_id: Number\(topicId\)/)
  assert.match(source, /liveWorkbenchDrafts/)
  assert.match(source, /先选一条已确认的选题/)
  assert.doesNotMatch(source, /anchorTitle/)
  // 选题助手与爆款方法库都改为带参数跳转，不再各自直接生成
  assert.doesNotMatch(source, /generateDrafts/)
  assert.match(source, /const openComposeFor = \(topic: TopicItem\) => \{ setComposePreset\(\{ topicId: topic\.id, structureId: null \}\); onNavigate\('内容创作'\) \}/)
  assert.match(source, /const useStructure = \(structure: StructureItem\) => \{ setComposePreset\(\{ topicId: null, structureId: structure\.id \}\); onNavigate\('内容创作'\) \}/)
  // 生成成功后定位并高亮新草稿
  assert.match(source, /const \[freshDraftIds, setFreshDraftIds\] = useState<number\[\]>\(\[\]\)/)
  assert.match(source, /draftGridRef\.current\?\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/)
  assert.match(source, /freshDraftIds\.includes\(draft\.id\) \? 'trend-card draft-card draft-row-focused' : 'trend-card draft-card'/)
  // 生成期间有明确反馈，不再静默
  assert.match(source, /生成中\.\.\.（约 30 秒）/)
  const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
  assert.match(styles, /\.primary-action:disabled\s*\{/)
  assert.match(styles, /\.draft-row-focused\s*\{/)
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
  // 对标素材必须看得出出处，并且能直接读到正文
  assert.match(source, /const materialSourceLabel = \(item: MaterialItem\)/)
  assert.match(source, /const materialPatternTag = \(item: MaterialItem\)/)
  assert.match(source, /const materialGroupKey = \(item: MaterialItem\)/)
  assert.match(source, /来源：\{group\.source\} · 对标素材，不是他的话，别直接抄/)
  assert.match(source, /className="material-group"/)
  assert.match(source, /className="material-text" title=\{item\.content\}/)
  assert.match(source, /className="pattern-tag"/)
  const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
  assert.match(styles, /-webkit-line-clamp: 2/)
  assert.match(styles, /\.material-group\s*>\s*summary\s*\{/)
  assert.match(styles, /\.kind-tag\s*\{/)
  assert.match(styles, /\.compose-panel\s*\{/)
  assert.match(styles, /\.atom-mini-form\s*\{/)
})

test('草稿列表的字数警告用同一套平台目标（前后端不漂移）', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  assert.match(source, /const draftLengthWarning = \(draft: DraftItem\)/)
  assert.match(source, /'draft-rail-count warn' : 'draft-rail-count'/)
  assert.match(source, /title=\{draftLengthWarning\(item\) \|\| undefined\}/)
  assert.match(source, /aria-label="修改意见"/)
  assert.match(source, /\/api\/drafts\/\$\{draft.id\}\/revise/)
  assert.match(source, /只重写这一条/)
  assert.match(source, /draft-body-meta/)
  assert.match(source, /draft-revise-head/)
  assert.match(source, /图文笔记/)
  assert.match(source, /短视频口播/)
  assert.match(source, /draft-format/)
  assert.match(source, /aria-label="视频体裁"/)
  assert.match(source, /按检查意见改写/)
  assert.match(source, /from_checks/)
  assert.match(source, /needs_revision: '要改'/)
  assert.match(source, /draftWorkflowLabel/)
  assert.match(source, /draftHasRewriteableChecks/)
  assert.match(source, /请先保存当前草稿，再按检查意见改写/)
  assert.match(source, /正文已经改过，先重新做人设检查和质量门/)
  assert.match(source, /draft-checks-error/)
  assert.match(source, /后台还是旧版本，关掉窗口重新打开后再试/)
  assert.doesNotMatch(source, /<small>\{draft\.workflow_status \|\| 'draft'\}<\/small>/)
  assert.doesNotMatch(source, /disabled=\{busy \|\| reviseBusy === draft.id \|\| !\(\(draft.checks/)
  assert.match(source, /中视频提纲/)
  assert.match(source, /长视频大纲/)
  // 客户端必须与服务端 draftLengthTargets 数字一致，否则「N 字」的告警会和质量门说法不一
  for (const [platform, target] of Object.entries(draftLengthTargets)) {
    const literal = `${platform}: { min: ${target.min}, max: ${target.max} }`
    assert.ok(source.includes(literal), `客户端缺少平台目标：${literal}`)
  }
  for (const [format, plan] of Object.entries(draftVideoFormats)) {
    const literal = `${format}: { min: ${plan.length.min}, max: ${plan.length.max} }`
    assert.ok(source.includes(literal), `客户端缺少视频体裁目标：${literal}`)
  }
  const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
  assert.match(styles, /\.draft-rail-count\.warn\s*\{/)
  assert.match(styles, /\.draft-body-meta\.warn/)
  assert.match(styles, /\.draft-revise-head\s*\{/)
  assert.match(styles, /\.draft-formats\s*\{/)
  assert.match(styles, /\.draft-checks-error\s*\{/)
})

test('上传入口不把二进制文件当纯文本读', () => {
  // 浏览器 readAsText 送 PDF/DOCX 只会得到乱码，客户端给提示、服务端再拦一道。
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  assert.ok(source.includes('if (/\\.(pdf|docx?|xlsx?|pptx?)$/i.test(file.name))'), '上传前必须拦下二进制文档')
  assert.ok(source.includes('PDF 和 Office 文件需要先另存为 .txt 或 .md 再上传'))
})

test('AI 记忆层前端特征', () => {
  const source = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
  assert.match(source, /function MemoryPanel/)
  assert.match(source, /memoryTypeLabels/)
  assert.match(source, /\/api\/memories/)
  assert.match(source, /从对话自动提炼/)
  assert.match(source, /这条记忆已存在/)
  // 对标机制是独立类型，必须带来源，不能混成他的表达习惯
  assert.match(source, /benchmark: '对标机制'/)
  assert.match(source, /对标机制要写清来源（例如「对标dbs」）/)
  assert.match(source, /来源：\$\{item\.source_label \|\| '对标账号'\}/)
  assert.match(source, /写作依据/)
  const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
  assert.match(styles, /\.memory-item\s*\{/)
  assert.match(styles, /\.memory-type-tag\s*\{/)
})
