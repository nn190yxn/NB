import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  FileText,
  FolderOpen,
  LayoutDashboard,
  LayoutGrid,
  Library,
  List,
  Menu,
  MoreHorizontal,
  PenLine,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  Search,
  Send,
  Settings2,
  Sparkles,
  Star,
  SunMedium,
  Trash2,
  Video,
  X,
} from 'lucide-react'
import './styles.css'
import { copyText, loadTeleprompterSettings, saveTeleprompterSettings } from './shooting-utils'
import { flushSyncQueue, pendingSyncEvents } from './sync-queue'

type DesktopSyncRuntime = { device_id: string; device_name: string; directories: Array<{ id: string }>; queue_count: number; last_error: string | null }
type DesktopBridge = {
  login(password: string): Promise<boolean>
  refreshSession(): Promise<boolean>
  logout(): Promise<boolean>
  setLaunchAtLogin(enabled: boolean): Promise<boolean>
  selectSyncDirectory(): Promise<string | null>
  getSyncRuntime(): Promise<DesktopSyncRuntime>
  refreshSync(): Promise<DesktopSyncRuntime>
  scanSyncDirectory(id: string): Promise<{ ok: boolean; status: string; error?: string }>
  quit(): Promise<boolean>
}
declare global { interface Window { desktopApp?: DesktopBridge } }

type ThemeKey = 'warm' | 'editorial' | 'fresh' | 'midnight'

type FontKey = 'sans' | 'serif' | 'hand'

const themes: Record<ThemeKey, { name: string; subtitle: string; colors: string[] }> = {
  warm: { name: '暖纸朱橙', subtitle: '米白纸感 · 行动橙', colors: ['#f6f4ef', '#ffffff', '#e0521f'] },
  editorial: { name: '编辑部', subtitle: 'Primer 中性 · 内容证据', colors: ['#ffffff', '#f6f8fa', '#0969da'] },
  fresh: { name: '清泉青', subtitle: 'Radix 冷调 · 清泉薄荷', colors: ['#fbfcfc', '#f2f5f4', '#0d9488'] },
  midnight: { name: '午夜数据', subtitle: 'shadcn 深色 · 沉浸分析', colors: ['#0c0e12', '#15171c', '#4c9df0'] },
}

const fonts: Record<FontKey, { name: string; subtitle: string; sample: string }> = {
  sans: { name: '现代黑体', subtitle: '思源黑体 · 清晰干练', sample: 'Aa' },
  serif: { name: '编辑宋体', subtitle: '思源宋体 · 杂志质感', sample: '宋' },
  hand: { name: '霞鹜文楷', subtitle: '手写文楷 · 温暖亲切', sample: '楷' },
}

const fontFamilyOf = (key: FontKey): string => key === 'hand'
  ? "'LXGW WenKai', 'Noto Sans SC', 'PingFang SC', sans-serif"
  : key === 'serif'
    ? "'Noto Serif SC', 'Noto Sans SC', 'PingFang SC', serif"
    : "'Noto Sans SC', 'Inter', 'PingFang SC', sans-serif"

const navItems = [
  { label: '今日工作台', icon: LayoutDashboard },
  { label: '定位发现', icon: Sparkles },
  { label: '热点研究', icon: Radio },
  { label: '素材库', icon: FolderOpen },
  { label: '爆款方法库', icon: Library },
  { label: '选题助手', icon: BrainCircuit },
  { label: '内容创作', icon: PenLine },
  { label: '发布中心', icon: Send },
  { label: '内容日历', icon: CalendarDays },
]

function App() {
  const [theme, setThemeState] = useState<ThemeKey>(() => {
    const saved = window.localStorage.getItem('dingweipai:theme')
    return saved === 'warm' || saved === 'editorial' || saved === 'fresh' || saved === 'midnight' ? saved : 'warm'
  })
  const setTheme = (next: ThemeKey) => {
    setThemeState(next)
    try { window.localStorage.setItem('dingweipai:theme', next) } catch { /* storage unavailable */ }
  }
  const [font, setFont] = useState<FontKey>(() => {
    const saved = window.localStorage.getItem('dingweipai:font')
    return saved === 'sans' || saved === 'serif' || saved === 'hand' ? saved : 'serif'
  })
  const [showThemes, setShowThemes] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [activeNav, setActiveNav] = useState('今日工作台')
  const [focusedResearchId, setFocusedResearchId] = useState<number | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [authState, setAuthState] = useState<'checking' | 'ok' | 'need-password'>('checking')

  useEffect(() => {
    window.localStorage.setItem('dingweipai:font', font)
  }, [font])
  const [strategyRatios, setStrategyRatios] = useState([50, 30, 20])
  const [showReview, setShowReview] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showSyncManager, setShowSyncManager] = useState(false)
  const [strategyReady, setStrategyReady] = useState(false)
  const [strategySaving, setStrategySaving] = useState(false)
  const [showShooting, setShowShooting] = useState(false)
  const [shootingCount, setShootingCount] = useState(0)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [pendingSync, setPendingSync] = useState(() => pendingSyncEvents().length)
  const [syncing, setSyncing] = useState(false)
  const [conflicts, setConflicts] = useState<SyncConflict[]>([])

  const openResearch = (id?: number) => {
    setFocusedResearchId(id ?? null)
    setActiveNav('热点研究')
  }

  const logout = () => {
    void apiJson('/api/auth/session', { method: 'DELETE' }).finally(() => { void window.desktopApp?.logout()

      void apiJson('/api/auth/session')
        .then(() => setAuthState('ok'))
        .catch(() => { setAuthState('need-password'); setShowOnboarding(true) })
    })
  }

  const enterWorkspace = () => {
    void apiJson('/api/auth/session', { method: 'POST' }).then(() => { setAuthState('ok'); setShowOnboarding(false) }).catch(() => undefined)
  }

  useEffect(() => {
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js')
    void apiJson('/api/auth/session')
      .then(() => setAuthState('ok'))
      .catch(() => apiJson('/api/auth/session', { method: 'POST' }).then(() => setAuthState('ok')).catch(() => setAuthState('need-password')))
  }, [])

  const syncNow = () => {
    setSyncing(true)
    void flushSyncQueue().then(() => setPendingSync(pendingSyncEvents().length)).catch(() => undefined).finally(() => setSyncing(false))
  }

  const resolveConflict = (conflict: SyncConflict, resolution: 'local' | 'remote') => {
    void apiJson<{ conflict: SyncConflict }>(`/api/sync/conflicts/${conflict.id}`, { method: 'POST', body: JSON.stringify({ resolution }) }).then(result => setConflicts(current => current.filter(item => item.id !== result.conflict.id))).catch(() => undefined)
  }

  useEffect(() => {
    const markOnline = () => setOnline(true)
    const markOffline = () => setOnline(false)
    window.addEventListener('online', markOnline)
    window.addEventListener('offline', markOffline)
    return () => { window.removeEventListener('online', markOnline); window.removeEventListener('offline', markOffline) }
  }, [])

  useEffect(() => {
    apiJson<ShootingItem[]>('/api/shooting/today').then(items => setShootingCount(items.filter(item => item.status !== 'completed').length)).catch(() => undefined)
    apiJson<SyncConflict[]>('/api/sync/conflicts').then(setConflicts).catch(() => undefined)
  }, [])

  useEffect(() => {
    apiJson<{ layer_ratios: { reach: number; trust: number; conversion: number } }>('/api/content-strategy')
      .then(({ layer_ratios }) => setStrategyRatios([layer_ratios.reach, layer_ratios.trust, layer_ratios.conversion]))
      .catch(() => undefined)
      .finally(() => setStrategyReady(true))
  }, [])

  const saveStrategy = (nextRatios: number[]) => {
    setStrategyRatios(nextRatios)
    setStrategySaving(true)
    return apiJson('/api/content-strategy', { method: 'PUT', body: JSON.stringify({ layer_ratios: { reach: nextRatios[0], trust: nextRatios[1], conversion: nextRatios[2] } }) })
      .catch(() => undefined)
      .finally(() => setStrategySaving(false))
  }

  if (authState === 'need-password') {
    return <PasswordGate theme={theme} font={font} onSuccess={() => { setAuthState('ok'); setShowOnboarding(false) }} />
  }

  if (showOnboarding) {
    return     <Onboarding theme={theme} setTheme={setTheme} font={font} setFont={setFont} showThemes={showThemes} setShowThemes={setShowThemes} onEnter={enterWorkspace} onBack={() => setShowOnboarding(false)} />
  }

  return (
    <main className={`app theme-${theme} font-${font}`}>
       <aside className={showMobileMenu ? 'sidebar mobile-open' : 'sidebar'}>
        <div className="brand"><div className="brand-mark">定</div><div><strong>定位派</strong><span>个人 IP 内容成长平台</span></div></div>
        <button className="workspace-switch" onClick={() => setShowReview(true)}><span className="status-dot" /> 创业观察室 <ChevronDown size={14} /></button>
        <nav>
          <span className="nav-label">工作区</span>
          {navItems.map(({ label, icon: Icon }) => <button className={activeNav === label ? 'nav-item active' : 'nav-item'} onClick={() => label === '定位发现' ? setShowOnboarding(true) : label === '热点研究' ? openResearch() : setActiveNav(label)} key={label}><Icon size={17} /><span>{label}</span>{label === '热点研究' && <b>12</b>}</button>)}
          <span className="nav-label secondary">资产</span>
           <button className={showShooting ? 'nav-item active' : 'nav-item'} onClick={() => setShowShooting(true)}><Video size={17} /><span>今日拍摄</span><b className="count-soft">{shootingCount}</b></button>
           <button className={activeNav === 'IP 档案' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveNav('IP 档案')}><BookOpen size={17} /><span>IP 档案</span></button>
        </nav>
         <div className="sidebar-bottom"><button className="nav-item" onClick={() => setShowSyncManager(true)}><FolderOpen size={17} /><span>桌面同步</span>{pendingSync > 0 && <b>{pendingSync}</b>}</button><button className="nav-item" onClick={() => setShowSettings(true)}><Settings2 size={17} /><span>工作台设置</span></button><button className="user-chip" onClick={logout} title="退出当前会话"><div className="avatar">姚</div><div><strong>小姚哥</strong><span>创业过来人</span></div><MoreHorizontal size={16} /></button></div>
      </aside>

      <section className="content-shell">
         <header className="topbar"><button className="mobile-menu" aria-label="打开导航" onClick={() => setShowMobileMenu(!showMobileMenu)}><Menu size={20} /></button><div className="breadcrumbs"><span>创业观察室</span><span>/</span><strong>{activeNav}</strong></div><GlobalSearch onNavigate={setActiveNav} /><div className="top-actions"><button className="icon-button" aria-label="帮助" onClick={() => setShowOnboarding(true)}><CircleHelp size={18} /></button><div className="theme-picker"><button className="theme-trigger" onClick={() => setShowThemes(!showThemes)}><SunMedium size={16} /><span>{themes[theme].name}</span><ChevronDown size={14} /></button>{showThemes && <ThemeMenu theme={theme} setTheme={setTheme} close={() => setShowThemes(false)} font={font} setFont={setFont} />}</div><button className="avatar small" aria-label="用户菜单" onClick={() => setShowReview(true)}>姚</button></div></header>
           <div className="page-content">{(!online || pendingSync > 0) && <div className="offline-banner" role="status">{online ? `有 ${pendingSync} 个素材等待同步。` : '当前处于离线状态，已加载内容仍可查看。'} <button onClick={syncNow} disabled={!online || syncing}>{syncing ? '同步中...' : '立即同步'}</button></div>}{conflicts.length > 0 && <div className="conflict-banner" role="alert"><strong>{conflicts.length} 个内容版本发生冲突</strong>{conflicts.map(conflict => <span key={conflict.id}>{conflict.resource_type === 'draft' ? '草稿' : '拍摄清单'} #{conflict.resource_id}<button onClick={() => resolveConflict(conflict, 'local')}>保留本地</button><button onClick={() => resolveConflict(conflict, 'remote')}>保留远端</button></span>)}</div>}
            {showReview && <StrategyReview ratios={strategyRatios} onApply={() => { saveStrategy([40, 35, 25]); setShowReview(false) }} onClose={() => setShowReview(false)} />}
            {showSettings && <SettingsPanel theme={theme} setTheme={setTheme} font={font} setFont={setFont} onClose={() => setShowSettings(false)} />}
            {showSyncManager && <SyncManagementPanel onClose={() => setShowSyncManager(false)} onSync={syncNow} syncing={syncing} />}
            {showShooting && <ShootingWorkspace onClose={() => setShowShooting(false)} />}
            {activeNav === '今日工作台' ? <>
           <div className="page-heading"><div><p className="eyebrow">SATURDAY · AUG 29, 2026</p><h1>早上好，小姚哥<span className="accent">。</span></h1><p className="lede">今天继续帮老板看清：钱漏在哪，人卡在哪。</p></div><button className="primary-action" onClick={() => openResearch()}><Plus size={17} /> 新建研究</button></div>

          <div className="signal-strip"><div className="signal-icon"><Radio size={18} /></div><div><strong>今日信号</strong><span>消费降级之后，个人品牌正在进入“可信度竞争”</span></div><button onClick={() => openResearch()}>查看热点 <ArrowUpRight size={15} /></button></div>

           {strategyReady && <StrategyPanel ratios={strategyRatios} setRatios={saveStrategy} saving={strategySaving} onReview={() => setShowReview(true)} />}




          <ResearchPulse onOpen={openResearch} />




           <div className="lower-grid"><section><div className="section-heading compact"><div><span className="section-kicker">02 / READY TO MAKE</span><h2>准备出发的选题</h2></div><button className="text-action" onClick={() => setActiveNav('选题助手')}>打开选题助手 <ArrowUpRight size={15} /></button></div><div className="topic-list"><Topic number="01" title="别再迷信个人 IP：先把一件小事做成" meta="商业创业 · 观点型" accent="green" onOpen={() => setActiveNav('选题助手')} /><Topic number="02" title="从摆摊到连锁：一个普通人的复利路径" meta="真实故事 · 案例型" accent="amber" onOpen={() => setActiveNav('选题助手')} /><Topic number="03" title="创业第 3 年，我终于停止了这 5 件事" meta="个人经历 · 复盘型" accent="coral" onOpen={() => setActiveNav('选题助手')} /></div></section><aside className="shoot-card"><div className="card-top"><span className="section-kicker">TODAY / SHOOTING</span><Video size={17} /></div><h3>今天拍摄</h3><div className="shoot-date"><strong>{String(shootingCount).padStart(2, '0')}</strong><span>条内容<br /><small>待拍摄</small></span></div><div className="progress"><span style={{ width: shootingCount ? '25%' : '0%' }} /></div><p>当前清单 · {shootingCount} 条待拍</p><button className="outline-action" onClick={() => setShowShooting(true)}>进入拍摄清单 <ArrowUpRight size={15} /></button></aside></div>
          <footer className="footer-note"><span><span className="live-dot" /> 数据源已更新 · RedFox 研究库</span><span>最后同步于 09:42</span></footer>
          </> : <WorkspaceView section={activeNav as WorkspaceSection} onNavigate={setActiveNav} onOpenShooting={() => setShowShooting(true)} focusedResearchId={focusedResearchId} />}
        </div>
      </section>
    </main>
  )
}

const interviewRounds = [
  ['01 / YOUR STORY', '先从你的经历开始', '过去几年里，哪一件事你做得最久、最投入，或者最常被别人请教？'],
  ['02 / YOUR EDGE', '你比别人更顺手的事', '哪些事情你做起来特别自然，却发现别人经常觉得困难？'],
  ['03 / YOUR PEOPLE', '谁正在需要你', '什么样的人会主动来找你？他们通常在什么场景下遇到什么问题？'],
  ['04 / YOUR VALUE', '你能带来什么改变', '经过你的帮助，对方能完成一个什么看得见的改变？'],
  ['05 / YOUR ANGLE', '你的独特视角', '你有哪些经历、方法、审美或判断，是同行很难直接复制的？'],
  ['06 / YOUR PROOF', '什么证明你值得被相信', '你手上有哪些作品、案例、评价、数据或长期积累，可以证明前面的价值？'],
  ['07 / YOUR VOICE', '你愿意长期说什么', '即使没有人催促，你仍愿意持续分享哪些主题？你喜欢用什么方式表达？'],
  ['08 / YOUR GOAL', '你为什么要经营个人 IP', '明确你希望通过个人 IP 实现的变现方式，以及获客或其他核心目的。'],
] as const

const strategyLayers = [
  { label: '泛流量触达', task: '进入更大的兴趣流量池', color: 'green' },
  { label: '垂直信任', task: '让目标人群确认你的价值', color: 'amber' },
  { label: '核心目标转化', task: '推动获客、变现或其他目标', color: 'coral' },
]

type ApiErrorPayload = { error?: string; missing_fields?: string[] }
type ApiError = Error & { status: number; payload?: ApiErrorPayload }

async function apiJson<T>(path: string, options?: RequestInit): Promise<T> {
  const { headers: extraHeaders, ...rest } = options || {}
  const response = await fetch(path, { credentials: 'include', headers: { 'content-type': 'application/json', ...(extraHeaders || {}) }, ...rest })
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => undefined) as T | ApiErrorPayload | undefined
  if (!response.ok) {
    const error = new Error((payload as ApiErrorPayload | undefined)?.error || `API ${response.status}`) as ApiError
    error.status = response.status
    error.payload = payload as ApiErrorPayload | undefined
    throw error
  }
  return payload as T
}

type LlmConfig = { base_url: string; api_key: string; model: string }
type ApiSettings = { llm: { primary: LlmConfig; fallback: LlmConfig }; redfox: { base_url: string; api_key: string } }
const apiSettingsStorageKey = 'dingweipai:api-settings'
const emptyLlmConfig: LlmConfig = { base_url: '', api_key: '', model: '' }
const emptyApiSettings: ApiSettings = { llm: { primary: { ...emptyLlmConfig }, fallback: { ...emptyLlmConfig } }, redfox: { base_url: 'https://redfox.hk', api_key: '' } }

function loadApiSettings(): ApiSettings {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(apiSettingsStorageKey) || '{}')
    const legacy = parsed.llm && ('base_url' in parsed.llm || 'api_key' in parsed.llm || 'model' in parsed.llm) ? parsed.llm : null
    const llm = parsed.llm || {}
    return { llm: { primary: { ...emptyLlmConfig, ...(legacy || llm.primary || {}) }, fallback: { ...emptyLlmConfig, ...(llm.fallback || {}) } }, redfox: { ...emptyApiSettings.redfox, ...(parsed.redfox || {}) } }
  } catch {
    return emptyApiSettings
  }
}

function saveApiSettings(settings: ApiSettings): void {
  try {
    window.localStorage.setItem(apiSettingsStorageKey, JSON.stringify(settings))
  } catch {
    /* storage unavailable: keep settings in memory for this session */
  }
}

type SkillToggles = { hotSearch: boolean; keywordHotSearch: boolean; compliance: boolean; similarAccounts: boolean }
const skillTogglesKey = 'dingweipai:skill-toggles'
const defaultSkillToggles: SkillToggles = { hotSearch: true, keywordHotSearch: true, compliance: true, similarAccounts: true }

function loadSkillToggles(): SkillToggles {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(skillTogglesKey) || '{}')
    return { ...defaultSkillToggles, ...(parsed || {}) }
  } catch {
    return defaultSkillToggles
  }
}

function saveSkillToggles(toggles: SkillToggles): void {
  try {
    window.localStorage.setItem(skillTogglesKey, JSON.stringify(toggles))
  } catch {
    /* storage unavailable: keep toggles in memory for this session */
  }
}

const allResearchPlatforms = ['小红书', '抖音', '视频号', '公众号', 'B站', '微博', '快手', '今日头条', 'X']

type TestResult = { ok: boolean; error?: string; status?: number }
type ApiSlot = 'text_primary' | 'text_fallback' | 'vision'
type EditableApiConfig = { slot: ApiSlot; role: string; enabled: boolean; base_url: string; model: string; api_key: string; api_key_masked: string; configured: boolean }
type EditableRedfoxConfig = { base_url: string; api_key: string; api_key_masked: string; configured: boolean }
const apiSlotLabels: Record<ApiSlot, { title: string; detail: string }> = {
  text_primary: { title: '大模型 API 1（主用）', detail: '主文本模型：选题、文案和文本分析' },
  text_fallback: { title: '大模型 API 2（备用）', detail: '备用文本模型：API 1 失败时自动接管' },
  vision: { title: '大模型 API 3（视觉）', detail: '专用视觉模型：仅处理截图和图片理解' },
}
type SyncDirectoryView = { id: string; device_id: string; local_path: string; enabled: boolean; sync_status: string; sync_error: string | null; last_scanned_at: string | null }
type SyncDeviceView = { id: string; name: string; last_seen_at: string | null }
type SyncJobView = { id: string; name: string; path: string; status: string; error: string | null; attempts: number; material_id?: number }

function SyncManagementPanel({ onClose, onSync, syncing }: { onClose: () => void; onSync: () => void; syncing: boolean }) {
  const [directories, setDirectories] = useState<SyncDirectoryView[]>([])
  const [devices, setDevices] = useState<SyncDeviceView[]>([])
  const [jobs, setJobs] = useState<SyncJobView[]>([])
  const [path, setPath] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [runtime, setRuntime] = useState<DesktopSyncRuntime | null>(null)
  const [saved, setSaved] = useState('')
  const refresh = useCallback(() => Promise.all([
    apiJson<SyncDirectoryView[]>('/api/sync-directories'),
    apiJson<SyncDeviceView[]>('/api/devices'),
    apiJson<SyncJobView[]>('/api/materials/sync'),
  ]).then(([nextDirectories, nextDevices, nextJobs]) => { setDirectories(nextDirectories); setDevices(nextDevices); setJobs(nextJobs); setDeviceId(current => current || nextDevices[0]?.id || '') }).catch(() => setSaved('同步状态暂时无法刷新')), [])
  useEffect(() => { void window.desktopApp?.getSyncRuntime().then(next => { setRuntime(next); setDeviceId(next.device_id) }); void refresh(); const timer = window.setInterval(() => void refresh(), 5000); return () => window.clearInterval(timer) }, [refresh])
  const addDirectory = () => {
    const localPath = path.trim()
    if (!localPath) return setSaved('请输入同步目录路径')
    if (!deviceId) return setSaved('请先选择目标设备')
    const device = devices.find(item => item.id === deviceId)
    void apiJson<SyncDirectoryView>('/api/sync-directories', { method: 'POST', body: JSON.stringify({ local_path: localPath, device_id: deviceId, device_name: device?.name || runtime?.device_name || deviceId }) }).then(async directory => { setDirectories(current => [...current, directory]); setPath(''); setSaved('目录已登记，等待目标设备验证'); if (window.desktopApp && deviceId === runtime?.device_id) setRuntime(await window.desktopApp.refreshSync()) }).catch(() => setSaved('添加失败，请检查登录状态'))
  }
  const updateDirectory = (directory: SyncDirectoryView, enabled: boolean) => void apiJson<SyncDirectoryView>(`/api/sync-directories/${directory.id}`, { method: 'PUT', body: JSON.stringify({ enabled }) }).then(async next => { setDirectories(current => current.map(item => item.id === next.id ? next : item)); if (window.desktopApp) setRuntime(await window.desktopApp.refreshSync()) }).catch(() => setSaved('目录状态更新失败'))
  const removeDirectory = (directory: SyncDirectoryView) => { if (!window.confirm(`移除同步目录“${directory.local_path}”？`)) return; void apiJson(`/api/sync-directories/${directory.id}`, { method: 'DELETE' }).then(async () => { setDirectories(current => current.filter(item => item.id !== directory.id)); if (window.desktopApp) setRuntime(await window.desktopApp.refreshSync()) }).catch(() => setSaved('移除失败')) }
  const retryJob = (job: SyncJobView) => void apiJson(`/api/materials/sync/${job.id}/retry`, { method: 'POST' }).then(() => refresh()).catch(() => setSaved('重试失败'))
  const statusLabel: Record<string, string> = { queued: '等待中', processing: '处理中', ready: '已完成', failed: '失败', duplicate: '重复', withdrawn: '本地已删除' }
  const directoryStatus: Record<string, string> = { pending_verification: '等待设备验证', watching: '监听中', paused: '已暂停', path_missing: '路径不存在', permission_denied: '无读取权限', offline: '设备离线' }
  const runSync = async () => {
    onSync()
    if (!window.desktopApp) return setSaved('配置已刷新，实际扫描将在目标桌面上线后执行')
    try { const next = await window.desktopApp.refreshSync(); setRuntime(next); for (const directory of directories.filter(item => item.device_id === next.device_id && item.enabled)) await window.desktopApp.scanSyncDirectory(directory.id); setSaved('桌面扫描和队列提交完成'); await refresh() }
    catch (error) { setSaved(error instanceof Error ? error.message : '桌面同步失败') }
  }
  const chooseDirectory = () => void window.desktopApp?.selectSyncDirectory().then(selected => { if (selected) setPath(selected) })
  return <div className="settings-overlay" onClick={onClose}><div className="settings-modal sync-modal" onClick={event => event.stopPropagation()}>
    <header className="settings-head"><div><span className="section-kicker">DESKTOP SYNC</span><h2>桌面同步</h2></div><button className="close-review" onClick={onClose} aria-label="关闭同步管理"><X size={16} /></button></header>
    <div className="settings-body">
      <section className="settings-section"><div className="sync-summary"><div><span>当前环境</span><strong>{runtime?.device_name || '网页管理端'}</strong></div><div><span>待处理队列</span><strong>{jobs.filter(job => ['queued', 'processing'].includes(job.status)).length}</strong></div><div><span>失败文件</span><strong>{jobs.filter(job => job.status === 'failed').length}</strong></div></div><div className="sync-actions"><button className="primary-action" onClick={() => void runSync()} disabled={syncing}>{syncing ? '同步中...' : '立即同步'} <ArrowUpRight size={15} /></button>{saved && <span className="test-fail">{saved}</span>}</div></section>
      <section className="settings-section"><h3>同步文件夹</h3><div className="sync-add"><select value={deviceId} onChange={event => setDeviceId(event.target.value)}><option value="">选择目标设备</option>{devices.map(device => <option value={device.id} key={device.id}>{device.name}{device.last_seen_at ? '' : '（离线）'}</option>)}</select><input value={path} onChange={event => setPath(event.target.value)} placeholder="输入本地文件夹路径，例如 D:\\内容素材" />{window.desktopApp && <button className="outline-action" onClick={chooseDirectory}><FolderOpen size={15} /> 选择</button>}<button className="outline-action" onClick={addDirectory}><Plus size={15} /> 添加</button></div><div className="sync-directory-list">{directories.length ? directories.map(directory => <article className="sync-directory-row" key={directory.id}><FolderOpen size={18} /><div><strong>{directory.local_path}</strong><small>{devices.find(device => device.id === directory.device_id)?.name || directory.device_id} · {directoryStatus[directory.sync_status] || directory.sync_status || '等待设备验证'}{directory.sync_error ? ` · ${directory.sync_error}` : ''}</small></div><button className="outline-action" onClick={() => updateDirectory(directory, !directory.enabled)}>{directory.enabled ? <><Pause size={14} /> 暂停</> : <><Play size={14} /> 恢复</>}</button><button className="icon-button" onClick={() => removeDirectory(directory)} aria-label="移除同步目录"><Trash2 size={15} /></button></article>) : <p className="empty-state">还没有同步文件夹。网页可预登记，目标桌面上线后会验证并开始监听。</p>}</div></section>
      <section className="settings-section"><h3>文件队列</h3><div className="sync-job-list">{jobs.length ? jobs.slice().reverse().map(job => <article className="sync-job-row" key={job.id}><FileText size={16} /><div><strong>{job.name}</strong><small>{job.path} · {statusLabel[job.status] || job.status}{job.error ? ` · ${job.error}` : ''}</small></div>{job.status === 'failed' && <button className="outline-action" onClick={() => retryJob(job)}>重试</button>}</article>) : <p className="empty-state">暂无同步文件记录。</p>}</div></section>
    </div>
  </div></div>
}

const emptyServerApis = Object.fromEntries((Object.keys(apiSlotLabels) as ApiSlot[]).map(slot => [slot, { slot, role: slot, enabled: false, base_url: '', model: '', api_key: '', api_key_masked: '', configured: false }])) as Record<ApiSlot, EditableApiConfig>

function SettingsPanel({ theme, setTheme, font, setFont, onClose }: { theme: ThemeKey; setTheme: (theme: ThemeKey) => void; font: FontKey; setFont: (font: FontKey) => void; onClose: () => void }) {
  const [legacySettings] = useState<ApiSettings>(loadApiSettings)
  const [redfox, setRedfox] = useState<EditableRedfoxConfig>({ ...legacySettings.redfox, api_key_masked: '', configured: Boolean(legacySettings.redfox.api_key) })
  const [serverApis, setServerApis] = useState<Record<ApiSlot, EditableApiConfig>>(emptyServerApis)
  const [saved, setSaved] = useState('')
  const [testing, setTesting] = useState<ApiSlot | 'redfox' | ''>('')
  const [testResult, setTestResult] = useState<Record<string, string>>({})
  const [hasLegacyLlm, setHasLegacyLlm] = useState(Boolean(legacySettings.llm.primary.api_key || legacySettings.llm.fallback.api_key))

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    void Promise.all([
      apiJson<Omit<EditableApiConfig, 'api_key'>[]>('/api/api-settings'),
      apiJson<Omit<EditableRedfoxConfig, 'api_key'>>('/api/redfox-settings'),
    ]).then(([items, redfoxConfig]) => {
      setServerApis(current => Object.fromEntries(items.map(item => [item.slot, { ...current[item.slot], ...item, api_key: '' }])) as Record<ApiSlot, EditableApiConfig>)
      setRedfox(current => redfoxConfig.configured ? { ...current, ...redfoxConfig, api_key: '' } : current)
    }).catch(() => setSaved('服务端 API 配置暂不可用'))
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const updateApi = (slot: ApiSlot, key: 'base_url' | 'model' | 'api_key' | 'enabled', value: string | boolean) => setServerApis(current => ({ ...current, [slot]: { ...current[slot], [key]: value } }))
  const saveSlot = async (slot: ApiSlot) => {
    const config = serverApis[slot]
    const body = { enabled: config.enabled, base_url: config.base_url, model: config.model, ...(config.api_key ? { api_key: config.api_key } : {}) }
    const result = await apiJson<Omit<EditableApiConfig, 'api_key'>>(`/api/api-settings/${slot}`, { method: 'PUT', body: JSON.stringify(body) })
    setServerApis(current => ({ ...current, [slot]: { ...current[slot], ...result, api_key: '' } }))
    return result
  }
  const saveRedfox = async () => {
    const body = { base_url: redfox.base_url, ...(redfox.api_key ? { api_key: redfox.api_key } : {}) }
    const result = await apiJson<Omit<EditableRedfoxConfig, 'api_key'>>('/api/redfox-settings', { method: 'PUT', body: JSON.stringify(body) })
    setRedfox(current => ({ ...current, ...result, api_key: '' }))
    return result
  }
  const persist = () => {
    setSaved('')
    void Promise.all([...(Object.keys(apiSlotLabels) as ApiSlot[]).map(saveSlot), saveRedfox()]).then(() => {
      saveApiSettings(emptyApiSettings)
      setSaved('四套 API 配置已加密保存到账号')
    }).catch((error: unknown) => setSaved(`保存失败：${error instanceof Error ? error.message : '请检查主密钥和配置内容'}`))
  }
  const runTest = (type: ApiSlot | 'redfox') => {
    setTesting(type); setTestResult(current => ({ ...current, [type]: '' }))
    const request = type === 'redfox'
      ? saveRedfox().then(() => apiJson<TestResult>('/api/redfox-settings?action=test', { method: 'POST', body: '{}' }))
      : saveSlot(type).then(() => apiJson<TestResult>(`/api/api-settings/${type}?action=test`, { method: 'POST', body: '{}' }))
    void request.then(result => setTestResult(current => ({ ...current, [type]: result.ok ? '连接成功，能力验证通过。' : `连接失败：${result.error || '未知原因'}` }))).catch((error: unknown) => setTestResult(current => ({ ...current, [type]: `连接失败：${error instanceof Error ? error.message : '测试请求未完成。'}` }))).finally(() => setTesting(''))
  }
  const migrateLegacy = () => {
    if (!window.confirm('将此浏览器中的 API 1/API 2 配置加密上传到当前账号，并删除浏览器内的对应明文配置？')) return
    const body = {
      ...(legacySettings.llm.primary.api_key ? { text_primary: { ...legacySettings.llm.primary, enabled: true } } : {}),
      ...(legacySettings.llm.fallback.api_key ? { text_fallback: { ...legacySettings.llm.fallback, enabled: true } } : {}),
    }
    void apiJson<Omit<EditableApiConfig, 'api_key'>[]>('/api/api-settings/migrate', { method: 'POST', body: JSON.stringify(body) }).then(items => {
      saveApiSettings({ ...emptyApiSettings, redfox })
      setServerApis(current => Object.fromEntries(items.map(item => [item.slot, { ...current[item.slot], ...item, api_key: '' }])) as Record<ApiSlot, EditableApiConfig>)
      setHasLegacyLlm(false)
      setSaved('旧配置已迁移，浏览器明文已清除')
    }).catch(() => setSaved('迁移失败，浏览器原配置保持不变'))
  }

  return <div className="settings-overlay" onClick={onClose}><div className="settings-modal" onClick={event => event.stopPropagation()}>
    <header className="settings-head"><div><span className="section-kicker">WORKBENCH SETTINGS</span><h2>工作台设置</h2></div><button className="close-review" onClick={onClose} aria-label="关闭设置"><X size={16} /></button></header>
    <div className="settings-body">
      <section className="settings-section"><h3>外观</h3>
        <div className="settings-theme-grid">{(Object.keys(themes) as ThemeKey[]).map(key => <button className={theme === key ? 'settings-theme active' : 'settings-theme'} key={key} onClick={() => setTheme(key)}><span className="theme-dots">{themes[key].colors.map(color => <i key={color} style={{ background: color }} />)}</span><b>{themes[key].name}</b><small>{themes[key].subtitle}</small></button>)}</div>
        <div className="settings-font-row">{(Object.keys(fonts) as FontKey[]).map(key => <button className={font === key ? 'settings-font active' : 'settings-font'} key={key} onClick={() => setFont(key)} style={{ fontFamily: fonts[key].sample }}><b>{fonts[key].name}</b><small>{fonts[key].subtitle}</small></button>)}</div>
      </section>
      <section className="settings-section"><h3>API 中心</h3>
        <p className="settings-privacy">四套 API Key 使用 AES-256-GCM 按账号加密保存。页面仅显示掩码，修改 Key 时必须重新输入完整值。</p>
        {hasLegacyLlm && <div className="offline-banner" role="status">检测到此浏览器保存的旧版 API 1/API 2 配置，不会自动上传。<button onClick={migrateLegacy}>确认迁移到账号</button></div>}
        {(Object.keys(apiSlotLabels) as ApiSlot[]).map(slot => <article className="settings-api-card" key={slot}>
          <div className="settings-api-head"><b>{apiSlotLabels[slot].title}</b><small>{apiSlotLabels[slot].detail}</small></div>
          <label><span>启用</span><input type="checkbox" checked={serverApis[slot].enabled} onChange={event => updateApi(slot, 'enabled', event.target.checked)} /></label>
          <label><span>Base URL</span><input value={serverApis[slot].base_url} onChange={event => updateApi(slot, 'base_url', event.target.value)} placeholder="https://api.example.com/v1" /></label>
          <label><span>API Key</span><input type="password" autoComplete="new-password" value={serverApis[slot].api_key} onChange={event => updateApi(slot, 'api_key', event.target.value)} placeholder={serverApis[slot].api_key_masked || '输入完整 API Key'} /></label>
          <label><span>模型名</span><input value={serverApis[slot].model} onChange={event => updateApi(slot, 'model', event.target.value)} placeholder={slot === 'vision' ? 'vision-model' : 'text-model'} /></label>
          <div className="settings-api-foot"><button className="outline-action" disabled={testing !== ''} onClick={() => runTest(slot)}>{testing === slot ? '验证中...' : '测试连接与能力'}</button>{testResult[slot] && <span className={testResult[slot].startsWith('连接成功') ? 'test-ok' : 'test-fail'}>{testResult[slot]}</span>}</div>
        </article>)}
        <article className="settings-api-card">
          <div className="settings-api-head"><b>红狐 API</b><small>RedFox 热点研究数据服务，按账号加密保存</small></div>
          <label><span>Base URL</span><input value={redfox.base_url || 'https://redfox.hk'} onChange={event => setRedfox(current => ({ ...current, base_url: event.target.value }))} placeholder="https://redfox.hk" /></label>
          <label><span>API Key</span><input type="password" autoComplete="new-password" value={redfox.api_key} onChange={event => setRedfox(current => ({ ...current, api_key: event.target.value }))} placeholder={redfox.api_key_masked || '输入完整 API Key'} /></label>
          <div className="settings-api-foot"><button className="outline-action" disabled={testing !== ''} onClick={() => runTest('redfox')}>{testing === 'redfox' ? '测试中...' : '测试连接'}</button>{testResult.redfox && <span className={testResult.redfox.startsWith('连接成功') ? 'test-ok' : 'test-fail'}>{testResult.redfox}</span>}</div>
        </article>
        <div className="settings-save-row"><button className="primary-action" onClick={persist}>加密保存配置 <ArrowUpRight size={16} /></button>{saved && <span className={saved.includes('失败') || saved.includes('不可用') ? 'test-fail' : 'test-ok'}>{saved}</span>}</div>
      </section>
      <MemoryPanel />
    </div>
  </div></div>
}

type MemoryItem = { id: number; memory_type: 'style' | 'topic' | 'feedback'; content: string; source: string; provider: string; status: string; created_at: string }
const memoryTypeLabels: Record<MemoryItem['memory_type'], string> = { style: '风格', topic: '选题', feedback: '反馈' }
const memoryTypeKeys = ['style', 'topic', 'feedback'] as const

function MemoryPanel() {
  const [items, setItems] = useState<MemoryItem[]>([])
  const [typeFilter, setTypeFilter] = useState('')
  const [newType, setNewType] = useState<MemoryItem['memory_type']>('style')
  const [newContent, setNewContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [extractOpen, setExtractOpen] = useState(false)
  const [extractText, setExtractText] = useState('')

  const load = () => {
    void apiJson<MemoryItem[]>('/api/memories').then(setItems).catch(() => undefined)
  }

  useEffect(() => { load() }, [])

  const add = () => {
    if (!newContent.trim()) { setMessage('请输入记忆内容。'); return }
    setBusy(true); setMessage('')
    void apiJson<MemoryItem & { duplicate?: boolean }>('/api/memories', { method: 'POST', body: JSON.stringify({ memory_type: newType, content: newContent.trim() }) })
      .then(item => { setMessage(item.duplicate ? '这条记忆已存在。' : '已记住。'); if (!item.duplicate) setItems(current => [item, ...current]); setNewContent('') })
      .catch(() => setMessage('保存失败，请稍后重试。'))
      .finally(() => setBusy(false))
  }

  const remove = (id: number) => {
    if (!window.confirm('删除这条记忆后，AI 将不再使用它。确认删除？')) return
    void apiJson(`/api/memories/${id}`, { method: 'DELETE' }).then(() => setItems(current => current.filter(item => item.id !== id))).catch(() => undefined)
  }

  const extract = () => {
    if (!extractText.trim()) { setMessage('请先粘贴要提炼的对话、访谈或复盘文本。'); return }
    setBusy(true); setMessage('')
    void apiJson<{ items: MemoryItem[]; extracted: number }>('/api/memories/extract', { method: 'POST', body: JSON.stringify({ text: extractText.trim() }) })
      .then(result => {
        setItems(current => [...result.items, ...current])
        setMessage(result.items.length ? `提炼出 ${result.items.length} 条新记忆（共识别 ${result.extracted} 条，重复已跳过）。` : '这段文本里没有提炼出新的记忆。')
        setExtractText(''); setExtractOpen(false)
      })
      .catch((error: unknown) => setMessage(error instanceof Error && error.message ? error.message : '自动提炼失败，请稍后重试。'))
      .finally(() => setBusy(false))
  }

  const visible = typeFilter ? items.filter(item => item.memory_type === typeFilter) : items

  return <section className="settings-section"><h3>AI 记忆</h3>
    <p className="settings-privacy">这里的事实会被注入选题与草稿生成，让产出越来越贴合你的风格。你可以随时查看、修正或删除。</p>
    <div className="structure-toolbar-row memory-filter">
      {['', ...memoryTypeKeys].map(name => <button className={typeFilter === name ? 'chip active' : 'chip'} onClick={() => setTypeFilter(name)} key={name || 'all'}>{name ? memoryTypeLabels[name as MemoryItem['memory_type']] : '全部'}</button>)}
      <span className="chip-gap" />
      <button className="outline-action" disabled={busy} onClick={() => { setExtractOpen(!extractOpen); setMessage('') }}>从对话自动提炼</button>
    </div>
    {extractOpen && <div className="memory-form memory-extract"><textarea value={extractText} onChange={event => setExtractText(event.target.value)} placeholder="粘贴与客户的对话、访谈记录或复盘笔记，AI 会提炼值得长期记住的风格、选题和反馈。" aria-label="提炼文本" rows={5} /><button className="primary-action" disabled={busy || !extractText.trim()} onClick={extract}>{busy ? '提炼中...' : '提炼记忆'}</button></div>}
    <div className="memory-form">
      <select value={newType} onChange={event => setNewType(event.target.value as MemoryItem['memory_type'])} aria-label="记忆类型">
        {memoryTypeKeys.map(name => <option key={name} value={name}>{memoryTypeLabels[name]}</option>)}
      </select>
      <input value={newContent} onChange={event => setNewContent(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') add() }} placeholder="例如：我的开头从不用问句 / 失败复盘类选题我数据更好" />
      <button className="primary-action" disabled={busy} onClick={add}>{busy ? '保存中...' : '添加'}</button>
    </div>
    {message && <p className="memory-message">{message}</p>}
    <div className="memory-list">
      {visible.length ? visible.map(item => <div className="memory-item" key={item.id}>
        <span className={`memory-type-tag memory-${item.memory_type}`}>{memoryTypeLabels[item.memory_type]}</span>
        <p>{item.content}</p>
        <small>{item.source === 'auto' ? '自动提炼' : '手动添加'} · {new Date(item.created_at).toLocaleDateString()}</small>
        <button className="outline-action danger" onClick={() => remove(item.id)} aria-label="删除记忆"><Trash2 size={14} /></button>
      </div>) : <p className="empty-state">还没有记忆。添加一条偏好或反馈，生成内容时就会自动应用。</p>}
    </div>
  </section>
}

function StrategyPanel({ ratios, setRatios, saving, onReview }: { ratios: number[]; setRatios: (ratios: number[]) => void; saving: boolean; onReview: () => void }) {
  const updateRatio = (index: number, value: number) => {
    const remaining = 100 - value
    const otherIndexes = strategyLayers.map((_, itemIndex) => itemIndex).filter(itemIndex => itemIndex !== index)
    const otherTotal = otherIndexes.reduce((total, itemIndex) => total + ratios[itemIndex], 0)
    const next = [...ratios]
    next[index] = value
    otherIndexes.forEach(itemIndex => { next[itemIndex] = otherTotal ? Math.round(ratios[itemIndex] / otherTotal * remaining) : Math.round(remaining / otherIndexes.length) })
    next[otherIndexes[otherIndexes.length - 1]] += 100 - next.reduce((total, itemRatio) => total + itemRatio, 0)
    setRatios(next)
  }
  return <section className="strategy-panel"><div className="strategy-panel-head"><div><span className="section-kicker">IP STRATEGY / FLEXIBLE MIX</span><h2>当前内容策略</h2><p>目标主线保持稳定，内容配比跟着阶段和复盘结果调整。</p></div><button className="outline-action" onClick={onReview}>开始复盘 <ArrowUpRight size={15} /></button></div><div className="strategy-bars">{strategyLayers.map((layer, index) => <div className="strategy-row" key={layer.label}><div className="strategy-label"><span className={`strategy-dot ${layer.color}`} /><strong>{layer.label}</strong><small>{layer.task}</small></div><input type="range" min="0" max="100" value={ratios[index]} onChange={event => updateRatio(index, Number(event.target.value))} aria-label={`${layer.label}比例`} /><b>{ratios[index]}%</b></div>)}</div><div className="strategy-foot"><span>{saving ? '正在保存策略版本...' : '策略已同步 · 下次复盘：两周后'}</span><span>总比例 {ratios.reduce((total, ratio) => total + ratio, 0)}%</span></div></section>
}

function StrategyReview({ ratios, onApply, onClose }: { ratios: number[]; onApply: () => void; onClose: () => void }) {
  return <section className="review-panel"><div className="review-head"><div><span className="section-kicker">REVIEW / LAST 14 DAYS</span><h2>这轮复盘看到了什么</h2><p>系统根据当前策略组合生成建议，确认后会保存为新的策略版本。</p></div><button className="close-review" onClick={onClose}><X size={16} /></button></div><div className="review-metrics"><div><span>泛流量触达</span><strong>+42%</strong><small>曝光增长 · 当前 {ratios[0]}%</small></div><div><span>垂直信任</span><strong>+18%</strong><small>收藏增长 · 当前 {ratios[1]}%</small></div><div><span>核心目标转化</span><strong>6 条</strong><small>有效线索 · 当前 {ratios[2]}%</small></div></div><div className="review-suggestion"><div><span>建议调整</span><strong>把一部分泛流量投入转向信任与转化</strong><p>过去两周泛流量表现稳定，垂直内容带来的收藏和私信质量更高。</p></div><div className="review-ratio"><b>40%</b><span>/</span><b>35%</b><span>/</span><b>25%</b></div></div><div className="review-actions"><button className="skip-action" onClick={onClose}>保留当前策略</button><button className="primary-action" onClick={onApply}>应用建议并保存版本 <ArrowUpRight size={16} /></button></div></section>
}

type WorkspaceSection = '热点研究' | '素材库' | '爆款方法库' | '选题助手' | '内容创作' | '发布中心' | '内容日历' | 'IP 档案'
type ResearchItem = { id: number; platform: string; title: string; author?: string; url?: string | null; metrics?: { discussions?: number; growth?: number }; analysis?: { structure: string[]; summary?: string }; source_refs?: unknown[]; captured_at?: string; collected?: boolean; fit?: { score: number; matched: string[] } }
type DraftAdaptation = { title: string; body: string; hashtags: string[]; provider: string; checklist: { item: string; status: string; detail: string }[]; updated_at: string }

type ResearchListResponse = { items: ResearchItem[]; total: number }

function ResearchPulse({ onOpen }: { onOpen: (id?: number) => void }) {
  const [items, setItems] = useState<ResearchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    void apiJson<ResearchListResponse>('/api/research?sort=latest')
      .then(result => { setItems(result.items.slice(0, 3)); setError('') })
      .catch(() => setError('研究数据暂时无法加载，请稍后重试。'))
      .finally(() => setLoading(false))
  }, [])

  return <>
    <div className="section-heading"><div><span className="section-kicker">01 / RESEARCH</span><h2>研究脉搏</h2></div><button className="text-action" onClick={() => onOpen()}>查看全部 <ArrowUpRight size={15} /></button></div>
    {loading ? <div className="research-pulse-state">正在加载研究数据...</div> : error ? <div className="research-pulse-state" role="alert">{error}</div> : items.length ? <div className="research-grid">
      {items.map((item, index) => <button type="button" className={index === 0 ? 'trend-card lead-card research-pulse-card' : 'trend-card research-pulse-card'} onClick={() => onOpen(item.id)} aria-label={`打开研究：${item.title}`} key={item.id}>
        <div className="card-top"><span className={`platform-tag ${item.platform === '小红书' ? 'xhs' : item.platform === '公众号' ? 'wechat' : 'douyin'}`}>{item.platform}</span><span className="trend-up">↑ {item.metrics?.growth || 0}%</span></div>
        <h3>{item.title}</h3>
        <p>{item.author || 'RedFox 研究库'} · 点击查看完整拆解</p>
        <div className="card-foot"><span>{(item.metrics?.discussions || 0).toLocaleString()} 条讨论</span><span>{item.analysis?.structure?.length ? `${item.analysis.structure.length} 步拆解` : '待拆解'}</span></div>
      </button>)}
    </div> : <div className="research-pulse-state">暂无研究数据，可进入热点研究刷新。</div>}
  </>
}
type MaterialKind = 'article' | 'quote' | 'hotspot' | 'insight' | 'experience'
type MaterialItem = { id: number; name: string; format: string; status: string; review_status: string; content?: string; url?: string | null; material_kind?: MaterialKind; source_type?: string; source_id?: number | null; source_path?: string | null; device_id?: string | null; research_platform?: string; research_metrics?: { discussions?: number; growth?: number }; origin_source_id?: number | null; origin_text?: string; origin_material_name?: string | null; extracted_fields?: { segments?: string[]; candidate_topics?: string[]; quotes?: string[]; collected?: Partial<Record<'quote' | 'hotspot', string[]>> }; imported_at?: string }
const materialKindLabels: Record<MaterialKind, string> = { article: '文章', quote: '金句', hotspot: '热点', insight: '知识点', experience: '经历' }
const atomKindKeys: MaterialKind[] = ['quote', 'hotspot', 'insight', 'experience']
type TopicDimension = { score: number; evidence: string[]; suggestions: string[] }
type TopicItem = { id: number; title: string; rationale: string; content_job: string; strategy_layer: string; workflow_status?: string; decision?: 'do' | 'revise' | 'defer' | null; decision_reason?: string; evaluation?: { score: number; decision: 'do' | 'revise' | 'defer'; dimensions: Record<string, TopicDimension>; evidence: { dimension: string; message: string }[]; suggestions: string[]; evaluated_at: string } | null }
type DraftHook = { id: string; label: string; text: string; source_refs?: unknown[]; validation: { status: string; evidence: string[]; length: number } }
type DraftCheck = { status: 'passed' | 'warning' | 'blocked'; score?: number | null; dimensions?: Record<string, number | boolean>; evidence: { code: string; message: string; severity: string }[]; suggestions: string[]; draft_version?: number; checked_at: string }
type DraftApproval = { status: 'pending' | 'approved' | 'revoked'; user_id?: string | null; approved_at?: string | null; revoked_at?: string | null; revoked_by?: string | null; revoke_reason?: string | null; draft_version?: number | null; checks_snapshot?: Record<string, DraftCheck | null> | null }
type DraftItem = { id: number; platform: string; title: string; body: string; fact_check_status: string; status: string; workflow_status?: string; hooks?: DraftHook[]; selected_hook_id?: string | null; selected_hook?: DraftHook | null; variant_group_id?: string | null; variant_type?: string; generation_context?: Record<string, unknown> | null; checks?: { persona?: DraftCheck | null; quality?: DraftCheck | null; publish_checklist?: DraftCheck | null }; approval?: DraftApproval; version?: number; history?: DraftItem[]; adaptations?: Record<string, DraftAdaptation>; planned_date?: string | null }
type DraftApprovalResponse = { status: 'approved' | 'revoked'; draft: DraftItem; shooting: { id: number } | null }
type SyncConflict = { id: string; resource_type: string; resource_id: number; status: string }
const topicDimensionLabels: Record<string, string> = { traffic_potential: '流量潜力', account_fit: '账号匹配', competitive_differentiation: '竞争差异化', timeliness: '时效价值', monetization: '变现空间', production_cost: '制作成本', compliance_risk: '合规风险' }
const topicDecisionLabels: Record<string, string> = { do: '建议做', revise: '建议改方向', defer: '建议暂缓' }
const topicMissingFieldLabels: Record<string, string> = { role: '身份定位', audiences: '服务对象', pillars: '内容支柱' }
const draftCheckStatusLabels: Record<string, string> = { passed: '已通过', warning: '有提醒', blocked: '未通过' }
type StructureItem = { id: number; title: string; steps: string[]; platform: string; content_type: string; source_kind: string; favorite: boolean; usage_count: number; updated_at: string }
type StructureEditorState = { id?: number; title: string; steps: string; platform: string; content_type: string }

const structurePlatforms = ['通用', '小红书', '抖音', '视频号', '公众号']
type MethodCategory = '选题方法' | '标题方法' | '开头方法' | '内容结构'
const methodCategories: MethodCategory[] = ['选题方法', '标题方法', '开头方法', '内容结构']

function methodCategoryOf(item: Pick<StructureItem, 'title' | 'steps' | 'content_type'>): MethodCategory {
  if (methodCategories.includes(item.content_type as MethodCategory)) return item.content_type as MethodCategory
  const text = `${item.title} ${item.content_type} ${item.steps.join(' ')}`
  if (/(标题|命名|题目)/.test(text)) return '标题方法'
  if (/(开头|钩子|开场|首句)/.test(text)) return '开头方法'
  if (/(选题|话题|赛道|主题)/.test(text)) return '选题方法'
  return '内容结构'
}

type SearchHit = { kind: string; title: string; sub: string; target: string }

function GlobalSearch({ onNavigate }: { onNavigate: (section: string) => void }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [hits, setHits] = useState<SearchHit[]>([])
  const indexRef = useRef<SearchHit[] | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const onDocMouseDown = (event: MouseEvent) => {
      if (boxRef.current && event.target instanceof Node && !boxRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  const buildIndex = async (): Promise<SearchHit[]> => {
    const [research, drafts, materials, structures] = await Promise.all([
      apiJson<ResearchItem[]>('/api/research').catch(() => [] as ResearchItem[]),
      apiJson<DraftItem[]>('/api/drafts').catch(() => [] as DraftItem[]),
      apiJson<MaterialItem[]>('/api/materials').catch(() => [] as MaterialItem[]),
      apiJson<{ items: StructureItem[] }>('/api/structures?page=1').catch(() => ({ items: [] as StructureItem[] }))
    ])
    const hits: SearchHit[] = []
    for (const item of research) hits.push({ kind: '研究', title: item.title, sub: item.platform, target: '热点研究' })
    for (const item of drafts) hits.push({ kind: '草稿', title: item.title, sub: item.platform, target: '内容创作' })
    for (const item of materials) hits.push({ kind: '素材', title: item.name, sub: item.format, target: '素材库' })
    for (const item of structures.items) hits.push({ kind: '方法', title: item.title, sub: item.platform, target: '爆款方法库' })
    return hits
  }

  const runSearch = (keyword: string) => {
    setQuery(keyword)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    if (!keyword.trim()) { setHits([]); setOpen(false); return }
    timerRef.current = window.setTimeout(() => {
      void (async () => {
        if (!indexRef.current) indexRef.current = await buildIndex().catch(() => [] as SearchHit[])
        const key = keyword.trim().toLowerCase()
        const matched = (indexRef.current || []).filter(hit => hit.title.toLowerCase().includes(key) || hit.sub.toLowerCase().includes(key)).slice(0, 8)
        setHits(matched)
        setOpen(true)
      })()
    }, 250)
  }

  const go = (hit: SearchHit) => {
    setOpen(false)
    setQuery('')
    setHits([])
    onNavigate(hit.target)
  }

  return (
    <div className="global-search" ref={boxRef}>
      <Search size={15} />
      <input
        value={query}
        placeholder="搜索选题、草稿、素材、方法…"
        onChange={event => runSearch(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') setOpen(false)
          if (event.key === 'Enter' && hits[0]) go(hits[0])
        }}
      />
      {open && (
        <div className="search-menu">
          {hits.length === 0
            ? <p className="search-empty">未找到相关内容</p>
            : hits.map((hit, index) => (
              <button key={`${hit.kind}-${index}`} onClick={() => go(hit)}>
                <span className="search-kind">{hit.kind}</span>
                <strong>{hit.title}</strong>
                <span className="search-sub">{hit.sub}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

function StructureLibrary({ onUse }: { onUse: (structure: StructureItem) => void }) {
  const [items, setItems] = useState<StructureItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [platform, setPlatform] = useState('')
  const [methodCategory, setMethodCategory] = useState<MethodCategory | ''>('')
  const [favOnly, setFavOnly] = useState(false)
  const [sort, setSort] = useState<'latest' | 'usage' | 'favorite'>('latest')
  const [view, setView] = useState<'auto' | 'card' | 'list'>('auto')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState<StructureEditorState | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true)
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      if (platform) params.set('platform', platform)
      if (methodCategory) params.set('method_category', methodCategory)
      if (favOnly) params.set('favorite', '1')
      params.set('sort', sort)
      void apiJson<{ items: StructureItem[]; total: number }>(`/api/structures?${params.toString()}`)
        .then(result => { setItems(result.items); setTotal(result.total); setPage(1); setError('') })
        .catch(() => setError('加载方法库失败，请稍后重试。'))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [query, platform, methodCategory, favOnly, sort])

  const loadMore = () => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (platform) params.set('platform', platform)
    if (methodCategory) params.set('method_category', methodCategory)
    if (favOnly) params.set('favorite', '1')
    params.set('sort', sort)
    params.set('page', String(page + 1))
    void apiJson<{ items: StructureItem[]; total: number }>(`/api/structures?${params.toString()}`)
      .then(result => { setItems(current => [...current, ...result.items]); setTotal(result.total); setPage(page + 1); setError('') })
      .catch(() => setError('加载更多失败，请稍后重试。'))
  }

  const toggleFavorite = (item: StructureItem) => {
    void apiJson<StructureItem>(`/api/structures/${item.id}`, { method: 'PUT', body: JSON.stringify({ favorite: !item.favorite }) })
      .then(saved => setItems(current => current.map(existing => existing.id === saved.id ? saved : existing)))
      .catch(() => setError('收藏操作失败，请稍后重试。'))
  }

  const removeStructure = (item: StructureItem) => {
    if (!window.confirm(`删除方法「${item.title}」？已生成的草稿会保留。`)) return
    void apiJson(`/api/structures/${item.id}`, { method: 'DELETE' })
      .then(() => { setItems(current => current.filter(existing => existing.id !== item.id)); setTotal(current => current - 1); setError('') })
      .catch(() => setError('删除失败，请稍后重试。'))
  }

  const saveEditor = useCallback(() => {
    if (!editor) return
    const steps = editor.steps.split('\n').map(step => step.trim()).filter(Boolean)
    if (!editor.title.trim() || !steps.length) { setError('标题与步骤为必填项。'); return }
    const payload = JSON.stringify({ title: editor.title.trim(), steps, platform: editor.platform, content_type: editor.content_type })
    const request = editor.id
      ? apiJson<StructureItem>(`/api/structures/${editor.id}`, { method: 'PUT', body: payload })
      : apiJson<StructureItem>('/api/structures', { method: 'POST', body: payload })
    void request.then(saved => {
      setEditor(null)
      setError('')
      setEditorItems(saved, editor.id !== undefined)
    }).catch(() => setError('保存失败，请稍后重试。'))
  }, [editor])

  const setEditorItems = (saved: StructureItem, isEdit: boolean) => {
    if (isEdit) setItems(current => current.map(existing => existing.id === saved.id ? saved : existing))
    else { setItems(current => [saved, ...current]); setTotal(current => current + 1) }
  }

  const clearFilters = () => { setQuery(''); setPlatform(''); setMethodCategory(''); setFavOnly(false) }

  const listMode = view === 'list' || (view === 'auto' && total > 12)

  const renderDetail = (item: StructureItem) => (
    <div className="structure-detail">
      <ol>{item.steps.map((step, index) => <li key={`${item.id}-${index}`}>{step}</li>)}</ol>
      <div className="structure-detail-actions">
        <button className="primary-action" onClick={() => onUse(item)}>用这个方法 <PenLine size={14} /></button>
        <button className="outline-action" onClick={() => setEditor({ id: item.id, title: item.title, steps: item.steps.join('\n'), platform: item.platform, content_type: methodCategoryOf(item) })}><Pencil size={13} /> 编辑</button>
        <button className="outline-action danger" onClick={() => removeStructure(item)}><Trash2 size={13} /> 删除</button>
      </div>
    </div>
  )

  return <section className="structure-library">
    <div className="structure-toolbar">
      <div className="structure-toolbar-row">
        <span className="filter-label">方法分类</span>
        <button className={methodCategory === '' ? 'chip active' : 'chip'} onClick={() => { setMethodCategory(''); setPlatform('') }}>全部方法</button>
        {methodCategories.map(name => <button className={methodCategory === name ? 'chip active' : 'chip'} onClick={() => { setMethodCategory(methodCategory === name ? '' : name); setPlatform('') }} key={name}>{name}</button>)}
      </div>
      <div className="structure-toolbar-row">
        <span className="filter-label">适用平台</span>
        <button className={platform === '' ? 'chip active' : 'chip'} onClick={() => setPlatform('')}>全部平台</button>
        {structurePlatforms.map(name => <button className={platform === name ? 'chip active' : 'chip'} onClick={() => setPlatform(platform === name ? '' : name)} key={name}>{name}</button>)}
        <span className="chip-gap" />
        <button className={favOnly ? 'chip active' : 'chip'} onClick={() => setFavOnly(!favOnly)}><Star size={12} /> 收藏</button>
        <span className="structure-meta">{loading ? '加载中...' : `${total} 条方法`}</span>
        <select className="structure-sort" value={sort} onChange={event => setSort(event.target.value as 'latest' | 'usage' | 'favorite')} aria-label="排序方式">
          <option value="latest">最新更新</option>
          <option value="usage">最常用</option>
          <option value="favorite">收藏优先</option>
        </select>
      </div>
    </div>
    {error && <p className="structure-error" role="alert">{error}</p>}
    {editor && <section className="structure-editor">
      <input className="draft-title-input" value={editor.title} onChange={event => setEditor({ ...editor, title: event.target.value })} placeholder="方法标题，例如：反常识开场 → 真实案例 → 方法拆解" />
      <textarea className="draft-body-input" value={editor.steps} onChange={event => setEditor({ ...editor, steps: event.target.value })} placeholder={'每个步骤占一行，例如：\n反常识开场\n真实案例\n方法拆解\n评论区提问'} />
      <div className="structure-editor-row">
        <select value={editor.platform} onChange={event => setEditor({ ...editor, platform: event.target.value })} aria-label="平台">
          {structurePlatforms.map(name => <option value={name} key={name}>{name}</option>)}
        </select>
        <select value={editor.content_type} onChange={event => setEditor({ ...editor, content_type: event.target.value })} aria-label="方法分类">
          {methodCategories.map(name => <option value={name} key={name}>{name}</option>)}
        </select>
        <span className="chip-gap" />
        <button className="outline-action" onClick={() => setEditor(null)}>取消</button>
        <button className="primary-action" onClick={saveEditor}>保存方法 <Check size={14} /></button>
      </div>
    </section>}
    {loading ? <p className="empty-state">正在加载方法库...</p> : items.length ? listMode ? (
      <div className="structure-list">
        {items.map(item => <article className={expandedId === item.id ? 'structure-row expanded' : 'structure-row'} key={item.id}>
          <button className={item.favorite ? 'structure-fav active' : 'structure-fav'} onClick={() => toggleFavorite(item)} aria-label={item.favorite ? '取消收藏' : '收藏'}><Star size={14} fill={item.favorite ? 'currentColor' : 'none'} /></button>
          <div className="structure-main" onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>
            <h3>{item.title}</h3>
            <p>{methodCategoryOf(item)} · {item.platform} · {item.steps.length} 步 · 使用 {item.usage_count} 次{item.source_kind === 'research' ? ' · 研究沉淀' : ''}</p>
            {expandedId === item.id && renderDetail(item)}
          </div>
        </article>)}
      </div>
    ) : (
      <div className="structure-grid">
        {items.map(item => <article className="trend-card structure-card" key={item.id} onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>
          <div className="card-top"><span className="platform-tag douyin">{methodCategoryOf(item)}</span><button className={item.favorite ? 'structure-fav active' : 'structure-fav'} onClick={event => { event.stopPropagation(); toggleFavorite(item) }} aria-label={item.favorite ? '取消收藏' : '收藏'}><Star size={14} fill={item.favorite ? 'currentColor' : 'none'} /></button></div>
          <h3>{item.title}</h3>
          <p>{item.steps.join(' · ')}</p>
          {expandedId === item.id && renderDetail(item)}
          <div className="card-foot"><span>{item.platform} · 使用 {item.usage_count} 次</span><span className="structure-meta">{item.steps.length} 步</span></div>
        </article>)}
      </div>
    ) : <div className="structure-empty">
      <p className="empty-state">暂无匹配的方法。尝试清除筛选，或在「热点研究」中刷新并拆解爆款内容自动沉淀方法，也可以手动添加第一条方法。</p>
      <button className="outline-action" onClick={clearFilters}>清除搜索与筛选</button>
    </div>}
    {items.length > 0 && items.length < total && <button className="load-more" onClick={loadMore}>加载更多（已显示 {items.length} / {total} 条）</button>}
  </section>
}

type HotSearchItem = { rank: number; title: string; heat: number; platform: string }
type SimilarAccount = { nickname: string; followers: string; pillar: string; similarity: number; reason: string }

function ResearchLibrary({ focusedResearchId }: { focusedResearchId: number | null }) {
  const [items, setItems] = useState<ResearchItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [platform, setPlatform] = useState('')
  const [sort, setSort] = useState<'latest' | 'discussions' | 'growth' | 'fit'>('latest')
  const [openId, setOpenId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toggles, setToggles] = useState<SkillToggles>(loadSkillToggles)
  const [keyword, setKeyword] = useState('')
  const [skillPlatform, setSkillPlatform] = useState('小红书')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [skillBusy, setSkillBusy] = useState('')
  const [skillMessage, setSkillMessage] = useState('')
  const [skillError, setSkillError] = useState('')
  const [hotItems, setHotItems] = useState<HotSearchItem[]>([])
  const [hotSource, setHotSource] = useState('')
  const [hotPicked, setHotPicked] = useState<number[]>([])
  const [kwKeyword, setKwKeyword] = useState('')
  const [kwDays, setKwDays] = useState(7)
  const [kwItems, setKwItems] = useState<HotSearchItem[]>([])
  const [kwSource, setKwSource] = useState('')
  const [kwPicked, setKwPicked] = useState<string[]>([])
  const [similarAccount, setSimilarAccount] = useState('')
  const [similarItems, setSimilarItems] = useState<SimilarAccount[]>([])
  const [similarSource, setSimilarSource] = useState('')
  const rowRefs = useRef<Record<number, HTMLElement | null>>({})

  const buildParams = (overrides?: Record<string, string>) => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (platform) params.set('platform', platform)
    params.set('sort', sort)
    if (overrides) Object.entries(overrides).forEach(([key, value]) => params.set(key, value))
    return params
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true)
      void apiJson<{ items: ResearchItem[]; total: number }>(`/api/research?${buildParams().toString()}`)
        .then(result => { setItems(result.items); setTotal(result.total); setPage(1); setError('') })
        .catch(() => setError('加载研究数据失败，请稍后重试。'))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [query, platform, sort])

  useEffect(() => {
    void apiJson<{ suggestions: string[] }>('/api/research/suggest').then(result => setSuggestions(result.suggestions || [])).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (focusedResearchId === null || !items.some(item => item.id === focusedResearchId)) return
    setOpenId(focusedResearchId)
    window.requestAnimationFrame(() => {
      const row = rowRefs.current[focusedResearchId]
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      row?.focus({ preventScroll: true })
    })
  }, [focusedResearchId, items])

  const loadMore = () => {
    void apiJson<{ items: ResearchItem[]; total: number }>(`/api/research?${buildParams({ page: String(page + 1) }).toString()}`)
      .then(result => { setItems(current => [...current, ...result.items]); setTotal(result.total); setPage(page + 1); setError('') })
      .catch(() => setError('加载更多失败，请稍后重试。'))
  }

  const refreshResearch = () => {
    setBusy(true)
    void apiJson<{ items: ResearchItem[] }>('/api/research/refresh', { method: 'POST' })
      .then(() => apiJson<{ items: ResearchItem[]; total: number }>(`/api/research?${buildParams().toString()}`))
      .then(result => { setItems(result.items); setTotal(result.total); setPage(1); setError('') })
      .catch(() => setError('刷新研究失败，请稍后重试。'))
      .finally(() => setBusy(false))
  }

  const runSkill = (name: string, run: () => Promise<void>) => {
    setSkillBusy(name); setSkillError(''); setSkillMessage('')
    void run().catch(() => setSkillError('红狐 Skill 调用失败，请检查配置后重试。')).finally(() => setSkillBusy(''))
  }

  const searchKeyword = (word?: string) => {
    const target = (word ?? keyword).trim()
    if (!target) { setSkillError('请输入搜索关键词。'); return }
    runSkill('search', async () => {
      await apiJson<{ added: number; source: string }>(`/api/research/search`, { method: 'POST', body: JSON.stringify({ keyword: target, platform: skillPlatform }) })
        .then(result => setSkillMessage(`已按「${target}」抓取 ${result.added} 条研究（${result.source === 'demo' ? '演示数据' : '红狐真实数据'}）`))
      const result = await apiJson<{ items: ResearchItem[]; total: number }>(`/api/research?${buildParams().toString()}`)
      setItems(result.items); setTotal(result.total); setPage(1)
    })
  }

  const fetchHotSearch = () => runSkill('hotSearch', async () => {
    const result = await apiJson<{ items: HotSearchItem[]; source: string }>(`/api/research/hot-search`, { method: 'POST', body: JSON.stringify({ platform: skillPlatform }) })
    setHotItems(result.items || []); setHotSource(result.source === 'demo' ? '演示数据' : '红狐真实数据'); setHotPicked([])
  })

  const collectHot = () => runSkill('collect', async () => {
    const entries = hotItems.filter(item => hotPicked.includes(item.rank))
    await apiJson<{ added: number }>(`/api/research/hot-search/collect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries, platform: skillPlatform }) })
      .then(result => { setSkillMessage(`已将 ${result.added} 条热搜加入研究库`); setHotPicked([]) })
    const result = await apiJson<{ items: ResearchItem[]; total: number }>(`/api/research?${buildParams().toString()}`)
    setItems(result.items); setTotal(result.total); setPage(1)
  })

  const fetchKeywordHot = () => {
    if (!kwKeyword.trim()) { setSkillError('请输入要检索的关键词。'); return }
    runSkill('kwHot', async () => {
      const result = await apiJson<{ items: HotSearchItem[]; source: string }>(`/api/research/keyword-hot-search`, { method: 'POST', body: JSON.stringify({ keyword: kwKeyword.trim(), days: kwDays }) })
      setKwItems(result.items || []); setKwSource(result.source === 'demo' ? '演示数据' : '红狐真实数据'); setKwPicked([])
    })
  }

  const collectKeywordHot = () => runSkill('kwCollect', async () => {
    const entries = kwItems.filter(item => kwPicked.includes(`${item.platform}#${item.rank}`))
    await apiJson<{ added: number }>(`/api/research/hot-search/collect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries, platform: skillPlatform }) })
      .then(result => { setSkillMessage(`已将 ${result.added} 条关键词热搜加入研究库`); setKwPicked([]) })
    const result = await apiJson<{ items: ResearchItem[]; total: number }>(`/api/research?${buildParams().toString()}`)
    setItems(result.items); setTotal(result.total); setPage(1)
  })

  const fetchSimilar = () => {
    if (!similarAccount.trim()) { setSkillError('请输入要研究的账号名称。'); return }
    runSkill('similar', async () => {
      const result = await apiJson<{ items: SimilarAccount[]; source: string }>(`/api/research/similar`, { method: 'POST', body: JSON.stringify({ account: similarAccount.trim(), platform: skillPlatform }) })
      setSimilarItems(result.items || []); setSimilarSource(result.source === 'demo' ? '演示数据' : '红狐真实数据')
    })
  }

  const updateToggle = (key: keyof SkillToggles) => {
    const next = { ...toggles, [key]: !toggles[key] }
    setToggles(next); saveSkillToggles(next)
  }

  const collectResearch = (item: ResearchItem) => {
    setSkillBusy(`collect-${item.id}`); setError('')
    void apiJson<{ duplicate?: boolean }>('/api/research/' + item.id + '/collect', { method: 'POST' })
      .then(result => {
        setItems(current => current.map(currentItem => currentItem.id === item.id ? { ...currentItem, collected: true } : currentItem))
        setSkillMessage(result.duplicate ? '这条研究已经收录为素材。' : '已收录为热点素材，可在素材库追溯来源。')
      })
      .catch(() => setError('收录素材失败，请稍后重试。'))
      .finally(() => setSkillBusy(''))
  }

  const clearFilters = () => { setQuery(''); setPlatform('') }

  return <section className="workspace-view"><div className="workspace-view-head"><div><span className="section-kicker">WORKSPACE / RESEARCH PULSE</span><h2>研究脉搏</h2><p>围绕定位和 IP 核心目标，沉淀可追溯的内容资产。</p></div><button className="primary-action" onClick={refreshResearch}>{busy ? '刷新中...' : '刷新研究'} <Radio size={15} /></button></div><div className="structure-library">
    <div className="skill-directory">
      <div className="skill-directory-head"><h3>红狐 Skill 目录</h3><span className="skill-source-tag">演示数据可用，配置红狐 Key 后自动切换真实数据</span></div>
      <div className="skill-cards">
        <article className="skill-card"><h4>关键词搜索</h4><p>默认能力 · 按关键词抓取爆款内容进研究库</p></article>
        <article className={toggles.hotSearch ? 'skill-card active' : 'skill-card'}><h4>热搜榜</h4><p>抓取平台热榜，一键加入研究库</p><button className={toggles.hotSearch ? 'chip active' : 'chip'} onClick={() => updateToggle('hotSearch')}>{toggles.hotSearch ? '已启用' : '已停用'}</button></article>
        <article className={toggles.keywordHotSearch ? 'skill-card active' : 'skill-card'}><h4>关键词热搜</h4><p>跨平台全网检索包含关键词的热搜条目</p><button className={toggles.keywordHotSearch ? 'chip active' : 'chip'} onClick={() => updateToggle('keywordHotSearch')}>{toggles.keywordHotSearch ? '已启用' : '已停用'}</button></article>
        <article className={toggles.compliance ? 'skill-card active' : 'skill-card'}><h4>违禁词检测</h4><p>发布前扫描草稿中的风险表述</p><button className={toggles.compliance ? 'chip active' : 'chip'} onClick={() => updateToggle('compliance')}>{toggles.compliance ? '已启用' : '已停用'}</button></article>
        <article className={toggles.similarAccounts ? 'skill-card active' : 'skill-card'}><h4>相似账号对标</h4><p>找到同赛道账号，拆解内容支柱</p><button className={toggles.similarAccounts ? 'chip active' : 'chip'} onClick={() => updateToggle('similarAccounts')}>{toggles.similarAccounts ? '已启用' : '已停用'}</button></article>
      </div>
    </div>
    <div className="skill-panel">
      <div className="skill-panel-row">
        <div className="skill-search"><Search size={15} /><input value={keyword} onChange={event => setKeyword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') searchKeyword() }} placeholder="输入关键词，搜索爆款内容..." aria-label="红狐关键词搜索" /></div>
        <select className="structure-sort" value={skillPlatform} onChange={event => setSkillPlatform(event.target.value)} aria-label="Skill 平台">
          {allResearchPlatforms.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <button className="primary-action" disabled={skillBusy === 'search'} onClick={() => searchKeyword()}>{skillBusy === 'search' ? '搜索中...' : '搜索入库'}</button>
      </div>
      {suggestions.length > 0 && <div className="skill-suggest"><span>推荐关键词：</span>{suggestions.map(word => <button key={word} className="chip" onClick={() => { setKeyword(word); searchKeyword(word) }}>{word}</button>)}</div>}
      {toggles.hotSearch && <div className="skill-block">
        <div className="skill-block-head"><strong>热搜榜</strong><button className="outline-action" disabled={skillBusy === 'hotSearch'} onClick={fetchHotSearch}>{skillBusy === 'hotSearch' ? '抓取中...' : `抓取${skillPlatform}热榜`}</button>{hotSource && <span className="skill-source-tag">{hotSource}</span>}</div>
        {hotItems.length > 0 && <div className="hot-list">
          {hotItems.map(item => <label className="hot-row" key={item.rank}>
            <input type="checkbox" checked={hotPicked.includes(item.rank)} onChange={event => setHotPicked(current => event.target.checked ? [...current, item.rank] : current.filter(rank => rank !== item.rank))} />
            <span className="hot-rank">#{item.rank}</span><span className="hot-title">{item.title}</span><span className="hot-heat">{item.heat}</span>
          </label>)}
          {hotPicked.length > 0 && <button className="primary-action" disabled={skillBusy === 'collect'} onClick={collectHot}>加入研究库（{hotPicked.length} 条）</button>}
        </div>}
      </div>}
      {toggles.keywordHotSearch && <div className="skill-block">
        <div className="skill-block-head"><strong>关键词热搜</strong>
          <input className="skill-account-input" value={kwKeyword} onChange={event => setKwKeyword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') fetchKeywordHot() }} placeholder="关键词，例如：副业" aria-label="关键词热搜关键词" />
          <select className="structure-sort" value={kwDays} onChange={event => setKwDays(Number(event.target.value))} aria-label="检索时间范围">
            <option value={3}>近 3 天</option><option value={7}>近 7 天</option><option value={14}>近 14 天</option><option value={30}>近 30 天</option>
          </select>
          <button className="outline-action" disabled={skillBusy === 'kwHot'} onClick={fetchKeywordHot}>{skillBusy === 'kwHot' ? '检索中...' : '全网检索'}</button>
          {kwSource && <span className="skill-source-tag">{kwSource}</span>}
        </div>
        {kwItems.length > 0 && <div className="hot-list">
          {kwItems.map(item => { const pickedKey = `${item.platform}#${item.rank}`; return <label className="hot-row" key={pickedKey}>
            <input type="checkbox" checked={kwPicked.includes(pickedKey)} onChange={event => setKwPicked(current => event.target.checked ? [...current, pickedKey] : current.filter(key => key !== pickedKey))} />
            <span className="hot-rank">#{item.rank}</span><span className="hot-title">{item.title}</span><span className="hot-heat">{item.heat}</span>
          </label> })}
          {kwPicked.length > 0 && <button className="primary-action" disabled={skillBusy === 'kwCollect'} onClick={collectKeywordHot}>加入研究库（{kwPicked.length} 条）</button>}
        </div>}
      </div>}
      {toggles.similarAccounts && <div className="skill-block">
        <div className="skill-block-head"><strong>相似账号对标</strong>
          <input className="skill-account-input" value={similarAccount} onChange={event => setSimilarAccount(event.target.value)} placeholder="输入账号名称，例如：某某聊IP" aria-label="对标账号" />
          <button className="outline-action" disabled={skillBusy === 'similar'} onClick={fetchSimilar}>{skillBusy === 'similar' ? '研究中...' : '找对标'}</button>
          {similarSource && <span className="skill-source-tag">{similarSource}</span>}
        </div>
        {similarItems.length > 0 && <div className="similar-list">
          {similarItems.map(item => <article className="similar-card" key={item.nickname}>
            <div className="similar-card-head"><strong>{item.nickname}</strong><span>粉丝 {item.followers} · 相似度 {Math.round(item.similarity * 100)}%</span></div>
            <p>内容支柱：{item.pillar || '待补充'}</p><small>{item.reason}</small>
          </article>)}
        </div>}
      </div>}
      {skillMessage && <p className="skill-message">{skillMessage}</p>}
      {skillError && <p className="skill-error" role="alert">{skillError}</p>}
    </div>
    <div className="structure-toolbar-row">
      <div className="structure-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题或作者..." aria-label="搜索研究" /></div>
      <select className="structure-sort" value={sort} onChange={event => setSort(event.target.value as 'latest' | 'discussions' | 'growth' | 'fit')} aria-label="排序方式">
        <option value="latest">最新捕获</option>
        <option value="fit">定位匹配度</option>
        <option value="discussions">讨论最多</option>
        <option value="growth">增长最快</option>
      </select>
    </div>
    <div className="structure-toolbar-row">
      <span className="filter-label">平台</span>
      <button className={platform === '' ? 'chip active' : 'chip'} onClick={() => setPlatform('')}>全部平台</button>
      {allResearchPlatforms.map(name => <button className={platform === name ? 'chip active' : 'chip'} onClick={() => setPlatform(platform === name ? '' : name)} key={name}>{name}</button>)}
      <span className="chip-gap" />
      <span className="structure-meta">{loading ? '加载中...' : `${total} 条研究`}</span>
    </div>
    {error && <p className="structure-error" role="alert">{error}</p>}
    {loading ? <p className="empty-state">正在加载研究数据...</p> : items.length ? <div className="asset-list research-card-grid">
      {items.map(item => <article className={openId === item.id ? 'asset-row research-row-focused' : 'asset-row'} key={item.id} ref={element => { rowRefs.current[item.id] = element }} tabIndex={-1}>
        <span className={`platform-tag ${item.platform === '小红书' ? 'xhs' : item.platform === '公众号' ? 'wechat' : item.platform === '抖音' ? 'douyin' : ''}`}>{item.platform}</span>{item.fit && <span className="fit-chip" title={item.fit.matched.length ? `匹配：${item.fit.matched.join('、')}` : '与定位暂无直接关联'}>匹配 {item.fit.score}</span>}
        <div>
          <h3>{item.title}</h3>
          <p>{item.author || 'RedFox 研究库'} · 讨论 {item.metrics?.discussions || 0} · 增长 {item.metrics?.growth || 0}%</p>
          {openId === item.id && <div className="research-detail"><strong>爆款方法拆解</strong>{item.analysis?.structure?.length ? <span className="history-list">{item.analysis.structure.map((step, index) => <span key={`${item.id}-${index}`}>{step}</span>)}</span> : <small>暂无拆解方法。可先在爆款方法库中查看可复用框架，或等待刷新研究后重新生成。</small>}<div className="research-collect-row">{item.url && <a href={item.url} target="_blank" rel="noreferrer">打开原链接</a>}<button className="outline-action" disabled={item.collected || skillBusy === `collect-${item.id}`} onClick={() => collectResearch(item)}>{item.collected ? '已收录为素材' : skillBusy === `collect-${item.id}` ? '收录中...' : '收录为素材'}</button></div></div>}
        </div>
        <button className="row-arrow" onClick={() => setOpenId(openId === item.id ? null : item.id)} aria-label={openId === item.id ? '收起拆解' : '查看拆解'}><ArrowUpRight size={17} /></button>
      </article>)}
    </div> : <div className="structure-empty">
      <p className="empty-state">暂无匹配的研究条目。尝试清除筛选，或刷新研究获取最新热点。</p>
      <button className="outline-action" onClick={clearFilters}>清除搜索与筛选</button>
    </div>}
    {items.length > 0 && items.length < total && <button className="load-more" onClick={loadMore}>加载更多（已显示 {items.length} / {total} 条）</button>}
  </div></section>
}

function ComposePanel({ onGenerated }: { onGenerated: (drafts: DraftItem[]) => void }) {
  const [structures, setStructures] = useState<StructureItem[]>([])
  const [quotes, setQuotes] = useState<MaterialItem[]>([])
  const [experiences, setExperiences] = useState<MaterialItem[]>([])
  const [title, setTitle] = useState('')
  const [structureId, setStructureId] = useState('')
  const [quoteIds, setQuoteIds] = useState<number[]>([])
  const [experienceIds, setExperienceIds] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void apiJson<{ items: StructureItem[] }>('/api/structures?page=1').then(result => setStructures(result.items || [])).catch(() => undefined)
    void apiJson<{ items: MaterialItem[] }>('/api/materials?kind=quote&page=1').then(result => setQuotes(result.items || [])).catch(() => undefined)
    void apiJson<{ items: MaterialItem[] }>('/api/materials?kind=experience&page=1').then(result => setExperiences(result.items || [])).catch(() => undefined)
  }, [])

  const toggle = (list: number[], id: number) => list.includes(id) ? list.filter(item => item !== id) : [...list, id]

  const generate = () => {
    if (!title.trim() && !structureId) { setError('填写选题标题，或选择一个爆款方法。'); return }
    setBusy(true); setError('')
    const structure = structures.find(item => String(item.id) === structureId)
    const anchorTitle = title.trim() || structure?.title || ''
    void apiJson<DraftItem[]>('/api/drafts/generate', { method: 'POST', body: JSON.stringify({ topic: { title: anchorTitle, strategy_layer: 'trust', goal_refs: [] }, ...(structureId ? { structure_id: Number(structureId) } : {}), quote_ids: quoteIds, experience_ids: experienceIds }) })
      .then(result => { onGenerated(result); setTitle(''); setStructureId(''); setQuoteIds([]); setExperienceIds([]) })
      .catch(() => setError('生成失败，请稍后重试。'))
      .finally(() => setBusy(false))
  }

  return <div className="compose-panel">
    <div className="compose-panel-head"><h3>组合生成</h3><span>热点主题 + 个人经历 + 爆款方法 + 金句，一次组装成四平台草稿</span></div>
    <div className="compose-row">
      <input value={title} onChange={event => setTitle(event.target.value)} placeholder="选题标题，例如：结合最近的某个热点，说说你自己的经历…" aria-label="选题标题" />
      <select value={structureId} onChange={event => setStructureId(event.target.value)} aria-label="爆款方法">
        <option value="">选择爆款方法（可选）</option>
        {structures.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
    </div>
    <div className="compose-row">
      <span className="filter-label">金句</span>
      {quotes.length ? quotes.map(item => <button className={quoteIds.includes(item.id) ? 'chip active' : 'chip'} onClick={() => setQuoteIds(current => toggle(current, item.id))} key={item.id}>{item.name}</button>) : <span className="compose-hint">素材库暂无金句，可在素材库从文章一键收录。</span>}
    </div>
    <div className="compose-row">
      <span className="filter-label">经历</span>
      {experiences.length ? experiences.map(item => <button className={experienceIds.includes(item.id) ? 'chip active' : 'chip'} onClick={() => setExperienceIds(current => toggle(current, item.id))} key={item.id}>{item.name}</button>) : <span className="compose-hint">素材库暂无经历素材，可手动新建几条"我的经历"。</span>}
    </div>
    {error && <p className="structure-error" role="alert">{error}</p>}
    <div className="compose-actions"><button className="primary-action" disabled={busy} onClick={generate}>{busy ? '生成中...' : '生成四平台草稿'} <PenLine size={15} /></button></div>
  </div>
}

function DraftApprovalPanel({ draft, busy, dirty, onApprove, onRevoke, onOpenShooting }: { draft: DraftItem; busy: boolean; dirty: boolean; onApprove: () => void; onRevoke: () => void; onOpenShooting: () => void }) {
  const approval = draft.approval
  const approved = approval?.status === 'approved' && draft.workflow_status === 'ready_to_shoot'
  const revoked = approval?.status === 'revoked'
  const publishReady = draft.checks?.publish_checklist?.status === 'passed' && draft.checks.publish_checklist.draft_version === draft.version && draft.fact_check_status === 'verified'
  if (approved) return <div className="draft-approval approved"><div><strong>已确认进入拍摄</strong><small>确认人：{approval.user_id || '当前用户'} · {approval.approved_at ? new Date(approval.approved_at).toLocaleString() : '时间待同步'}</small></div><div><button className="outline-action" onClick={onOpenShooting}>查看今日拍摄</button><button className="outline-action danger" disabled={busy} onClick={onRevoke}>撤回确认</button></div></div>
  const hint = revoked ? '修改后需重新完成检查并确认。' : dirty ? '请先保存草稿，再确认进入拍摄。' : draft.fact_check_status !== 'verified' ? '请先标记事实已核验，并重新完成发布清单。' : !publishReady ? '发布清单通过后才能确认进入拍摄。' : '人工确认后将自动加入今日拍摄。'
  return <div className="draft-approval"><div><strong>{revoked ? `已撤回：${approval.revoke_reason || '需要修改'}` : '等待人工确认'}</strong><small>{hint}</small></div><button className="primary-action" disabled={busy || dirty || !publishReady} onClick={onApprove}>确认进入拍摄</button></div>
}

function WorkspaceView({ section, onNavigate, onOpenShooting, focusedResearchId }: { section: WorkspaceSection; onNavigate: (section: WorkspaceSection) => void; onOpenShooting: () => void; focusedResearchId: number | null }) {
  const [topics, setTopics] = useState<TopicItem[]>([])
  const [drafts, setDrafts] = useState<DraftItem[]>([])
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<Record<number, DraftItem[]>>({})
  const [compliance, setCompliance] = useState<Record<number, ComplianceResult>>({})
  const [complianceBusy, setComplianceBusy] = useState<number | null>(null)
  const [deaiBusy, setDeaiBusy] = useState<number | null>(null)
  const [deaiResults, setDeaiResults] = useState<Record<number, string>>({})
  const [topicError, setTopicError] = useState('')
  const [dirtyDrafts, setDirtyDrafts] = useState<Set<number>>(() => new Set())
  useEffect(() => {
    void apiJson<DraftItem[]>('/api/drafts').then(setDrafts).catch(() => undefined)
  }, [])
  const copyDraft = (draft: DraftItem) => { setBusy(true); void apiJson<DraftItem>(`/api/drafts/${draft.id}/copy`, { method: 'POST' }).then(copy => setDrafts(current => [copy, ...current])).catch(() => undefined).finally(() => setBusy(false)) }
  const loadHistory = (draft: DraftItem) => { void apiJson<DraftItem[]>(`/api/drafts/${draft.id}/history`).then(items => setHistory(current => ({ ...current, [draft.id]: items }))).catch(() => undefined) }
  const restoreDraft = (draft: DraftItem, version: number) => { setBusy(true); void apiJson<DraftItem>(`/api/drafts/${draft.id}/restore`, { method: 'POST', body: JSON.stringify({ version }) }).then(updated => { setDrafts(current => current.map(item => item.id === updated.id ? updated : item)); setHistory(current => ({ ...current, [draft.id]: updated.history || [] })) }).catch(() => undefined).finally(() => setBusy(false)) }
  const checkCompliance = (draft: DraftItem) => {
    setComplianceBusy(draft.id)
    void apiJson<ComplianceResult>(`/api/drafts/${draft.id}/compliance`, { method: 'POST', body: JSON.stringify({}) })
      .then(result => setCompliance(current => ({ ...current, [draft.id]: result })))
      .catch(() => setCompliance(current => ({ ...current, [draft.id]: { hits: [], source: 'error', checked_length: 0 } })))
      .finally(() => setComplianceBusy(null))
  }
  const generateHooks = (draft: DraftItem) => { setBusy(true); void apiJson<DraftItem>(`/api/drafts/${draft.id}/hooks`, { method: 'POST', body: JSON.stringify({}) }).then(updated => setDrafts(current => current.map(item => item.id === updated.id ? updated : item))).catch(() => undefined).finally(() => setBusy(false)) }
  const runDraftCheck = (draft: DraftItem, check: 'persona' | 'quality' | 'publish', force = false) => { setBusy(true); void apiJson<DraftItem>(`/api/drafts/${draft.id}/checks/${check}`, { method: 'POST', body: JSON.stringify({ force }) }).then(updated => setDrafts(current => current.map(item => item.id === updated.id ? updated : item))).catch(() => undefined).finally(() => setBusy(false)) }
  const selectDraftHook = (draft: DraftItem, hook: DraftHook) => { setBusy(true); void apiJson<DraftItem>(`/api/drafts/${draft.id}`, { method: 'PUT', body: JSON.stringify({ selected_hook_id: hook.id, version: draft.version }) }).then(updated => setDrafts(current => current.map(item => item.id === updated.id ? updated : item))).catch(() => undefined).finally(() => setBusy(false)) }
  if (section === 'IP 档案') return <ProfileReviewPanel />
  const generateTopics = () => {
    setTopicError('')
    setBusy(true)
    void Promise.all([apiJson<ResearchItem[]>('/api/research'), apiJson<MaterialItem[]>('/api/materials')])
      .then(([research, materials]) => apiJson<TopicItem[]>('/api/topics/generate', { method: 'POST', body: JSON.stringify({ research_ids: research.slice(0, 3).map(item => item.id), material_ids: materials.slice(0, 3).map(item => item.id) }) }))
      .then(result => setTopics(result))
      .catch(error => {
        const apiError = error as Partial<ApiError>
        const payload = apiError.payload
        const missing = Array.isArray(payload?.missing_fields) ? payload.missing_fields.map(field => topicMissingFieldLabels[field] || field).join('、') : ''
        setTopicError([payload?.error, missing ? `还缺少：${missing}` : ''].filter(Boolean).join('；') || '选题生成失败，请稍后重试。')
      })
      .finally(() => setBusy(false))
  }
  const evaluateTopicItem = (topic: TopicItem) => { setBusy(true); void apiJson<TopicItem>(`/api/topics/${topic.id}/evaluate`, { method: 'POST', body: JSON.stringify({}) }).then(updated => setTopics(current => current.map(item => item.id === updated.id ? updated : item))).catch(() => undefined).finally(() => setBusy(false)) }
  const decideTopic = (topic: TopicItem, decision: 'do' | 'revise' | 'defer') => { setBusy(true); void apiJson<TopicItem>(`/api/topics/${topic.id}/decision`, { method: 'PUT', body: JSON.stringify({ decision }) }).then(updated => setTopics(current => current.map(item => item.id === updated.id ? updated : item))).catch(() => undefined).finally(() => setBusy(false)) }
  const generateDrafts = (topic: TopicItem) => { if (topic.workflow_status !== 'approved') return; setBusy(true); void apiJson<DraftItem[]>('/api/drafts/generate', { method: 'POST', body: JSON.stringify({ topic_id: topic.id }) }).then(result => setDrafts(current => [...result, ...current])).catch(() => undefined).finally(() => setBusy(false)) }
  const useStructure = (structure: StructureItem) => { setBusy(true); void apiJson<DraftItem[]>('/api/drafts/generate', { method: 'POST', body: JSON.stringify({ structure_id: structure.id, topic: { title: structure.title, strategy_layer: 'trust', goal_refs: [] } }) }).then(() => onNavigate('内容创作')).catch(() => undefined).finally(() => setBusy(false)) }
  const deaiDraft = (draft: DraftItem) => { setDeaiBusy(draft.id); void apiJson<{ content: string }>(`/api/drafts/${draft.id}/deai`, { method: 'POST', body: '{}' }).then(result => setDeaiResults(current => ({ ...current, [draft.id]: result.content }))).catch(() => undefined).finally(() => setDeaiBusy(null)) }
  const updateDraft = (draft: DraftItem, patch: Partial<DraftItem>) => { setBusy(true); void apiJson<DraftItem>(`/api/drafts/${draft.id}`, { method: 'PUT', body: JSON.stringify({ ...patch, version: draft.version }) }).then(updated => { setDrafts(current => current.map(item => item.id === updated.id ? updated : item)); setDirtyDrafts(current => { const next = new Set(current); next.delete(draft.id); return next }) }).catch(() => undefined).finally(() => setBusy(false)) }
  const approveDraft = (draft: DraftItem) => { setBusy(true); void apiJson<DraftApprovalResponse>(`/api/drafts/${draft.id}/approve`, { method: 'POST', body: JSON.stringify({ version: draft.version }) }).then(result => setDrafts(current => current.map(item => item.id === result.draft.id ? result.draft : item))).catch(() => undefined).finally(() => setBusy(false)) }
  const revokeDraftApproval = (draft: DraftItem) => { const reason = window.prompt('请输入撤回原因'); if (!reason?.trim()) return; setBusy(true); void apiJson<DraftApprovalResponse>(`/api/drafts/${draft.id}/revoke-approval`, { method: 'POST', body: JSON.stringify({ version: draft.version, reason: reason.trim() }) }).then(result => setDrafts(current => current.map(item => item.id === result.draft.id ? result.draft : item))).catch(() => undefined).finally(() => setBusy(false)) }
  if ((section as string) === '素材库') return <MaterialWorkspace />
  if (section === '热点研究') return <ResearchLibrary focusedResearchId={focusedResearchId} />
  if (section === '发布中心') return <PublishCenter />
  if (section === '内容日历') return <ContentCalendar />
  const heading = section === '爆款方法库' ? '爆款方法库' : section === '选题助手' ? '选题助手' : '内容创作'
  return <section className="workspace-view"><div className="workspace-view-head"><div><span className="section-kicker">WORKSPACE / {section.toUpperCase()}</span><h2>{heading}</h2><p>围绕定位和 IP 核心目标，沉淀可追溯的内容资产。</p></div>{section === '选题助手' && <button className="primary-action" onClick={generateTopics}>{busy ? '生成中...' : '生成选题'} <Sparkles size={15} /></button>}</div>{section === '选题助手' && topicError && <p className="structure-error" role="alert">{topicError}</p>}{section === '爆款方法库' && <StructureLibrary onUse={useStructure} />}{section === '选题助手' && <div className="asset-list">{topics.length ? topics.map(topic => { const evaluation = topic.evaluation; return <article className="asset-row topic-evaluation-card" key={topic.id}><div><h3>{topic.title}</h3><p>{topic.content_job} · {topic.rationale}</p>{evaluation ? <><div className="topic-score-row"><strong>{evaluation.score} 分</strong><span>{topicDecisionLabels[evaluation.decision]}</span><small>{topic.workflow_status === 'approved' ? '已确认进入创作' : topic.workflow_status === 'needs_revision' ? '等待调整后重新评估' : '已完成评估'}</small></div><div className="topic-dimensions">{Object.entries(evaluation.dimensions).map(([key, dimension]) => <span key={key}><b>{topicDimensionLabels[key] || key}</b><strong>{dimension.score}</strong></span>)}</div><details className="topic-evidence"><summary>查看评分证据与建议</summary><ul>{evaluation.evidence.map((item, index) => <li key={`${item.dimension}-${index}`}>{topicDimensionLabels[item.dimension] || item.dimension}：{item.message}</li>)}</ul>{evaluation.suggestions.length > 0 && <p>下一步：{evaluation.suggestions.join('；')}</p>}</details></> : <p className="topic-pending">尚未评估：先运行七维评估，再决定是否进入创作。</p>}</div><div className="topic-actions">{!evaluation && <button className="outline-action" disabled={busy} onClick={() => evaluateTopicItem(topic)}>七维评估</button>}{evaluation && topic.workflow_status === 'evaluated' && <><button className="outline-action" disabled={busy} onClick={() => decideTopic(topic, 'do')}>确认做</button><button className="outline-action" disabled={busy} onClick={() => decideTopic(topic, 'revise')}>调整方向</button><button className="outline-action" disabled={busy} onClick={() => decideTopic(topic, 'defer')}>暂缓</button></>}{evaluation && topic.workflow_status === 'approved' && <button className="outline-action" disabled={busy} onClick={() => generateDrafts(topic)}>生成草稿</button>}</div></article> }) : <div className="structure-empty"><p className="empty-state">选择生成选题，系统会从当前研究和素材中建立来源链路。</p></div>}</div>}{section === '内容创作' && <><ComposePanel onGenerated={result => setDrafts(current => [...result, ...current])} />{drafts.length ? <div className="draft-grid">{drafts.map(draft => <article className="trend-card draft-card" key={draft.id}><div className="card-top"><span className="platform-tag douyin">{draft.platform}</span><span className="draft-version">v{draft.version || 1}</span></div><input className="draft-title-input" value={draft.title} onChange={event => { setDrafts(current => current.map(item => item.id === draft.id ? { ...item, title: event.target.value } : item)); setDirtyDrafts(current => new Set(current).add(draft.id)) }} /><textarea className="draft-body-input" value={draft.body} onChange={event => { setDrafts(current => current.map(item => item.id === draft.id ? { ...item, body: event.target.value } : item)); setDirtyDrafts(current => new Set(current).add(draft.id)) }} />{draft.hooks?.length ? <div className="draft-hooks"><div className="draft-hooks-head"><span>Hook 候选</span><small>{draft.workflow_status === 'content_ready' ? '已选择，可继续修改正文' : '选择一个作为开头'}</small></div>{draft.hooks.map(hook => <button className={draft.selected_hook_id === hook.id ? 'hook-option selected' : 'hook-option'} disabled={busy || hook.validation.status !== 'passed'} onClick={() => selectDraftHook(draft, hook)} key={hook.id}><b>{hook.label}</b><span>{hook.text}</span></button>)}</div> : null}{draft.checks && <div className="draft-checks"><div className="draft-checks-head"><span>发布前检查</span><small>{draft.workflow_status || 'draft'}</small></div>{(['persona', 'quality', 'publish'] as const).map(check => { const key = check === 'publish' ? 'publish_checklist' : check; const item = draft.checks?.[key]; const current = item?.draft_version === draft.version; const personaReady = draft.checks?.persona?.draft_version === draft.version; const qualityReady = personaReady && draft.checks?.quality?.draft_version === draft.version && draft.checks?.quality?.status === 'passed'; const allowed = check === 'persona' || check === 'quality' ? (check === 'quality' ? personaReady : true) : qualityReady; const labels = { persona: '人设检查', quality: '质量门', publish: '发布清单' }; return <div className="draft-check" key={check}><div className="draft-check-top"><strong>{labels[check]}</strong><span className={item?.status || 'pending'}>{item && current ? draftCheckStatusLabels[item.status] || '待检查' : '待检查'}</span>{item?.score != null && <b>{item.score} 分</b>}</div><button className="outline-action" disabled={busy || !allowed} onClick={() => runDraftCheck(draft, check, Boolean(item && current))}>{item && current ? '重新检查' : check === 'quality' && !personaReady ? '先做人设检查' : check === 'publish' && !qualityReady ? '先通过质量门' : '开始检查'}</button>{item && current && item.evidence.length > 0 && <ul>{item.evidence.map((evidence, index) => <li key={`${evidence.code}-${index}`}>{evidence.message}</li>)}</ul>}{item && current && item.suggestions.length > 0 && <small className="draft-check-suggestions">建议：{item.suggestions.join('；')}</small>}</div> })}</div>}<DraftApprovalPanel draft={draft} busy={busy} dirty={dirtyDrafts.has(draft.id)} onApprove={() => approveDraft(draft)} onRevoke={() => revokeDraftApproval(draft)} onOpenShooting={onOpenShooting} /><div className="card-foot"><span>{draft.fact_check_status === 'verified' ? '事实已核验' : '事实待核验'}</span><div>{draft.fact_check_status !== 'verified' && <button className="outline-action" disabled={busy || dirtyDrafts.has(draft.id)} onClick={() => updateDraft(draft, { fact_check_status: 'verified' })}>标记已核验</button>}<button className="outline-action" onClick={() => updateDraft(draft, { title: draft.title, body: draft.body })}>{busy ? '保存中...' : '保存草稿'}</button></div></div>{history[draft.id] && <div className="history-list">{history[draft.id].map(item => <span key={`${draft.id}-${item.version}`}><small>v{item.version || 1}</small><button className="text-action" disabled={busy} onClick={() => restoreDraft(draft, item.version || 1)}>恢复</button></span>)}</div>}{compliance[draft.id] && <div className="compliance-result">{compliance[draft.id].source === 'error' ? <small role="alert">合规检查失败，请稍后重试。</small> : compliance[draft.id].hits.length ? compliance[draft.id].hits.map(hit => <span className="compliance-hit" key={hit.word}><strong>{hit.word}</strong><small>{hit.level} · {hit.suggestion}</small></span>) : <small>未检测到违禁词风险（{compliance[draft.id].source === 'demo' ? '演示词表' : '红狐词表'}）。</small>}</div>}<div className="draft-actions"><button className="outline-action" disabled={busy} onClick={() => generateHooks(draft)}>{draft.hooks?.length ? '重新生成 Hook' : '生成 Hook'}</button><button className="outline-action" onClick={() => loadHistory(draft)}>查看历史</button><button className="outline-action" disabled={complianceBusy === draft.id || !loadSkillToggles().compliance} onClick={() => checkCompliance(draft)}>{complianceBusy === draft.id ? '检测中...' : '合规检查'}</button><button className="outline-action" disabled={busy} onClick={() => copyDraft(draft)}>复制草稿</button><button className="outline-action" disabled={deaiBusy === draft.id} onClick={() => deaiDraft(draft)}>{deaiBusy === draft.id ? '改写中...' : '去 AI 感改写'}</button></div>{deaiResults[draft.id] && <div className="deai-result"><div className="draft-check-top"><strong>去 AI 感改写预览</strong><small>建议人工过目后再替换</small></div><p>{deaiResults[draft.id]}</p><div className="deai-actions"><button className="primary-action" disabled={busy} onClick={() => { updateDraft(draft, { body: deaiResults[draft.id] }); setDeaiResults(current => { const next = { ...current }; delete next[draft.id]; return next }) }}>替换正文</button><button className="skip-action" onClick={() => setDeaiResults(current => { const next = { ...current }; delete next[draft.id]; return next })}>放弃</button></div></div>}</article>)}</div> : <div className="structure-empty"><p className="empty-state">还没有草稿。用上方组合生成面板组装第一份文案，或去选题助手生成选题。</p></div>}</>}</section>
}

type ProfileReview = { id: string; status: string; extracted: Record<string, unknown>; source_refs?: unknown[] }
type ProfileHistory = { field: string; previous: unknown; next: unknown; created_at: string; changed_at?: string }
type ProfileDocument = { role?: string; audiences?: string[]; problems?: string[]; pillars?: string[]; viewpoints?: string[]; tone_preferences?: string[]; prohibited_patterns?: string[]; source_refs?: unknown[]; updated_at?: string; version?: number; history?: ProfileHistory[] }
type PositioningDocument = { role?: string; positioning_statement?: string; monetization_goals?: string[]; acquisition_goals?: string[]; other_goals?: string[]; source_refs?: unknown[]; updated_at?: string; version?: number; history?: ProfileHistory[] }
type EditableProfileField = { source: 'profile' | 'positioning'; key: string; label: string; list?: boolean }

const editableProfileFields: EditableProfileField[] = [
  { source: 'profile', key: 'audiences', label: '服务对象', list: true },
  { source: 'profile', key: 'problems', label: '主要问题', list: true },
  { source: 'profile', key: 'pillars', label: '内容支柱', list: true },
  { source: 'profile', key: 'viewpoints', label: '核心观点', list: true },
  { source: 'profile', key: 'tone_preferences', label: '表达风格', list: true },
  { source: 'profile', key: 'prohibited_patterns', label: '表达边界', list: true },
  { source: 'positioning', key: 'monetization_goals', label: '变现目标', list: true },
  { source: 'positioning', key: 'acquisition_goals', label: '获客路径', list: true },
]

const profileFieldName = new Map<string, string>([['role', '身份定位'], ['positioning_statement', '核心定位语'], ...editableProfileFields.map(field => [field.key, field.label] as [string, string])])

function profileValues(value: unknown) { return Array.isArray(value) ? value.map(String).join('、') : String(value || '待补充') }

function MaterialWorkspace() {
  const [materials, setMaterials] = useState<MaterialItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [format, setFormat] = useState('')
  const [status, setStatus] = useState('')
  const [reviewStatus, setReviewStatus] = useState('')
  const [sort, setSort] = useState<'latest' | 'name'>('latest')
  const [kind, setKind] = useState('')
  const [kindCounts, setKindCounts] = useState<Record<string, number>>({})
  const [showAtomForm, setShowAtomForm] = useState(false)
  const [atomKind, setAtomKind] = useState<MaterialKind>('quote')
  const [atomText, setAtomText] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refreshCounts = () => {
    void apiJson<{ kind_counts: Record<string, number> }>('/api/materials?kind_counts=1').then(result => setKindCounts(result.kind_counts || {})).catch(() => undefined)
  }

  useEffect(() => { refreshCounts() }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true)
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      if (format) params.set('format', format)
      if (status) params.set('status', status)
      if (reviewStatus) params.set('review_status', reviewStatus)
      if (kind) params.set('kind', kind)
      params.set('sort', sort)
      void apiJson<{ items: MaterialItem[]; total: number }>(`/api/materials?${params.toString()}`)
        .then(result => { setMaterials(result.items); setTotal(result.total); setPage(1); setError('') })
        .catch(() => setError('加载素材库失败，请稍后重试。'))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [query, format, status, reviewStatus, sort, kind])

  const loadMore = () => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (format) params.set('format', format)
    if (status) params.set('status', status)
    if (reviewStatus) params.set('review_status', reviewStatus)
    params.set('sort', sort)
    params.set('page', String(page + 1))
    void apiJson<{ items: MaterialItem[]; total: number }>(`/api/materials?${params.toString()}`)
      .then(result => { setMaterials(current => [...current, ...result.items]); setTotal(result.total); setPage(page + 1); setError('') })
      .catch(() => setError('加载更多失败，请稍后重试。'))
  }

  const upload = (file: File) => {
    setBusy(true)
    const reader = new FileReader()
    reader.onload = () => void apiJson<MaterialItem>('/api/materials/upload', { method: 'POST', body: JSON.stringify({ name: file.name, content: String(reader.result || '') }) }).then(item => { setMaterials(current => [item, ...current]); setTotal(current => current + 1); setError('') }).catch(() => setError('上传失败，请稍后重试。')).finally(() => setBusy(false))
    reader.onerror = () => setBusy(false)
    reader.readAsText(file)
  }

  const clearFilters = () => { setQuery(''); setFormat(''); setStatus(''); setReviewStatus(''); setKind('') }

  const collectAtom = (sourceId: number, atomKind: 'quote' | 'hotspot', text: string) => {
    setBusy(true)
    void apiJson<MaterialItem & { duplicate?: boolean }>('/api/materials/atoms', { method: 'POST', body: JSON.stringify({ source_id: sourceId, kind: atomKind, text }) })
      .then(item => {
        if (!item.duplicate && (!kind || kind === item.material_kind)) setMaterials(current => [item, ...current])
        setMaterials(current => current.map(src => src.id === sourceId ? { ...src, extracted_fields: { ...src.extracted_fields, collected: { ...src.extracted_fields?.collected, [atomKind]: [...(src.extracted_fields?.collected?.[atomKind] || []), text] } } } : src))
        refreshCounts()
      })
      .catch(() => setError('收录失败，请稍后重试。'))
      .finally(() => setBusy(false))
  }

  const createAtom = () => {
    if (!atomText.trim()) { setError('请输入素材内容。'); return }
    setBusy(true)
    void apiJson<MaterialItem>('/api/materials/atoms', { method: 'POST', body: JSON.stringify({ kind: atomKind, text: atomText.trim() }) })
      .then(item => { setMaterials(current => (!kind || kind === item.material_kind) ? [item, ...current] : current); setAtomText(''); setShowAtomForm(false); refreshCounts() })
      .catch(() => setError('新建素材失败，请稍后重试。'))
      .finally(() => setBusy(false))
  }

  const materialFormats = ['markdown', 'txt', 'pdf', 'word', 'excel', 'text']
  const materialStatuses = ['ready', 'failed']
  const materialReviews = ['pending', 'approved', 'rejected']

  return <section className="workspace-view"><div className="workspace-view-head"><div><span className="section-kicker">ASSET / MATERIAL LIBRARY</span><h2>素材库</h2><p>导入访谈、笔记和案例，系统会提取可复用的主题、金句和证据。</p></div><label className="primary-action upload-action">{busy ? '解析中...' : '上传素材'}<input type="file" hidden accept=".txt,.md,.json,.csv,.pdf,.doc,.docx" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) upload(file); event.currentTarget.value = '' }} /></label></div><div className="structure-library">
    <div className="structure-toolbar-row">
      <div className="structure-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索素材名称或正文内容..." aria-label="搜索素材" /></div>
      <select className="structure-sort" value={sort} onChange={event => setSort(event.target.value as 'latest' | 'name')} aria-label="排序方式">
        <option value="latest">最新导入</option>
        <option value="name">名称排序</option>
      </select>
    </div>
    <div className="structure-toolbar-row">
      <span className="filter-label">类型</span>
      <button className={kind === '' ? 'chip active' : 'chip'} onClick={() => setKind('')}>全部</button>
      {(['article', ...atomKindKeys] as MaterialKind[]).map(name => <button className={kind === name ? 'chip active' : 'chip'} onClick={() => setKind(kind === name ? '' : name)} key={name}>{materialKindLabels[name]}{kindCounts[name] ? ` · ${kindCounts[name]}` : ''}</button>)}
      <span className="chip-gap" />
      <button className="outline-action" onClick={() => setShowAtomForm(!showAtomForm)}>{showAtomForm ? '收起' : '手动新建'}</button>
    </div>
    {showAtomForm && <div className="atom-mini-form">
      <select value={atomKind} onChange={event => setAtomKind(event.target.value as MaterialKind)} aria-label="素材类型">
        {atomKindKeys.map(name => <option key={name} value={name}>{materialKindLabels[name]}</option>)}
      </select>
      <textarea value={atomText} onChange={event => setAtomText(event.target.value)} placeholder={atomKind === 'quote' ? '粘贴一条金句…' : atomKind === 'hotspot' ? '输入热点关键词或主题…' : atomKind === 'insight' ? '记录一个知识点或案例…' : '写下一段个人经历…'} />
      <button className="primary-action" disabled={busy} onClick={createAtom}>{busy ? '保存中...' : '保存素材'}</button>
    </div>}
    <div className="structure-toolbar-row">
      <span className="filter-label">格式</span>
      <button className={format === '' ? 'chip active' : 'chip'} onClick={() => setFormat('')}>全部格式</button>
      {materialFormats.map(name => <button className={format === name ? 'chip active' : 'chip'} onClick={() => setFormat(format === name ? '' : name)} key={name}>{name}</button>)}
      <span className="chip-gap" />
      <span className="structure-meta">{loading ? '加载中...' : `${total} 份素材`}</span>
    </div>
    <div className="structure-toolbar-row">
      <span className="filter-label">状态</span>
      {materialStatuses.map(name => <button className={status === name ? 'chip active' : 'chip'} onClick={() => setStatus(status === name ? '' : name)} key={name}>{name === 'ready' ? '解析成功' : '解析失败'}</button>)}
      <span className="chip-gap" />
      {materialReviews.map(name => <button className={reviewStatus === name ? 'chip active' : 'chip'} onClick={() => setReviewStatus(reviewStatus === name ? '' : name)} key={name}>{name === 'pending' ? '待核验' : name === 'approved' ? '已核验' : '已驳回'}</button>)}
    </div>
    {error && <p className="structure-error" role="alert">{error}</p>}
    {loading ? <p className="empty-state">正在加载素材库...</p> : materials.length ? <div className="asset-list">
      {materials.map(item => <article className="asset-row" key={item.id}>
        <span className={item.material_kind && item.material_kind !== 'article' ? `kind-tag kind-${item.material_kind}` : 'platform-tag wechat'}>{item.material_kind && item.material_kind !== 'article' ? materialKindLabels[item.material_kind] : item.format}</span>
        <div>
          <h3>{item.name}</h3>
          <p>{item.material_kind && item.material_kind !== 'article' ? <>来源：{item.origin_material_name || '手动创建'} · </> : null}状态：{item.status} · 核验：{item.review_status}{item.imported_at ? ` · 导入 ${new Date(item.imported_at).toLocaleDateString()}` : ''}</p>
          {expandedId === item.id && <div className="research-detail">
            {item.source_type === 'research' && <><strong>热点来源</strong><small>{item.research_platform || '未知平台'} · 讨论 {item.research_metrics?.discussions || 0} · 增长 {item.research_metrics?.growth || 0}% · 研究记录 #{item.source_id}</small>{item.url && <a href={item.url} target="_blank" rel="noreferrer">打开原链接</a>}</>}
            {item.source_type === 'local_sync' && <><strong>桌面同步来源</strong><small>{item.device_id || '未知设备'} · 相对路径 {item.source_path || '未记录'} · 同步状态 {item.status}</small></>}
            {item.extracted_fields?.quotes?.length ? <><strong>金句摘录</strong><span className="atom-collect-list">{item.extracted_fields.quotes.map((quote, index) => {
              const collected = item.extracted_fields?.collected?.quote?.includes(quote)
              return <span key={`${item.id}-quote-${index}`} className="atom-collect-item"><em>{quote}</em><button className={collected ? 'collected-mark' : 'outline-action'} disabled={collected || busy} onClick={() => collectAtom(item.id, 'quote', quote)}>{collected ? '已收录' : '收为素材'}</button></span>
            })}</span></> : null}
            {item.extracted_fields?.candidate_topics?.length ? <><strong>候选主题</strong><span className="atom-collect-list">{item.extracted_fields.candidate_topics.map((topic, index) => {
              const collected = item.extracted_fields?.collected?.hotspot?.includes(topic)
              return <span key={`${item.id}-topic-${index}`} className="atom-collect-item"><em>{topic}</em><button className={collected ? 'collected-mark' : 'outline-action'} disabled={collected || busy} onClick={() => collectAtom(item.id, 'hotspot', topic)}>{collected ? '已收录' : '收为素材'}</button></span>
            })}</span></> : null}
            {!item.extracted_fields?.candidate_topics?.length && !item.extracted_fields?.quotes?.length ? <small>暂无提取结果。解析失败的材料可补充正文后重试。</small> : null}
          </div>}
        </div>
        <button className="row-arrow" onClick={() => setExpandedId(expandedId === item.id ? null : item.id)} aria-label={expandedId === item.id ? '收起详情' : '查看提取结果'}><ArrowUpRight size={17} /></button>
      </article>)}
    </div> : <div className="structure-empty">
      <p className="empty-state">暂无匹配的素材。尝试清除筛选，或上传一份文本、文档开始建立内容证据库。</p>
      <button className="outline-action" onClick={clearFilters}>清除搜索与筛选</button>
    </div>}
    {materials.length > 0 && materials.length < total && <button className="load-more" onClick={loadMore}>加载更多（已显示 {materials.length} / {total} 份）</button>}
  </div></section>
}

type ComplianceResult = { hits: { word: string; level: string; suggestion: string }[]; source: string; checked_length: number }

function ProfileReviewPanel() {
  const [profile, setProfile] = useState<ProfileDocument | null>(null)
  const [positioning, setPositioning] = useState<PositioningDocument | null>(null)
  const [reviews, setReviews] = useState<ProfileReview[]>([])
  const [busy, setBusy] = useState(false)
  const [editingField, setEditingField] = useState('')
  const [editValue, setEditValue] = useState('')
  const [saveError, setSaveError] = useState('')
  useEffect(() => {
    void Promise.all([
      apiJson<ProfileDocument>('/api/profile'),
      apiJson<PositioningDocument>('/api/positioning'),
      apiJson<ProfileReview[]>('/api/profile/reviews'),
    ]).then(([nextProfile, nextPositioning, nextReviews]) => {
      setProfile(nextProfile)
      setPositioning(nextPositioning)
      setReviews(nextReviews)
    }).catch(() => setReviews([]))
  }, [])
  const review = (id: string, status: 'approved' | 'rejected') => {
    setBusy(true)
    void apiJson<ProfileReview>(`/api/profile/reviews/${id}`, { method: 'PUT', body: JSON.stringify({ status }) })
      .then(updated => setReviews(current => current.map(item => item.id === updated.id ? updated : item)))
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }
  const startEdit = (source: 'profile' | 'positioning', key: string, value: unknown) => {
    setEditingField(`${source}:${key}`)
    setEditValue(Array.isArray(value) ? value.join('\n') : String(value || ''))
    setSaveError('')
  }
  const saveField = (field: EditableProfileField) => {
    const text = editValue.trim()
    if (!text) { setSaveError('基础资料不能为空。'); return }
    const value = field.list ? text.split(/[\n、，,]+/).map(item => item.trim()).filter(Boolean) : text
    setBusy(true); setSaveError('')
    const endpoint = field.source === 'profile' ? '/api/profile' : '/api/positioning'
    void apiJson<ProfileDocument | PositioningDocument>(endpoint, { method: 'PUT', body: JSON.stringify({ [field.key]: value }) })
      .then(updated => {
        if (field.source === 'profile') setProfile(updated as ProfileDocument)
        else setPositioning(updated as PositioningDocument)
        setEditingField('')
      })
      .catch(() => setSaveError('保存失败，请稍后重试。'))
      .finally(() => setBusy(false))
  }
  const fieldEditor = (field: EditableProfileField, value: unknown, prominent = false) => {
    const id = `${field.source}:${field.key}`
    if (editingField === id) return <div className={`profile-field-editor${prominent ? ' prominent' : ''}`}>{field.list ? <textarea value={editValue} onChange={event => setEditValue(event.target.value)} aria-label={`编辑${field.label}`} /> : <input value={editValue} onChange={event => setEditValue(event.target.value)} aria-label={`编辑${field.label}`} />}<small>列表字段可每行填写一项。</small>{saveError && <span className="profile-save-error">{saveError}</span>}<div className="profile-edit-actions"><button className="skip-action" disabled={busy} onClick={() => { setEditingField(''); setSaveError('') }}>取消</button><button className="primary-action" disabled={busy} onClick={() => saveField(field)}>{busy ? '保存中...' : '保存'}</button></div></div>
    return <div className={`profile-field-value${prominent ? ' prominent' : ''}`}><div>{prominent ? <strong>{profileValues(value)}</strong> : <p>{profileValues(value)}</p>}</div><button className="profile-edit-button" aria-label={`编辑${field.label}`} onClick={() => startEdit(field.source, field.key, value)}><Pencil size={13} /> 编辑</button></div>
  }
  const pendingReviews = reviews.filter(item => item.status === 'pending')
  const history = [...(profile?.history || []), ...(positioning?.history || [])].sort((a, b) => String(b.created_at || b.changed_at || '').localeCompare(String(a.created_at || a.changed_at || ''))).slice(0, 8)
  return <section className="workspace-view">
    <div className="workspace-view-head"><div><span className="section-kicker">ASSET / IP PROFILE</span><h2>IP 档案</h2><p>基础资料直接用于内容生成；后续访谈、素材和外部资料以增量变更进入审核。</p></div></div>
    <section className="profile-base-panel"><div className="profile-panel-head"><div><span className="section-kicker">CONFIRMED BASE</span><h3>已确认基础档案</h3></div><span className="profile-status">已确认 · 可修改</span></div><div className="profile-identity"><div className="profile-identity-field"><span>身份定位</span>{fieldEditor({ source: 'profile', key: 'role', label: '身份定位' }, profile?.role || positioning?.role, true)}</div><div className="profile-identity-field"><span>核心定位语</span>{fieldEditor({ source: 'positioning', key: 'positioning_statement', label: '核心定位语' }, positioning?.positioning_statement, true)}</div></div><div className="profile-facts">{editableProfileFields.map(field => <div className="profile-fact" key={`${field.source}:${field.key}`}><span>{field.label}</span>{fieldEditor(field, field.source === 'profile' ? profile?.[field.key as keyof ProfileDocument] : positioning?.[field.key as keyof PositioningDocument])}</div>)}</div><small className="profile-source">来源：IP 定位档案 · {profile?.updated_at || positioning?.updated_at ? '已同步' : '初始化资料'} · 修改后立即用于内容生成</small>{history.length > 0 && <details className="profile-history"><summary>查看最近修改（{history.length}）</summary><div>{history.map((item, index) => <article key={`${item.created_at}-${item.field}-${index}`}><strong>{profileFieldName.get(item.field) || item.field}</strong><small>{new Date(item.created_at || item.changed_at || '').toLocaleString('zh-CN')}</small><p><del>{profileValues(item.previous)}</del><span>→</span><ins>{profileValues(item.next)}</ins></p></article>)}</div></details>}</section>
    <section className="profile-pending-panel"><div className="profile-panel-head"><div><span className="section-kicker">PENDING CHANGES</span><h3>待审核变更</h3></div><span className="profile-count">{pendingReviews.length} 条</span></div><div className="asset-list">{pendingReviews.length ? pendingReviews.map(item => <article className="asset-row" key={item.id}><div><h3>{String(item.extracted.role || item.extracted.title || '待审核档案片段')}</h3><p>{Object.entries(item.extracted).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join('、') : String(value)}`).join(' · ')}</p><small>来源引用 {item.source_refs?.length || 0} 条 · 当前状态 待审核</small></div><div className="row-actions"><button className="skip-action" disabled={busy} onClick={() => review(item.id, 'rejected')}>拒绝</button><button className="primary-action" disabled={busy} onClick={() => review(item.id, 'approved')}>通过审核</button></div></article>) : <p className="empty-state">暂无待审核变更。完成未来访谈或导入素材后，新的档案信息会出现在这里。</p>}</div></section>
  </section>
}

type ShootingItem = { id: number; draft_id?: number; title: string; platform: string; status: string; script?: string; font_size?: number; scroll_speed?: number; version?: number; published_at?: string | null }
type VisionCandidate = { resource_id: number; title: string; platform: string; published_at: string | null; match_reason: string; confidence: number }
type VisionTask = { id: string; shooting_id: number | null; screenshot_file_ids: string[]; status: string; result?: unknown; error?: string | null; candidates?: VisionCandidate[]; match_status?: string; confirmed_snapshot_id?: number }
type PerformanceSnapshot = { id: number; shooting_id: number; platform: string; published_at: string | null; captured_at: string; metrics: Record<string, number | null>; confidence: number | null; status: string; retrospect?: { verdict: string; summary: string; lessons: string[]; drivers: string[]; rate?: number | null; provider: string; created_at: string } }

const metricLabels: Record<string, string> = { views: '播放', likes: '点赞', comments: '评论', favorites: '收藏', shares: '转发', followers: '涨粉' }

function metricsFromVisionResult(result: unknown): Record<string, number | null> {
  let value = result
  if (typeof value === 'string') {
    try { value = JSON.parse(value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { return {} }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const source = record.metrics && typeof record.metrics === 'object' && !Array.isArray(record.metrics) ? record.metrics as Record<string, unknown> : record
  const aliases: Record<string, string> = { views: 'views', play_count: 'views', 播放量: 'views', likes: 'likes', 点赞: 'likes', comments: 'comments', 评论: 'comments', favorites: 'favorites', 收藏: 'favorites', shares: 'shares', 转发: 'shares', followers: 'followers', 涨粉: 'followers' }
  const metrics: Record<string, number | null> = {}
  for (const [key, raw] of Object.entries(source)) {
    const name = aliases[key]
    if (!name) continue
    if (raw === null || raw === '') metrics[name] = null
    else { const number = Number(String(raw).replace(/,/g, '')); if (Number.isFinite(number)) metrics[name] = number }
  }
  return metrics
}

function PerformanceTimeline({ shooting, refreshKey }: { shooting: ShootingItem; refreshKey: number }) {
  const [snapshots, setSnapshots] = useState<PerformanceSnapshot[]>([])
  const [retroBusy, setRetroBusy] = useState<number | null>(null)
  const [retroMessage, setRetroMessage] = useState('')
  useEffect(() => { void apiJson<PerformanceSnapshot[]>(`/api/performance-snapshots?shooting_id=${shooting.id}`).then(setSnapshots).catch(() => setSnapshots([])) }, [shooting.id, refreshKey])
  const retrospect = (snapshot: PerformanceSnapshot) => {
    setRetroBusy(snapshot.id); setRetroMessage('')
    void apiJson<{ snapshot: PerformanceSnapshot; memories_added: number }>(`/api/performance-snapshots/${snapshot.id}/retrospect`, { method: 'POST', body: '{}' })
      .then(result => {
        setSnapshots(current => current.map(item => item.id === result.snapshot.id ? result.snapshot : item))
        setRetroMessage(result.memories_added > 0 ? `复盘完成，已沉淀 ${result.memories_added} 条反馈记忆，下次创作自动应用。` : '复盘已更新。')
      })
      .catch((error: unknown) => setRetroMessage(error instanceof Error && error.message ? error.message : '复盘失败，请稍后重试。'))
      .finally(() => setRetroBusy(null))
  }
  if (!snapshots.length) return <p className="empty-state performance-empty">尚无已确认的表现记录。</p>
  return <details className="performance-timeline" open><summary>表现时间线 · {snapshots.length} 次记录</summary><div>{snapshots.map((snapshot, index) => {
    const previous = snapshots[index + 1]
    const days = snapshot.published_at ? Math.max(0, Math.floor((new Date(snapshot.captured_at).getTime() - new Date(snapshot.published_at).getTime()) / 86400000)) : null
    return <article key={snapshot.id}><div><strong>{days === null ? new Date(snapshot.captured_at).toLocaleDateString() : `发布后第 ${days + 1} 天`}</strong><small>{new Date(snapshot.captured_at).toLocaleString()} · {snapshot.platform}</small></div><div className="performance-metrics">{Object.entries(snapshot.metrics).map(([key, value]) => {
      const old = previous?.metrics[key]
      const delta = value !== null && typeof old === 'number' ? value - old : null
      return <span key={key}><small>{metricLabels[key] || key}</small><b>{value === null ? '未提供' : value.toLocaleString()}</b>{delta !== null && <i>{delta >= 0 ? '+' : ''}{delta.toLocaleString()}</i>}</span>
    })}</div>{snapshot.retrospect && <div className="retrospect-panel"><span className={`retrospect-verdict verdict-${snapshot.retrospect.verdict}`}>{snapshot.retrospect.verdict === 'winner' ? '优于往常' : snapshot.retrospect.verdict === 'underperformed' ? '低于往常' : '表现持平'}</span><p>{snapshot.retrospect.summary}</p>{snapshot.retrospect.lessons.length > 0 && <ul>{snapshot.retrospect.lessons.map((lesson, lessonIndex) => <li key={lessonIndex}>{lesson}</li>)}</ul>}<small>来源：{snapshot.retrospect.provider === 'builtin' ? '规则复盘' : '大模型复盘'}</small></div>}{Object.keys(snapshot.metrics).length > 0 && !snapshot.retrospect && <button className="outline-action" disabled={retroBusy === snapshot.id} onClick={() => retrospect(snapshot)}>{retroBusy === snapshot.id ? '复盘生成中...' : '生成复盘'}</button>}</article>
  })}{retroMessage && <p className="retro-message" role="status">{retroMessage}</p>}</div></details>
}

type CalendarEntry = { type: string; id: number; title: string; platform: string; status: string; date: string }

function PublishCenter() {
  const platforms = ['小红书', '抖音', '视频号', '公众号', 'B站', '快手', '今日头条', '微博', 'X']
  const [drafts, setDrafts] = useState<DraftItem[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [platform, setPlatform] = useState('小红书')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [confirmed, setConfirmed] = useState<string[]>([])

  useEffect(() => { void apiJson<DraftItem[]>('/api/drafts').then(items => { setDrafts(items); setSelectedId(current => current ?? (items[0]?.id ?? null)) }).catch(() => undefined) }, [])
  const selected = drafts.find(item => item.id === selectedId) || null
  const adaptation = selected?.adaptations?.[platform] || null

  const generate = () => {
    if (!selected) { setMessage('还没有草稿，先去内容创作生成文案。'); return }
    setBusy(true); setMessage(''); setConfirmed([])
    void apiJson<DraftItem>(`/api/drafts/${selected.id}/adapt`, { method: 'POST', body: JSON.stringify({ platform }) })
      .then(next => { setDrafts(current => current.map(item => item.id === next.id ? next : item)) })
      .catch((error: unknown) => setMessage(error instanceof Error && error.message ? error.message : '适配失败，请稍后重试。'))
      .finally(() => setBusy(false))
  }

  const copyVersion = () => {
    if (!adaptation) return
    const text = [adaptation.title, '', adaptation.body, adaptation.hashtags.length ? '\n' + adaptation.hashtags.join(' ') : ''].join('\n').trim()
    void navigator.clipboard?.writeText(text)
      .then(() => setMessage('已复制到剪贴板，去对应平台粘贴发布即可。'))
      .catch(() => setMessage('复制失败，请手动选择文本复制。'))
  }

  return <section className="workspace-view">
    <div className="workspace-view-head"><div><span className="section-kicker">PUBLISH / PUBLISHING CENTER</span><h2>发布中心</h2><p>一份母版，各平台自动适配格式与标签；发布前逐项确认，复制后去平台手动发布。</p></div></div>
    <div className="structure-toolbar-row">
      <select className="structure-sort" value={selectedId ?? ''} onChange={event => { setSelectedId(Number(event.target.value)); setConfirmed([]) }} aria-label="选择草稿">
        {drafts.length ? drafts.map(draft => <option key={draft.id} value={draft.id}>{draft.title || `草稿 #${draft.id}`}（{draft.platform}）</option>) : <option value="">暂无草稿</option>}
      </select>
      <div className="publish-platform-tabs">{platforms.map(name => <button key={name} className={platform === name ? 'chip active' : 'chip'} onClick={() => { setPlatform(name); setConfirmed([]) }}>{name}</button>)}</div>
      <button className="primary-action" disabled={busy} onClick={generate}>{busy ? '适配中...' : '生成本平台版本'}</button>
    </div>
    {adaptation ? <div className="publish-version">
      <div className="publish-version-head"><strong>{platform} 版本</strong><small>{adaptation.provider === 'builtin' ? '规则适配' : '大模型适配'} · {new Date(adaptation.updated_at).toLocaleString('zh-CN')}</small></div>
      <div className="publish-title">{adaptation.title}</div>
      <textarea className="publish-body" value={adaptation.body} readOnly rows={8} aria-label="平台正文" />
      {adaptation.hashtags.length > 0 && <div className="publish-tags">{adaptation.hashtags.map(tag => <span className="chip" key={tag}>{tag}</span>)}</div>}
      <div className="publish-checklist"><strong>发布前检查</strong>{adaptation.checklist.map(entry => <label className="publish-check-row" key={entry.item}>
        <input type="checkbox" checked={confirmed.includes(entry.item)} onChange={event => setConfirmed(current => event.target.checked ? [...current, entry.item] : current.filter(item => item !== entry.item))} />
        <span className={`publish-check-status status-${entry.status === '通过' ? 'pass' : entry.status === '风险' ? 'risk' : entry.status === '注意' ? 'warn' : 'todo'}`}>{entry.status}</span>
        <span>{entry.item}</span>{entry.detail && <small>{entry.detail}</small>}
      </label>)}</div>
      <div className="publish-actions"><button className="primary-action" onClick={copyVersion}>复制标题 + 正文 + 标签</button><small>{confirmed.length}/{adaptation.checklist.length} 项已确认</small></div>
    </div> : <div className="structure-empty"><p className="empty-state">{selected ? `还没生成「${platform}」版本，点击右上角“生成本平台版本”。` : '还没有草稿，先去内容创作生成文案。'}</p></div>}
    {message && <p className="skill-message" role="status">{message}</p>}
  </section>
}

function ContentCalendar() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [entries, setEntries] = useState<CalendarEntry[]>([])
  const [drafts, setDrafts] = useState<DraftItem[]>([])
  const [scheduleDates, setScheduleDates] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = (targetMonth: string) => {
    void apiJson<{ entries: CalendarEntry[] }>(`/api/calendar?month=${targetMonth}`).then(result => setEntries(result.entries || [])).catch(() => setEntries([]))
    void apiJson<DraftItem[]>('/api/drafts').then(setDrafts).catch(() => undefined)
  }
  useEffect(() => { load(month) }, [month])

  const shiftMonth = (delta: number) => {
    const [year, mon] = month.split('-').map(Number)
    const next = new Date(year, mon - 1 + delta, 1)
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
  }
  const [year, mon] = month.split('-').map(Number)
  const firstWeekday = (new Date(year, mon - 1, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, mon, 0).getDate()
  const byDate = new Map<string, CalendarEntry[]>()
  for (const entry of entries) { const list = byDate.get(entry.date) || []; list.push(entry); byDate.set(entry.date, list) }
  const typeLabels: Record<string, string> = { draft: '草稿', shooting: '拍摄', topic: '选题', published: '已发' }

  const schedule = (draft: DraftItem) => {
    const date = scheduleDates[draft.id]
    if (!date) { setMessage('请先选择日期。'); return }
    setBusy(true); setMessage('')
    void apiJson<DraftItem>(`/api/drafts/${draft.id}`, { method: 'PUT', body: JSON.stringify({ planned_date: date, version: draft.version }) })
      .then(() => { setMessage(`《${draft.title}》已排期到 ${date}`); load(month) })
      .catch(() => setMessage('排期失败，请稍后重试。'))
      .finally(() => setBusy(false))
  }

  const unscheduled = drafts.filter(draft => !draft.planned_date && draft.status !== 'published')

  return <section className="workspace-view">
    <div className="workspace-view-head"><div><span className="section-kicker">PLAN / CONTENT CALENDAR</span><h2>内容日历</h2><p>草稿、拍摄与已发内容集中排期，节奏一目了然。</p></div>
      <div className="calendar-nav"><button className="outline-action" onClick={() => shiftMonth(-1)}>上个月</button><strong>{year} 年 {mon} 月</strong><button className="outline-action" onClick={() => shiftMonth(1)}>下个月</button></div>
    </div>
    <div className="calendar-grid">
      {['一', '二', '三', '四', '五', '六', '日'].map(day => <div className="calendar-weekday" key={day}>{day}</div>)}
      {Array.from({ length: firstWeekday }, (_, index) => <div className="calendar-cell blank" key={`blank-${index}`} />)}
      {Array.from({ length: daysInMonth }, (_, index) => {
        const day = index + 1
        const date = `${month}-${String(day).padStart(2, '0')}`
        const dayEntries = byDate.get(date) || []
        return <div className={`calendar-cell${dayEntries.length ? ' has-entries' : ''}`} key={date}><span className="calendar-day">{day}</span>{dayEntries.map(entry => <span className={`calendar-chip chip-${entry.type}`} key={`${entry.type}-${entry.id}`} title={entry.title}>{typeLabels[entry.type] || entry.type} · {entry.title.slice(0, 10)}</span>)}</div>
      })}
    </div>
    <div className="calendar-legend"><span><i className="chip-draft" />草稿</span><span><i className="chip-shooting" />拍摄</span><span><i className="chip-topic" />选题</span></div>
    {unscheduled.length > 0 && <div className="calendar-schedule">
      <strong>待排期草稿</strong>
      {unscheduled.map(draft => <div className="calendar-schedule-row" key={draft.id}>
        <span>{draft.title || `草稿 #${draft.id}`}（{draft.platform}）</span>
        <input type="date" value={scheduleDates[draft.id] || ''} onChange={event => setScheduleDates(current => ({ ...current, [draft.id]: event.target.value }))} aria-label="排期日期" />
        <button className="outline-action" disabled={busy || !scheduleDates[draft.id]} onClick={() => schedule(draft)}>排期</button>
      </div>)}
    </div>}
    {message && <p className="skill-message" role="status">{message}</p>}
  </section>
}

function VisionConfirmationCard({ task, shooting, onChanged, onConfirmed }: { task: VisionTask; shooting: ShootingItem; onChanged: (task: VisionTask | null) => void; onConfirmed: () => void }) {
  const initial = metricsFromVisionResult(task.result)
  const [metrics, setMetrics] = useState<Record<string, string>>(() => Object.fromEntries(['views', 'likes', 'comments', 'favorites', 'shares'].map(key => [key, initial[key] == null ? '' : String(initial[key])])) )
  const [selected, setSelected] = useState(task.shooting_id || shooting.id)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!['ready', 'failed'].includes(task.status) || task.candidates?.length || task.match_status === 'unmatched') return
    void apiJson<VisionCandidate[]>(`/api/vision-tasks/${task.id}/matches`, { method: 'POST', body: JSON.stringify({ platform: shooting.platform, title: shooting.title, published_at: shooting.published_at }) }).then(candidates => onChanged({ ...task, candidates, match_status: candidates.length ? 'pending_confirmation' : 'unmatched' })).catch(() => setMessage('候选文案匹配失败，可稍后重试'))
  }, [task, shooting, onChanged])
  const uploadMore = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const ids = []
      for (const file of Array.from(files)) { const uploaded = await apiJson<{ id: string }>('/api/private-files', { method: 'POST', headers: { 'content-type': file.type, 'x-file-name': file.name }, body: await file.arrayBuffer() }); ids.push(uploaded.id) }
      onChanged(await apiJson<VisionTask>(`/api/vision-tasks/${task.id}/files`, { method: 'POST', body: JSON.stringify({ screenshot_file_ids: ids }) }))
    } catch { setMessage('补充截图失败') } finally { setBusy(false) }
  }
  const confirm = async () => {
    setBusy(true); setMessage('')
    try {
      const normalized = Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, value.trim() === '' ? null : Number(value.replace(/,/g, ''))]))
      if (Object.values(normalized).some(value => value !== null && !Number.isFinite(value))) throw new Error('指标必须是数字或留空')
      await apiJson(`/api/vision-tasks/${task.id}/confirm`, { method: 'POST', body: JSON.stringify({ shooting_id: selected, platform: shooting.platform, published_at: shooting.published_at, metrics: normalized, corrected_fields: Object.keys(metrics) }) })
      onConfirmed(); onChanged(null)
    } catch (error) { setMessage(error instanceof Error ? error.message : '确认失败') } finally { setBusy(false) }
  }
  const removeFile = (id: string) => void apiJson<VisionTask>(`/api/vision-tasks/${task.id}/files/${id}`, { method: 'DELETE' }).then(onChanged).catch(() => setMessage('删除截图失败'))
  const retry = () => { setBusy(true); void apiJson<VisionTask>(`/api/vision-tasks/${task.id}/retry`, { method: 'POST' }).then(onChanged).catch(() => setMessage('重试失败')).finally(() => setBusy(false)) }
  const removeTask = () => { if (!window.confirm('删除这次未确认的截图解析任务？')) return; void apiJson(`/api/vision-tasks/${task.id}`, { method: 'DELETE' }).then(() => onChanged(null)).catch(() => setMessage('删除任务失败')) }
  return <section className="vision-confirmation"><div className="vision-confirmation-head"><div><strong>{task.status === 'processing' ? '正在解析表现截图' : task.status === 'failed' ? '解析失败，可人工填写' : '待确认解析结果'}</strong><small>{task.error || (task.candidates?.[0] && task.candidates[0].confidence < .8 ? '匹配置信度较低，请核对文案' : '确认后才会写入正式表现')}</small></div>{task.status === 'failed' && <button className="outline-action" onClick={retry} disabled={busy}>重试解析</button>}</div>
    <div className="vision-previews">{task.screenshot_file_ids.map(id => <figure key={id}><img src={`/api/private-files/${id}/preview`} alt="表现截图预览" /><button onClick={() => removeFile(id)} aria-label="删除截图"><X size={13} /></button></figure>)}<label className="vision-add"><Plus size={16} /> 补充截图<input type="file" hidden multiple accept="image/png,image/jpeg,image/webp" onChange={event => { void uploadMore(event.target.files); event.currentTarget.value = '' }} /></label></div>
    {!!task.candidates?.length && <label className="vision-match">匹配文案<select value={selected} onChange={event => setSelected(Number(event.target.value))}>{task.candidates.map(candidate => <option value={candidate.resource_id} key={candidate.resource_id}>{candidate.title} · {Math.round(candidate.confidence * 100)}%</option>)}</select><small>{task.candidates.find(candidate => candidate.resource_id === selected)?.match_reason}</small></label>}
    <div className="vision-metrics">{Object.keys(metrics).map(key => <label key={key}><span>{metricLabels[key]}</span><input inputMode="numeric" value={metrics[key]} onChange={event => setMetrics(current => ({ ...current, [key]: event.target.value }))} placeholder="未提供" /></label>)}</div>
    {message && <p className="error-note" role="status">{message}</p>}<div className="vision-actions"><button className="skip-action" onClick={removeTask}>删除任务</button><button className="primary-action" onClick={() => void confirm()} disabled={busy || task.status === 'processing'}>{busy ? '处理中…' : '确认并存入表现'} <Check size={15} /></button></div>
  </section>
}

function ShootingWorkspace({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<ShootingItem[]>([])
  const [active, setActive] = useState<ShootingItem | null>(null)
  const [playing, setPlaying] = useState(false)
  const [fontSize, setFontSize] = useState(24)
  const [scrollSpeed, setScrollSpeed] = useState(3)
  const [visionBusy, setVisionBusy] = useState(false)
  const [visionMessage, setVisionMessage] = useState('')
  const [visionTasks, setVisionTasks] = useState<VisionTask[]>([])
  const [snapshotRefresh, setSnapshotRefresh] = useState(0)
  useEffect(() => { void apiJson<ShootingItem[]>('/api/shooting/today').then(setItems).catch(() => setItems([])) }, [])
  useEffect(() => {
    if (!active) { setVisionTasks([]); return }
    const refresh = () => void apiJson<VisionTask[]>(`/api/vision-tasks?shooting_id=${active.id}`).then(setVisionTasks).catch(() => setVisionTasks([]))
    refresh(); const timer = window.setInterval(refresh, 2000); return () => window.clearInterval(timer)
  }, [active?.id])
  const analyzeScreenshots = async (files: FileList | null) => {
    if (!active || !files?.length || visionBusy) return
    setVisionBusy(true); setVisionMessage('正在上传截图…')
    try {
      const ids: string[] = []
      for (const file of Array.from(files)) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('仅支持 PNG、JPEG 和 WebP 截图')
        const uploaded = await apiJson<{ id: string }>('/api/private-files', { method: 'POST', headers: { 'content-type': file.type, 'x-file-name': file.name }, body: await file.arrayBuffer() })
        ids.push(uploaded.id)
      }
      const task = await apiJson<VisionTask>('/api/vision-tasks', { method: 'POST', body: JSON.stringify({ screenshot_file_ids: ids, shooting_id: active.id }) })
      setVisionTasks(current => [task, ...current]); setVisionMessage(task.status === 'processing' ? '截图已提交，视觉解析进行中。' : `解析状态：${task.status}`)
    } catch (error) { setVisionMessage(error instanceof Error ? error.message : '截图解析失败') }
    finally { setVisionBusy(false) }
  }
  useEffect(() => {
    if (!active) return
    try {
      const saved = loadTeleprompterSettings(window.localStorage, String(active.id))
      if (saved.fontSize) setFontSize(saved.fontSize)
      if (saved.scrollSpeed) setScrollSpeed(saved.scrollSpeed)
      if (typeof saved.playing === 'boolean') setPlaying(saved.playing)
    } catch {
      localStorage.removeItem(`teleprompter:${active.id}`)
    }
  }, [active?.id])
  useEffect(() => {
    if (!active) return
    saveTeleprompterSettings(window.localStorage, String(active.id), { fontSize, scrollSpeed, playing })
  }, [active?.id, fontSize, scrollSpeed, playing])
  const update = (id: number, patch: Record<string, unknown>) => {
    void apiJson<ShootingItem>(`/api/shooting/${id}`, { method: 'PUT', body: JSON.stringify(patch) }).then(next => { setItems(current => current.map(item => item.id === id ? next : item)); setActive(next) }).catch(() => undefined)
  }
  return <section className="shoot-workspace"><div className="shoot-workspace-head"><div><span className="section-kicker">TODAY / SHOOTING DESK</span><h2>今日拍摄清单</h2><p>把准备好的内容，转成可以直接开拍的动作。</p></div><button className="close-review" onClick={onClose}><X size={16} /></button></div><div className="shoot-workspace-grid"><div className="shoot-items">{items.length ? items.map(item => <article className={active?.id === item.id ? 'shoot-item selected' : 'shoot-item'} key={item.id}><div><span className={`platform-tag ${item.platform === '小红书' ? 'xhs' : item.platform === '公众号' ? 'wechat' : 'douyin'}`}>{item.platform}</span><h3>{item.title}</h3></div><select value={item.status} onChange={event => update(item.id, { status: event.target.value })}><option value="ready_to_shoot">待拍摄</option><option value="in_progress">拍摄中</option><option value="completed">已完成</option></select><button className="row-arrow" onClick={() => { setActive(item); setFontSize(item.font_size || 24); setScrollSpeed(item.scroll_speed || 3) }}><ArrowUpRight size={17} /></button></article>) : <p className="empty-state">暂无待拍摄内容。先在内容创作中准备一条脚本。</p>}</div>{active && <div className="teleprompter"><div className="teleprompter-tools"><button onClick={() => setPlaying(!playing)}>{playing ? <Pause size={15} /> : <Play size={15} />} {playing ? '暂停' : '开始滚动'}</button><label>字号 <input type="range" min="16" max="42" value={fontSize} onChange={event => setFontSize(Number(event.target.value))} /></label><label>速度 <input type="range" min="1" max="8" value={scrollSpeed} onChange={event => setScrollSpeed(Number(event.target.value))} /></label><label className="outline-action">{visionBusy ? '上传中…' : '上传表现截图'}<input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => { void analyzeScreenshots(event.target.files); event.currentTarget.value = '' }} /></label></div>{visionMessage && <p className="error-note" role="status">{visionMessage}</p>}{visionTasks.filter(task => task.match_status !== 'confirmed').map(task => <VisionConfirmationCard key={task.id} task={task} shooting={active} onChanged={next => setVisionTasks(current => next ? current.map(item => item.id === next.id ? next : item) : current.filter(item => item.id !== task.id))} onConfirmed={() => setSnapshotRefresh(value => value + 1)} />)}<PerformanceTimeline shooting={active} refreshKey={snapshotRefresh} /><div className={playing ? 'teleprompter-script is-playing' : 'teleprompter-script'} style={{ fontSize }}><span>{active.platform} · 提词模式</span><h3>{active.title}</h3><p>{active.script || '脚本内容将在内容创作完成后显示。你可以先确认镜头节奏，再开始拍摄。'}</p></div><button className="primary-action" onClick={() => update(active.id, { status: active.status === 'completed' ? 'ready_to_shoot' : 'completed', font_size: fontSize, scroll_speed: scrollSpeed })}>{active.status === 'completed' ? '重新安排拍摄' : '标记为已完成'} <Check size={16} /></button></div>}</div></section>
}

function PasswordGate({ theme, font, onSuccess }: { theme: ThemeKey; font: FontKey; onSuccess: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = () => {
    if (busy || !username || !password) return
    setBusy(true); setError('')
    const request = window.desktopApp
      ? window.desktopApp.login(password)
      : mode === 'login'
        ? apiJson('/api/auth/session', { method: 'POST', body: JSON.stringify({ username, password }) })
        : apiJson('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) })
    void request
      .then(onSuccess)
      .catch((err: unknown) => setError(err instanceof Error && err.message ? err.message : '登录失败，请稍后重试。'))
      .finally(() => setBusy(false))
  }

  return <main className={`app theme-${theme} font-${font}`}><div className="password-gate"><div className="brand"><div className="brand-mark">定</div><div><strong>定位派</strong><span>个人 IP 内容成长平台</span></div></div><h1>{mode === 'login' ? '登录你的工作台' : '创建你的工作台'}</h1><p>{mode === 'login' ? '每位创作者的数据相互独立，登录后进入你自己的内容空间。' : '注册后你将拥有独立的数据空间，档案、素材与草稿只属于你。'}</p><form onSubmit={(event) => { event.preventDefault(); submit() }}><input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名（字母、数字、下划线或中划线）" autoFocus aria-label="用户名" autoComplete="username" /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'register' ? '密码（至少 8 位）' : '密码'} autoFocus={false} aria-label="密码" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} /><button className="primary-action" type="submit" disabled={busy || !username || !password}>{busy ? (mode === 'login' ? '登录中...' : '注册中...') : (mode === 'login' ? '进入工作台' : '注册并进入')} <ArrowUpRight size={16} /></button></form><button className="skip-action" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>{mode === 'login' ? '还没有账号？注册一个' : '已有账号？直接登录'}</button>{error && <p className="error-note" role="alert">{error}</p>}</div></main>
}

function Onboarding({ theme, setTheme, font, setFont, showThemes, setShowThemes, onEnter, onBack }: { theme: ThemeKey; setTheme: (theme: ThemeKey) => void; font: FontKey; setFont: (font: FontKey) => void; showThemes: boolean; setShowThemes: (value: boolean) => void; onEnter: () => void; onBack: () => void }) {
  const [round, setRound] = useState(0)
  const [answer, setAnswer] = useState('')
  const [monetizationGoal, setMonetizationGoal] = useState('')
  const [acquisitionGoal, setAcquisitionGoal] = useState('')
  const finished = round === interviewRounds.length
  const current = interviewRounds[Math.min(round, interviewRounds.length - 1)]
  const hints = ['可以说一段工作经历、一个长期爱好、一次转行或你反复解决的一类问题。', '请描述具体动作，例如“我能把复杂的菜谱改成新手能照做的步骤”。', '具体到身份和场景，例如“刚接手小店、每天不知道发什么内容的老板”。', '可以是省下时间、学会技能、做出作品，或获得一种新的视角。', '一个特殊行业、一条反常识经验或一种独有做法都可以。', '可以说作品照片、客户反馈、过程记录或真实前后变化。', '可以选择文字、视频、直播、教程、故事、测评或过程记录。', '变现可以是课程、服务、产品、咨询、合作或会员；目的也可以是获客、建立信任、招募伙伴或拓展机会。']
  const advance = () => {
    const interviewUpdate = round < interviewRounds.length - 1 && answer.trim()
      ? { interview_answers: { [round]: answer.trim() } }
      : {}
    if (round === interviewRounds.length - 1) {
      void apiJson('/api/positioning', {
        method: 'PUT',
        body: JSON.stringify({
          status: 'complete',
          monetization_goals: monetizationGoal ? [monetizationGoal] : [],
          acquisition_goals: acquisitionGoal ? [acquisitionGoal] : [],
          ...interviewUpdate,
        }),
      })
    } else if (Object.keys(interviewUpdate).length) {
      void apiJson('/api/positioning', { method: 'PUT', body: JSON.stringify(interviewUpdate) })
    }
    setAnswer(''); setMonetizationGoal(''); setAcquisitionGoal(''); setRound(round + 1)
  }
  return <main className={`app onboarding theme-${theme} font-${font}`}><header className="onboarding-top"><div className="brand"><div className="brand-mark">定</div><div><strong>定位派</strong><span>个人 IP 内容成长平台</span></div></div><div className="onboarding-actions"><button className="outline-action" onClick={onBack}><ArrowUpRight size={15} /> 返回工作台</button><div className="theme-picker"><button className="theme-trigger" onClick={() => setShowThemes(!showThemes)}><SunMedium size={16} /><span>{themes[theme].name}</span><ChevronDown size={14} /></button>{showThemes && <ThemeMenu theme={theme} setTheme={setTheme} close={() => setShowThemes(false)} font={font} setFont={setFont} />}</div></div></header><div className="onboarding-body">{finished ? <PositioningResult monetizationGoal={monetizationGoal} acquisitionGoal={acquisitionGoal} onEnter={onEnter} /> : <><div className="onboarding-progress"><span>定位发现访谈</span><span>{round + 1} / {interviewRounds.length}</span></div><div className="progress-track"><span style={{ width: `${((round + 1) / interviewRounds.length) * 100}%` }} /></div><div className="question-layout"><section className="question-main"><span className="section-kicker">{current[0]}</span><h1>{current[1]}</h1><p className="question">{current[2]}</p>{round === interviewRounds.length - 1 ? <div className="goal-fields"><label><span>变现目标</span><textarea value={monetizationGoal} onChange={(event) => setMonetizationGoal(event.target.value)} placeholder="例如：咨询服务、课程、产品、品牌合作..." autoFocus /></label><label><span>获客目标 / 其他目的</span><textarea value={acquisitionGoal} onChange={(event) => setAcquisitionGoal(event.target.value)} placeholder="例如：获得客户、建立信任、寻找合作伙伴、扩大影响力..." /></label></div> : <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="写下你的真实经历，不需要组织得很完美..." autoFocus />}<div className="question-actions"><button className="skip-action" onClick={advance}>暂时想不到</button><button className="primary-action" onClick={advance}>{round === interviewRounds.length - 1 ? '生成我的定位' : '继续回答'} <ArrowUpRight size={16} /></button></div></section><aside className="question-aside"><div className="aside-orbit"><div className="orbit-core">{round + 1}</div><span className="orbit-dot dot-one" /><span className="orbit-dot dot-two" /><span className="orbit-dot dot-three" /></div><strong>{hints[round]}</strong><p>你的回答会成为定位证据，系统会区分事实和推断。</p></aside></div></>}</div></main>
}

type PositioningCandidate = { id: string; name: string; positioning_statement: string; audiences: string[]; pillars: string[]; scores: Record<string, number>; status: string }

function PositioningResult({ monetizationGoal, acquisitionGoal, onEnter }: { monetizationGoal: string; acquisitionGoal: string; onEnter: () => void }) {
  const [candidates, setCandidates] = useState<PositioningCandidate[]>([])
  const [selected, setSelected] = useState<string>('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    void apiJson<PositioningCandidate[]>('/api/positioning/candidates', { method: 'POST' })
      .then(result => { setCandidates(result); setSelected(result[0]?.id || '') })
      .catch(() => setError('候选定位生成失败，请检查访谈内容后重试。'))
      .finally(() => setBusy(false))
  }, [])

  const confirm = () => {
    if (!selected) return
    setBusy(true)
    void apiJson(`/api/positioning/candidates/${selected}`, { method: 'PUT', body: JSON.stringify({ status: 'confirmed' }) })
      .then(onEnter)
      .catch(() => setError('确认定位失败，请稍后重试。'))
      .finally(() => setBusy(false))
  }

  return <div className="result-screen"><span className="section-kicker">POSITION FOUND / 03 DIRECTIONS</span><h1>你的独特价值，正在成形。</h1><p className="result-lede">根据访谈中的经历、能力、目标人群和核心目标，我们生成了 3 个可以继续验证的定位方向。</p><div className="goal-summary"><div><span>变现目标</span><strong>{monetizationGoal || '待进一步明确'}</strong></div><div><span>获客目标 / 其他目的</span><strong>{acquisitionGoal || '待进一步明确'}</strong></div></div>{busy && !candidates.length ? <p className="empty-state">正在根据访谈生成候选定位...</p> : <div className="candidate-grid">{candidates.map((candidate, index) => <article className={selected === candidate.id ? 'candidate featured' : 'candidate'} key={candidate.id} onClick={() => setSelected(candidate.id)}><span>{index === 0 ? 'A / 推荐方向' : `${String.fromCharCode(65 + index)} / 另一种可能`}</span><h2>{candidate.name}</h2><p>{candidate.positioning_statement}</p><div><b>适合人群</b><small>{candidate.audiences.length ? candidate.audiences.join(' · ') : '正在从访谈中提炼'}</small></div><div><b>内容支柱</b><small>{candidate.pillars.join(' · ')}</small></div></article>)}</div>}{error && <p className="error-note" role="alert">{error}</p>}<div className="result-actions"><button className="skip-action" onClick={() => { setBusy(true); void apiJson<PositioningCandidate[]>('/api/positioning/candidates', { method: 'POST' }).then(result => { setCandidates(result); setSelected(result[0]?.id || '') }).catch(() => setError('重新生成失败，请稍后重试。')).finally(() => setBusy(false)) }}>重新生成候选</button><button className="primary-action" disabled={busy || !selected} onClick={confirm}>{busy ? '处理中...' : '确认方向，进入工作台'} <ArrowUpRight size={16} /></button></div></div>
}

function ThemeMenu({ theme, setTheme, close, font, setFont }: { theme: ThemeKey; setTheme: (theme: ThemeKey) => void; close: () => void; font: FontKey; setFont: (font: FontKey) => void }) {
  return <div className="theme-menu"><div className="theme-menu-head"><span>选择工作氛围</span><button onClick={close}><X size={15} /></button></div><div className="theme-menu-section">主题</div>{(Object.keys(themes) as ThemeKey[]).map((key) => <button className={theme === key ? 'theme-option selected' : 'theme-option'} onClick={() => setTheme(key)} key={key}><span className="swatches">{themes[key].colors.map(color => <i style={{ background: color }} key={color} />)}</span><span className="theme-copy"><strong>{themes[key].name}</strong><small>{themes[key].subtitle}</small></span>{theme === key && <Check size={16} />}</button>)}<div className="theme-menu-section">字体</div>{(Object.keys(fonts) as FontKey[]).map((key) => <button className={font === key ? 'theme-option font-option selected' : 'theme-option font-option'} onClick={() => setFont(key)} key={key}><span className="font-sample" style={{ fontFamily: fontFamilyOf(key) }}>{fonts[key].sample}</span><span className="theme-copy"><strong>{fonts[key].name}</strong><small>{fonts[key].subtitle}</small></span>{font === key && <Check size={16} />}</button>)}</div>
}

function Topic({ number, title, meta, accent, onOpen }: { number: string; title: string; meta: string; accent: string; onOpen: () => void }) {
  return <article className="topic-row" onClick={onOpen} style={{ cursor: 'pointer' }}><span className={`topic-number ${accent}`}>{number}</span><div><h3>{title}</h3><span>{meta}</span></div><button className="row-arrow" onClick={onOpen}><ArrowUpRight size={17} /></button></article>
}

export default App

createRoot(document.getElementById('root')!).render(<App />)
