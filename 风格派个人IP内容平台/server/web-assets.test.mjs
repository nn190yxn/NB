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
  // 取「整个函数体」而不是「声明那一行」：2026-09-20 把 runDraftCheck 改成多行后，
  // 保护语句落到了第二行，只切第一行的写法会把正确的实现判成红的（测试的切法问题，不是实现问题）。
  // 函数体的边界取「下一个同缩进的 const 声明」——组件里只有顶层声明是两格缩进。
  for (const name of ['runDraftCheck', 'restoreDraft', 'deaiDraft', 'spokenDraft', 'applySlot']) {
    const start = source.indexOf(`const ${name} =`)
    assert.ok(start > 0)
    const nextDeclaration = source.indexOf('\n  const ', start + 1)
    const body = source.slice(start, nextDeclaration === -1 ? start + 800 : nextDeclaration)
    assert.match(body, /draftActionBlocked\(draft\)/, `${name} 必须受脏状态保护：有未保存修改时不许覆盖草稿`)
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
  // 甲方实机看到的旧界面就是被「缓存优先」喂出来的：改了、刷了，还是上一份。
  assert.equal(/caches\.match\(event\.request\)\.then\(cached => \{\s*const network/.test(serviceWorker), false, '静态资源不许再回到「先给缓存、后台才更新」')
  assert.match(serviceWorker, /fetch\(event\.request\)\.then\(response => \{[\s\S]{0,240}\}\)\.catch\(\(\) => caches\.match\(event\.request\)/, '静态资源要网络优先、断网才回缓存')
})

test('开发环境不注册离线缓存，还要把旧的清掉', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  assert.match(source, /import\.meta\.env\.PROD\) void navigator\.serviceWorker\.register\('\/sw\.js'\)/, '开发环境也在注册离线缓存，会喂旧文件')
  assert.match(source, /registration\.unregister\(\)/, '开发环境要把之前装的 service worker 注销')
  assert.match(source, /caches\.delete\(key\)/, '注销后还要清掉旧缓存，不然刷新还是旧的')
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
  // 角色约定：评估只给建议，不发许可。「确认做」不再被 blocked 禁用，文案也不再变成「不建议做」。
  assert.match(source, /<button className="primary-action" disabled=\{busy\} onClick=\{\(\) => decideTopic\(topic, 'do'\)\}>确认做<\/button>/)
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
  // 断线本身曾经被锁成正确：生成请求必须带按角色选中的 material_ids，否则简报永远是空的。
  assert.match(source, /material_ids: materialIds, quote_ids: quoteIds, experience_ids: experienceIds/)
  assert.match(source, /\/api\/materials\?by_role=1/)
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
  assert.match(source, /改成口播/)
  assert.match(source, /当前是文字稿/)
  assert.match(source, /对照文字稿/)
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

// 三步之间要能带得进、带得走：输入能从已有内容选，产出能标出来源，切页面不丢上下文。
test('拆概念与提主张能直接选素材、产出记来源，形式判断判完存到选题上', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  // 输入能从素材库选，不用再从素材库复制、切页面、粘贴。
  assert.match(source, /function useMaterialLibrary\(\)/)
  assert.match(source, /function SourceMaterialSelect\(/)
  assert.match(source, /label="从素材库选一条来拆"/)
  assert.match(source, /label="从素材库选一条来提炼"/)
  // 提主张选中素材直接把正文填进输入框。
  assert.match(source, /setText\(item && item\.content \? String\(item\.content\) : ''\)/)
  // 产出记来源：两个面板确认入库时都带上 source_id，服务端据此记血缘。
  assert.equal(source.match(/\.\.\.\(source \? \{ source_id: source\.id \} : \{\}\)/g)?.length, 2)
  // 形式判断能从选题选，并把判完的形式与理由存到那条选题上。
  assert.match(source, /aria-label="从选题里选一条"/)
  assert.match(source, /topic_id: Number\(topicId\)/)
  assert.match(source, /saved_topic_id/)
})

test('生成草稿时把形式带过去，三个加工面板切页面不卸载', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  // 判了就按它写，不能等稿子出来再点重写返工。
  assert.match(source, /\.\.\.\(contentFormat \? \{ content_format: contentFormat \} : \{\}\)/)
  assert.match(source, /按平台默认形式（覆盖选题上判的结果）/)
  assert.match(source, /按平台默认形式（可在「形式判断」里先定）/)
  assert.match(source, /videoFormatOptions\.map\(format =>/)
  // 切页面只隐藏、不卸载：输入和提案都是手打的，不能切一次丢一次。
  assert.match(source, /if \(section === '拆概念' \|\| section === '提主张' \|\| section === '形式判断'\) return <>/)
  assert.match(source, /display: section === '拆概念' \? undefined : 'none'/)
  const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
  assert.match(styles, /\.deconstruct-input select\s*\{/)
  assert.match(styles, /\.deconstruct-source-chips\s*\{/)
})

// 多行框曾漏写宽度、内边距、边框、背景，退回浏览器默认的 20 字符宽，看着像坏掉。
test('拆概念/提主张/形式判断是左输入右结果，多行框样式完整', () => {
  const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
  const textareaRule = styles.slice(styles.indexOf('.deconstruct-input textarea {'), styles.indexOf('}', styles.indexOf('.deconstruct-input textarea {')))
  for (const declaration of ['width: 100%', 'min-height:', 'padding:', 'border: 1px solid var(--line)', 'border-radius:', 'background:', 'font: inherit']) {
    assert.ok(textareaRule.includes(declaration), `${declaration} 缺失时多行框会退回浏览器默认尺寸`)
  }
  assert.match(styles, /\.workspace-split \{[^}]*grid-template-columns/)
  assert.match(styles, /@media \(max-width: 1100px\) \{ \.workspace-split \{ display: block;/)
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  // 三个面板各一份：输入栏 + 结果栏 + 跟着输入走的按钮行。
  assert.equal(source.match(/<div className="workspace-split">/g)?.length, 3)
  assert.equal(source.match(/<div className="workspace-pane">/g)?.length, 6)
  assert.equal(source.match(/className="workspace-pane-actions"/g)?.length, 3)
  // 按钮不再留在标题行右上角，否则会隔一个页宽才对得上它作用的输入框。
  for (const kicker of ['WORKSPACE / 拆概念', 'WORKSPACE / 提主张', 'WORKSPACE / 形式判断']) {
    const start = source.indexOf(kicker)
    assert.ok(start > 0, `${kicker} 找不到`)
    const headEnd = source.indexOf('\n', start)
    assert.doesNotMatch(source.slice(start, headEnd), /<button/)
    // 标题行后面必须紧跟报错提示：改结构时很容易连它一起删掉，面板就把错误吞了。
    assert.match(source.slice(headEnd, headEnd + 220), /\{error && <p className="structure-error"/, `${kicker} 后面的报错提示丢了`)
  }
})

// 后台不热重载这件事，之前只能靠人记住（结果就是白测一整天旧代码）。
// 界面上那一小块角标是唯一的提醒，删掉它就等于把这条教训丢了。
// 角度必须排在「提主张」按钮之前：放在结果区等于第一次运行被默认那对角度悄悄决定（实机走查时发现的）。
// datalist 的 id 也要各面板自己带：跨面板共用一个 id，素材库单独打开时就选不到建议词。
test('提主张的角度要在点按钮之前就能选，两个面板各自带自己的建议词表', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  const claims = source.slice(source.indexOf('function ClaimsPanel'), source.indexOf('function FormPanel'))
  const pairAt = claims.indexOf('angle-pair')
  const extractAt = claims.indexOf('onClick={extract}')
  assert.ok(pairAt > 0 && extractAt > 0 && pairAt < extractAt, '角度选择器必须出现在「提主张」按钮之前')

  const workspace = source.slice(source.indexOf('function MaterialWorkspace'), source.indexOf('function ProfileReviewPanel'))
  assert.match(workspace, /list="material-angle-options"[\s\S]{0,260}<datalist id="material-angle-options"/, '素材编辑的 datalist 要自己带，不能蹭别的面板的')
  assert.equal(/id="angle-suggestions"/.test(source), false, '旧的共用 id 已失效，不该再出现')
})

test('顶栏要显示后台版本，并且代码变旧时红字说出来', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  assert.match(source, /function BuildStatus/, '版本角标组件没了')
  assert.match(source, /\/api\/version/, '角标不再读后台版本')
  assert.match(source, /info\.stale/, '没有「磁盘代码比进程新」的判定分支')
  assert.match(source, /后台是旧代码/, '陈旧时要直说要重启，不能只显示一个版本号')
  assert.match(source, /<BuildStatus \/>/, '组件没挂到顶栏上')

  const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
  assert.match(styles, /\.build-chip\.stale\s*\{[^}]*var\(--coral\)/, '陈旧提示要用醒目色，不能和普通角标长一个样')
})

// 选题的角度与主观点：后端有 PUT /api/topics/:id/stance 还不够——对一个不写代码的人，
// 没有按钮就等于没有这个功能。这条锁住界面上的入口，别让下一次重构又把它默默删掉。
test('选题卡片要能定角度和主观点，素材编辑要能改角度和认知角色', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  assert.match(source, /function TopicStance\(/, '选题上的角度/主观点编辑器没了')
  assert.match(source, /\/api\/topics\/\$\{topic\.id\}\/stance/, '保存没接到 stance 路由')
  assert.match(source, /<TopicStance topic=\{topic\}/, '编辑器没挂到选题卡片上')
  // 主观点只能选素材库里的「主张」，不给自由文本：否则观点和素材库会变成两套。
  assert.match(source, /\/api\/materials\?by_role=1/, '主观点下拉不再从素材库取主张')
  assert.match(source, /不定（模型只按标题写）/, '不选主观点时要如实说后果')

  assert.match(source, /aria-label="素材角度"/, '素材编辑表单里的角度输入没了')
  assert.match(source, /aria-label="素材认知角色"/, '素材编辑表单里的认知角色选择没了')
  assert.match(source, /angle: editing\.angle \?\? ''/, '保存时没把角度发出去')
  // 实机走查抓到：查完逻辑断点出来了、角标还停在「没查逻辑」，因为并回列表时漏了 logic_state。
  assert.match(source, /logic_state: result\.logic_state \|\| result\.material\.logic_state \|\| result\.status/, '判定角标没跟着结果更新')
  assert.match(source, /unit_type: editing\.unit_type\?\.trim\(\) \? editing\.unit_type : null/, '保存时没把认知角色发出去')

  const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
  assert.match(styles, /\.topic-stance-form \{/)
})

// 沙箱界面走查抓到：老选题存下来的评估里没有 first_step 字段，卡片就把「先做这一步：undefined」
// 直接摆在了用户眼前。评估是历史快照不重算，所以界面必须认缺字段。
test('选题卡片的「先做这一步」不许把缺字段渲染成 undefined', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  assert.equal(/先做这一步：\$\{evaluation\.first_step\}/.test(source), false, '又变回直接插值了，缺字段就会显示 undefined')
  assert.match(source, /evaluation\.first_step \|\| evaluation\.suggestions\?\.\[0\]/, 'first_step 缺失时没有退到建议第一条')
  assert.match(source, /这一版评估没留下「先做什么」/, '什么可说的都没有时，要如实说没有，而不是空着让人以为坏了')
})

// 沙箱走查实测：后台没起来的那几秒，界面把 502 当成「没登录」，直接显示登录页。
// 数据一个字没丢，但看起来像账号没了——对不写代码的用户这是最恐慌的一种错。
test('后台没应答要说「后台没应答」，不许把人赶去登录', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  assert.match(source, /'checking' \| 'ok' \| 'need-password' \| 'backend-down'/, '会话状态里少了「后台没应答」这一档')
  assert.match(source, /status === undefined \|\| status >= 500/, '没有按「网络不通 / 后台没回话」分类失败')
  assert.match(source, /className="backend-down"/, '没有对应的那块提示界面')
  assert.match(source, /一个字没丢/, '提示里要直接回答用户最怕的那句：数据还在不在')
  assert.match(source, /window\.setInterval\(probeSession, 3000\)/, '说了「每 3 秒再问一次」就得真的重复问，不能只问一次')
})

// 闭环最后一段（回填发布数据）以前只有「截图给视觉模型认」一条路：
// 没配视觉模型就填不了数，preferences 永远是 0 也是这么来的。手填入口必须在界面上。
test('拍摄台要能手填发布数据，不只靠截图识别', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  assert.match(source, /function ManualSnapshotForm\(/, '手填表单组件没了')
  assert.match(source, /'\/api\/performance-snapshots'/, '手填不再打到快照接口')
  assert.match(source, /shooting_id: shooting\.id/, '手填没关联到这次拍摄条目')
  assert.match(source, /手填数据/, '拍摄台上没有手填入口')
  assert.match(source, /至少填一个数/, '全空也提交会产出没指标的空快照，得有提示')
  const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
  assert.match(styles, /\.manual-snapshot \{/)
})

// Requirement 17 的「候选要用户确认才生效」以前只有接口：界面上没入口，
// 确认过的数据回流不到下一次创作，等于这一段没做完。
test('回流候选要在界面上看得见、点得动，确认才生效', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  assert.match(source, /function PreferenceFlowPanel\(/, '回流候选面板没了')
  assert.match(source, /\/api\/preferences\/data-flow/, '没有「按现在的数据找规律」的入口')
  assert.match(source, /\/api\/preferences\/\$\{id\}\/\$\{action\}/, '确认 / 不用没接到后端')
  assert.match(source, /<PreferenceFlowPanel refreshKey=\{snapshotRefresh\} \/>/, '面板没挂到拍摄台的表现时间线后面')
  assert.match(source, /至少要有两条「已确认」的表现记录/, '找不出规律时要说清缺什么，不能只回一句空')
})

// M2 实跑里「某个角度提不出不同说法」是会发生的真事（模型确实给空）。
// 这时必须把它说出来，而不是悄悄交出一份没有反方的稿子。
test('某个角度没提出不同说法时，主张面板要明说', () => {  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  const claims = source.slice(source.indexOf('function ClaimsPanel'), source.indexOf('function FormPanel'))
  assert.match(claims, /className="claim-gap"/, '角度空手而归的提示没了')
  assert.match(claims, /这个角度没提出不同说法/, '提示没说人话')
  assert.match(claims, /item\.angle === angle/, '提示是按「这个角度真的一条都没有」判的')
})

// 甲方实机反馈：档案里勾了 4 个平台，界面上却只找得到抖音和视频号，长文版根本出不来。
// 后端 /adapt 一直支持全部研究平台，缺的只是入口。
test('发布面板的适配目标要覆盖档案里那 4 个平台', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  const panel = source.slice(source.indexOf('function DraftPublishPanel'), source.indexOf('function VisionConfirmationCard'))
  assert.match(panel, /const platforms = \['抖音', '视频号', '小红书', '公众号'\]/, '适配平台又被砍回两个，长文/笔记版没出口')
  assert.match(panel, /生成只出抖音、视频号两版/, '要写清为什么不一次生成四版（一次模型调用一版的钱），别让人以为漏了')
})

// 改写落库了但问题没减少，必须说一句；不然是把判断偷偷替用户做了。
test('改写落库后残留问题要说成一句状态，不是报错', () => {
  const source = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  assert.match(source, /revise_notice/, '没接住服务端给的「残留问题」提示')
  assert.match(source, /className="draft-checks-notice" role="status"/, '提示要用状态样式，不能长得像失败')
  const server = readFileSync(join(root, 'server/index.mjs'), 'utf8')
  assert.match(server, /不满意点「恢复」回到上一版/, '要说清可以回上一版——否决权留在人这边')
  const styles = readFileSync(join(root, 'src/styles.css'), 'utf8')
  assert.match(styles, /\.draft-checks-notice \{/)
})

