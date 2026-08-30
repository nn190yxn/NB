import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  BrainCircuit,
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
  { label: '爆款结构库', icon: Library },
  { label: '选题助手', icon: BrainCircuit },
  { label: '内容创作', icon: PenLine },
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
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [authState, setAuthState] = useState<'checking' | 'ok' | 'need-password'>('checking')

  useEffect(() => {
    window.localStorage.setItem('dingweipai:font', font)
  }, [font])
  const [strategyRatios, setStrategyRatios] = useState([50, 30, 20])
  const [showReview, setShowReview] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [strategyReady, setStrategyReady] = useState(false)
  const [strategySaving, setStrategySaving] = useState(false)
  const [showShooting, setShowShooting] = useState(false)
  const [shootingCount, setShootingCount] = useState(0)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [pendingSync, setPendingSync] = useState(() => pendingSyncEvents().length)
  const [syncing, setSyncing] = useState(false)
  const [conflicts, setConflicts] = useState<SyncConflict[]>([])

  const logout = () => {
    void apiJson('/api/auth/session', { method: 'DELETE' }).finally(() => {
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
          {navItems.map(({ label, icon: Icon }) => <button className={activeNav === label ? 'nav-item active' : 'nav-item'} onClick={() => label === '定位发现' ? setShowOnboarding(true) : setActiveNav(label)} key={label}><Icon size={17} /><span>{label}</span>{label === '热点研究' && <b>12</b>}</button>)}
          <span className="nav-label secondary">资产</span>
           <button className={showShooting ? 'nav-item active' : 'nav-item'} onClick={() => setShowShooting(true)}><Video size={17} /><span>今日拍摄</span><b className="count-soft">{shootingCount}</b></button>
           <button className={activeNav === 'IP 档案' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveNav('IP 档案')}><BookOpen size={17} /><span>IP 档案</span></button>
        </nav>
         <div className="sidebar-bottom"><button className="nav-item" onClick={() => setShowSettings(true)}><Settings2 size={17} /><span>工作台设置</span></button><button className="user-chip" onClick={logout} title="退出当前会话"><div className="avatar">林</div><div><strong>林默</strong><span>个人创作者</span></div><MoreHorizontal size={16} /></button></div>
      </aside>

      <section className="content-shell">
         <header className="topbar"><button className="mobile-menu" aria-label="打开导航" onClick={() => setShowMobileMenu(!showMobileMenu)}><Menu size={20} /></button><div className="breadcrumbs"><span>创业观察室</span><span>/</span><strong>今日工作台</strong></div><GlobalSearch onNavigate={setActiveNav} /><div className="top-actions"><button className="icon-button" aria-label="帮助" onClick={() => setShowOnboarding(true)}><CircleHelp size={18} /></button><div className="theme-picker"><button className="theme-trigger" onClick={() => setShowThemes(!showThemes)}><SunMedium size={16} /><span>{themes[theme].name}</span><ChevronDown size={14} /></button>{showThemes && <ThemeMenu theme={theme} setTheme={setTheme} close={() => setShowThemes(false)} font={font} setFont={setFont} />}</div><button className="avatar small" aria-label="用户菜单" onClick={() => setShowReview(true)}>林</button></div></header>
           <div className={activeNav === '今日工作台' ? 'page-content' : 'page-content workspace-mode'}>{(!online || pendingSync > 0) && <div className="offline-banner" role="status">{online ? `有 ${pendingSync} 个素材等待同步。` : '当前处于离线状态，已加载内容仍可查看。'} <button onClick={syncNow} disabled={!online || syncing}>{syncing ? '同步中...' : '立即同步'}</button></div>}{conflicts.length > 0 && <div className="conflict-banner" role="alert"><strong>{conflicts.length} 个内容版本发生冲突</strong>{conflicts.map(conflict => <span key={conflict.id}>{conflict.resource_type === 'draft' ? '草稿' : '拍摄清单'} #{conflict.resource_id}<button onClick={() => resolveConflict(conflict, 'local')}>保留本地</button><button onClick={() => resolveConflict(conflict, 'remote')}>保留远端</button></span>)}</div>}
           <div className="page-heading"><div><p className="eyebrow">SATURDAY · AUG 29, 2026</p><h1>早上好，林默<span className="accent">。</span></h1><p className="lede">找到你在互联网上的独特价值，今天继续放大它。</p></div><button className="primary-action" onClick={() => setActiveNav('热点研究')}><Plus size={17} /> 新建研究</button></div>
            {activeNav !== '今日工作台' && <WorkspaceView section={activeNav as WorkspaceSection} onNavigate={setActiveNav} />}
          <div className="signal-strip"><div className="signal-icon"><Radio size={18} /></div><div><strong>今日信号</strong><span>消费降级之后，个人品牌正在进入“可信度竞争”</span></div><button onClick={() => setActiveNav('热点研究')}>查看热点 <ArrowUpRight size={15} /></button></div>

           {strategyReady && <StrategyPanel ratios={strategyRatios} setRatios={saveStrategy} saving={strategySaving} onReview={() => setShowReview(true)} />}
            {showReview && <StrategyReview ratios={strategyRatios} onApply={() => { saveStrategy([40, 35, 25]); setShowReview(false) }} onClose={() => setShowReview(false)} />}
            {showSettings && <SettingsPanel theme={theme} setTheme={setTheme} font={font} setFont={setFont} onClose={() => setShowSettings(false)} />}
            {showShooting && <ShootingWorkspace onClose={() => setShowShooting(false)} />}

          <div className="section-heading"><div><span className="section-kicker">01 / RESEARCH</span><h2>研究脉搏</h2></div><button className="text-action" onClick={() => setActiveNav('热点研究')}>查看全部 <ArrowUpRight size={15} /></button></div>
          <div className="research-grid">
            <article className="trend-card lead-card" onClick={() => setActiveNav('热点研究')} style={{ cursor: 'pointer' }}><div className="card-top"><span className="platform-tag xhs">小红书</span><span className="trend-up">↑ 32%</span></div><h3>为什么越来越多创业者开始公开“失败账本”？</h3><p>从流量叙事转向信任叙事，真实经营数据正在成为新型内容资产。</p><div className="card-foot"><span>2,841 条讨论</span><span>18 分钟前</span></div></article>
            <article className="trend-card" onClick={() => setActiveNav('热点研究')} style={{ cursor: 'pointer' }}><div className="card-top"><span className="platform-tag douyin">抖音</span><span className="trend-up">↑ 18%</span></div><h3>小团队的 AI 工作流公开课</h3><div className="mini-bars"><i style={{ height: '34%' }} /><i style={{ height: '58%' }} /><i style={{ height: '43%' }} /><i style={{ height: '76%' }} /><i style={{ height: '66%' }} /><i style={{ height: '91%' }} /></div><div className="card-foot"><span>1.2M 播放</span><span>42 分钟前</span></div></article>
            <article className="trend-card" onClick={() => setActiveNav('热点研究')} style={{ cursor: 'pointer' }}><div className="card-top"><span className="platform-tag wechat">公众号</span><span className="trend-up">↑ 11%</span></div><h3>小而美生意的三个底层逻辑</h3><div className="quote">“真正的增长，是让每一次交付都变成下一次转介绍。”</div><div className="card-foot"><span>9,472 在看</span><span>1 小时前</span></div></article>
          </div>

           <div className="lower-grid"><section><div className="section-heading compact"><div><span className="section-kicker">02 / READY TO MAKE</span><h2>准备出发的选题</h2></div><button className="text-action" onClick={() => setActiveNav('选题助手')}>打开选题助手 <ArrowUpRight size={15} /></button></div><div className="topic-list"><Topic number="01" title="别再迷信个人 IP：先把一件小事做成" meta="商业创业 · 观点型" accent="green" onOpen={() => setActiveNav('选题助手')} /><Topic number="02" title="从摆摊到连锁：一个普通人的复利路径" meta="真实故事 · 案例型" accent="amber" onOpen={() => setActiveNav('选题助手')} /><Topic number="03" title="创业第 3 年，我终于停止了这 5 件事" meta="个人经历 · 复盘型" accent="coral" onOpen={() => setActiveNav('选题助手')} /></div></section><aside className="shoot-card"><div className="card-top"><span className="section-kicker">TODAY / SHOOTING</span><Video size={17} /></div><h3>今天拍摄</h3><div className="shoot-date"><strong>{String(shootingCount).padStart(2, '0')}</strong><span>条内容<br /><small>待拍摄</small></span></div><div className="progress"><span style={{ width: shootingCount ? '25%' : '0%' }} /></div><p>当前清单 · {shootingCount} 条待拍</p><button className="outline-action" onClick={() => setShowShooting(true)}>进入拍摄清单 <ArrowUpRight size={15} /></button></aside></div>
          <footer className="footer-note"><span><span className="live-dot" /> 数据源已更新 · RedFox 研究库</span><span>最后同步于 09:42</span></footer>
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

async function apiJson<T>(path: string, options?: RequestInit): Promise<T> {
  const { headers: extraHeaders, ...rest } = options || {}
  const response = await fetch(path, { credentials: 'include', headers: { 'content-type': 'application/json', ...(extraHeaders || {}) }, ...rest })
  if (!response.ok) throw new Error(`API ${response.status}`)
  if (response.status === 204) return undefined as T
  return response.json()
}

type ApiSettings = { llm: { base_url: string; api_key: string; model: string }, redfox: { base_url: string; api_key: string } }
const apiSettingsStorageKey = 'dingweipai:api-settings'
const emptyApiSettings: ApiSettings = { llm: { base_url: '', api_key: '', model: '' }, redfox: { base_url: '', api_key: '' } }

function loadApiSettings(): ApiSettings {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(apiSettingsStorageKey) || '{}')
    return { llm: { ...emptyApiSettings.llm, ...(parsed.llm || {}) }, redfox: { ...emptyApiSettings.redfox, ...(parsed.redfox || {}) } }
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

function redfoxHeaders(): Record<string, string> {
  const redfox = loadApiSettings().redfox
  return redfox.base_url || redfox.api_key ? { 'x-redfox-base-url': redfox.base_url, 'x-redfox-api-key': redfox.api_key } : {}
}

type SkillToggles = { hotSearch: boolean; compliance: boolean; similarAccounts: boolean }
const skillTogglesKey = 'dingweipai:skill-toggles'
const defaultSkillToggles: SkillToggles = { hotSearch: true, compliance: true, similarAccounts: true }

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

const allResearchPlatforms = ['小红书', '抖音', '视频号', '公众号', 'B站', '微博', 'X']

type TestResult = { ok: boolean; error?: string; status?: number }

function SettingsPanel({ theme, setTheme, font, setFont, onClose }: { theme: ThemeKey; setTheme: (theme: ThemeKey) => void; font: FontKey; setFont: (font: FontKey) => void; onClose: () => void }) {
  const [apiSettings, setApiSettings] = useState<ApiSettings>(loadApiSettings)
  const [saved, setSaved] = useState('')
  const [testing, setTesting] = useState<'llm' | 'redfox' | ''>('')
  const [testResult, setTestResult] = useState<Record<string, string>>({})

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const persist = () => { saveApiSettings(apiSettings); setSaved('API 配置已保存到此浏览器'); window.setTimeout(() => setSaved(''), 2500) }
  const runTest = (type: 'llm' | 'redfox') => {
    setTesting(type)
    setTestResult(current => ({ ...current, [type]: '' }))
    saveApiSettings(apiSettings)
    const payload = type === 'llm'
      ? { type, base_url: apiSettings.llm.base_url, api_key: apiSettings.llm.api_key, model: apiSettings.llm.model }
      : { type, base_url: apiSettings.redfox.base_url, api_key: apiSettings.redfox.api_key }
    void apiJson<TestResult>('/api/settings/test', { method: 'POST', body: JSON.stringify(payload) })
      .then(result => setTestResult(current => ({ ...current, [type]: result.ok ? '连接成功，配置可用。' : `连接失败：${result.error || '未知原因'}` })))
      .catch(() => setTestResult(current => ({ ...current, [type]: '连接失败：测试请求未完成。' })))
      .finally(() => setTesting(''))
  }
  const updateLlm = (key: keyof ApiSettings['llm'], value: string) => setApiSettings(current => ({ ...current, llm: { ...current.llm, [key]: value } }))
  const updateRedfox = (key: keyof ApiSettings['redfox'], value: string) => setApiSettings(current => ({ ...current, redfox: { ...current.redfox, [key]: value } }))

  return <div className="settings-overlay" onClick={onClose}><div className="settings-modal" onClick={event => event.stopPropagation()}>
    <header className="settings-head"><div><span className="section-kicker">WORKBENCH SETTINGS</span><h2>工作台设置</h2></div><button className="close-review" onClick={onClose} aria-label="关闭设置"><X size={16} /></button></header>
    <div className="settings-body">
      <section className="settings-section"><h3>外观</h3>
        <div className="settings-theme-grid">{(Object.keys(themes) as ThemeKey[]).map(key => <button className={theme === key ? 'settings-theme active' : 'settings-theme'} key={key} onClick={() => setTheme(key)}><span className="theme-dots">{themes[key].colors.map(color => <i key={color} style={{ background: color }} />)}</span><b>{themes[key].name}</b><small>{themes[key].subtitle}</small></button>)}</div>
        <div className="settings-font-row">{(Object.keys(fonts) as FontKey[]).map(key => <button className={font === key ? 'settings-font active' : 'settings-font'} key={key} onClick={() => setFont(key)} style={{ fontFamily: fonts[key].sample }}><b>{fonts[key].name}</b><small>{fonts[key].subtitle}</small></button>)}</div>
      </section>
      <section className="settings-section"><h3>API 中心</h3>
        <p className="settings-privacy">API Key 仅保存在此浏览器（localStorage），随请求头传给服务端使用，服务端数据库与日志不保存密钥。</p>
        <article className="settings-api-card">
          <div className="settings-api-head"><b>大模型 API</b><small>OpenAI 兼容接口，用于内容生成能力</small></div>
          <label><span>Base URL</span><input value={apiSettings.llm.base_url} onChange={event => updateLlm('base_url', event.target.value)} placeholder="https://api.example.com/v1" /></label>
          <label><span>API Key</span><input type="password" autoComplete="off" value={apiSettings.llm.api_key} onChange={event => updateLlm('api_key', event.target.value)} placeholder="sk-..." /></label>
          <label><span>模型名</span><input value={apiSettings.llm.model} onChange={event => updateLlm('model', event.target.value)} placeholder="deepseek-chat" /></label>
          <div className="settings-api-foot"><button className="outline-action" disabled={testing !== ''} onClick={() => runTest('llm')}>{testing === 'llm' ? '测试中...' : '测试连接'}</button>{testResult.llm && <span className={testResult.llm.startsWith('连接成功') ? 'test-ok' : 'test-fail'}>{testResult.llm}</span>}</div>
        </article>
        <article className="settings-api-card">
          <div className="settings-api-head"><b>红狐 API</b><small>RedFox 热点研究数据服务，保存后研究刷新优先使用</small></div>
          <label><span>Base URL</span><input value={apiSettings.redfox.base_url} onChange={event => updateRedfox('base_url', event.target.value)} placeholder="https://redfox.example.com" /></label>
          <label><span>API Key</span><input type="password" autoComplete="off" value={apiSettings.redfox.api_key} onChange={event => updateRedfox('api_key', event.target.value)} placeholder="API Key" /></label>
          <div className="settings-api-foot"><button className="outline-action" disabled={testing !== ''} onClick={() => runTest('redfox')}>{testing === 'redfox' ? '测试中...' : '测试连接'}</button>{testResult.redfox && <span className={testResult.redfox.startsWith('连接成功') ? 'test-ok' : 'test-fail'}>{testResult.redfox}</span>}</div>
        </article>
        <div className="settings-save-row"><button className="primary-action" onClick={persist}>保存配置 <ArrowUpRight size={16} /></button>{saved && <span className="test-ok">{saved}</span>}</div>
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
    setBusy(true); setMessage('')
    void apiJson<{ error?: string; reason?: string }>('/api/memories/extract', { method: 'POST', body: JSON.stringify({}) })
      .catch(error => error)
      .finally(() => { setBusy(false); setMessage('自动提炼需要先在上方配置大模型并保存。') })
  }

  const visible = typeFilter ? items.filter(item => item.memory_type === typeFilter) : items

  return <section className="settings-section"><h3>AI 记忆</h3>
    <p className="settings-privacy">这里的事实会被注入选题与草稿生成，让产出越来越贴合你的风格。你可以随时查看、修正或删除。</p>
    <div className="structure-toolbar-row memory-filter">
      {['', ...memoryTypeKeys].map(name => <button className={typeFilter === name ? 'chip active' : 'chip'} onClick={() => setTypeFilter(name)} key={name || 'all'}>{name ? memoryTypeLabels[name as MemoryItem['memory_type']] : '全部'}</button>)}
      <span className="chip-gap" />
      <button className="outline-action" disabled={busy} onClick={extract}>从对话自动提炼</button>
    </div>
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

type WorkspaceSection = '热点研究' | '素材库' | '爆款结构库' | '选题助手' | '内容创作' | 'IP 档案'
type ResearchItem = { id: number; platform: string; title: string; author?: string; metrics?: { discussions?: number; growth?: number }; analysis?: { structure: string[] }; source_refs?: unknown[] }
type MaterialKind = 'article' | 'quote' | 'hotspot' | 'insight' | 'experience'
type MaterialItem = { id: number; name: string; format: string; status: string; review_status: string; content?: string; material_kind?: MaterialKind; origin_source_id?: number | null; origin_text?: string; origin_material_name?: string | null; extracted_fields?: { segments?: string[]; candidate_topics?: string[]; quotes?: string[]; collected?: Partial<Record<'quote' | 'hotspot', string[]>> }; imported_at?: string }
const materialKindLabels: Record<MaterialKind, string> = { article: '文章', quote: '金句', hotspot: '热点', insight: '知识点', experience: '经历' }
const atomKindKeys: MaterialKind[] = ['quote', 'hotspot', 'insight', 'experience']
type TopicItem = { id: number; title: string; rationale: string; content_job: string; strategy_layer: string }
type DraftItem = { id: number; platform: string; title: string; body: string; fact_check_status: string; status: string; version?: number; history?: DraftItem[] }
type SyncConflict = { id: string; resource_type: string; resource_id: number; status: string }
type StructureItem = { id: number; title: string; steps: string[]; platform: string; content_type: string; source_kind: string; favorite: boolean; usage_count: number; updated_at: string }
type StructureEditorState = { id?: number; title: string; steps: string; platform: string; content_type: string }

const structurePlatforms = ['通用', '小红书', '抖音', '视频号', '公众号']
const structureContentTypes = ['观点', '案例', '清单', '故事', '对比', '教程']

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
    for (const item of structures.items) hits.push({ kind: '结构', title: item.title, sub: item.platform, target: '爆款结构库' })
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
        placeholder="搜索选题、草稿、素材、结构…"
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
  const [contentType, setContentType] = useState('')
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
      if (contentType) params.set('content_type', contentType)
      if (favOnly) params.set('favorite', '1')
      params.set('sort', sort)
      void apiJson<{ items: StructureItem[]; total: number }>(`/api/structures?${params.toString()}`)
        .then(result => { setItems(result.items); setTotal(result.total); setPage(1); setError('') })
        .catch(() => setError('加载结构库失败，请稍后重试。'))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [query, platform, contentType, favOnly, sort])

  const loadMore = () => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (platform) params.set('platform', platform)
    if (contentType) params.set('content_type', contentType)
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
    if (!window.confirm(`删除结构「${item.title}」？已生成的草稿会保留。`)) return
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

  const clearFilters = () => { setQuery(''); setPlatform(''); setContentType(''); setFavOnly(false) }

  const listMode = view === 'list' || (view === 'auto' && total > 12)

  const renderDetail = (item: StructureItem) => (
    <div className="structure-detail">
      <ol>{item.steps.map((step, index) => <li key={`${item.id}-${index}`}>{step}</li>)}</ol>
      <div className="structure-detail-actions">
        <button className="primary-action" onClick={() => onUse(item)}>用这个结构 <PenLine size={14} /></button>
        <button className="outline-action" onClick={() => setEditor({ id: item.id, title: item.title, steps: item.steps.join('\n'), platform: item.platform, content_type: item.content_type })}><Pencil size={13} /> 编辑</button>
        <button className="outline-action danger" onClick={() => removeStructure(item)}><Trash2 size={13} /> 删除</button>
      </div>
    </div>
  )

  return <section className="structure-library">
    <div className="structure-toolbar">
      <div className="structure-toolbar-row">
        <div className="structure-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题或结构步骤..." aria-label="搜索结构" /></div>
        <div className="view-toggle" role="group" aria-label="视图切换">
          <button className={view === 'card' ? 'active' : ''} onClick={() => setView('card')} aria-label="卡片视图"><LayoutGrid size={15} /></button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="列表视图"><List size={15} /></button>
        </div>
        <button className="primary-action" onClick={() => setEditor({ title: '', steps: '', platform: '通用', content_type: '观点' })}><Plus size={15} /> 添加结构</button>
      </div>
      <div className="structure-toolbar-row">
        <button className={platform === '' ? 'chip active' : 'chip'} onClick={() => setPlatform('')}>全部平台</button>
        {structurePlatforms.map(name => <button className={platform === name ? 'chip active' : 'chip'} onClick={() => setPlatform(platform === name ? '' : name)} key={name}>{name}</button>)}
        <span className="chip-gap" />
        <button className={favOnly ? 'chip active' : 'chip'} onClick={() => setFavOnly(!favOnly)}><Star size={12} /> 收藏</button>
      </div>
      <div className="structure-toolbar-row">
        {structureContentTypes.map(name => <button className={contentType === name ? 'chip active' : 'chip'} onClick={() => setContentType(contentType === name ? '' : name)} key={name}>{name}</button>)}
        <span className="chip-gap" />
        <span className="structure-meta">{loading ? '加载中...' : `${total} 条结构`}</span>
        <select className="structure-sort" value={sort} onChange={event => setSort(event.target.value as 'latest' | 'usage' | 'favorite')} aria-label="排序方式">
          <option value="latest">最新更新</option>
          <option value="usage">最常用</option>
          <option value="favorite">收藏优先</option>
        </select>
      </div>
    </div>
    {error && <p className="structure-error" role="alert">{error}</p>}
    {editor && <section className="structure-editor">
      <input className="draft-title-input" value={editor.title} onChange={event => setEditor({ ...editor, title: event.target.value })} placeholder="结构标题，例如：反常识开场 → 真实案例 → 方法拆解" />
      <textarea className="draft-body-input" value={editor.steps} onChange={event => setEditor({ ...editor, steps: event.target.value })} placeholder={'每个步骤占一行，例如：\n反常识开场\n真实案例\n方法拆解\n评论区提问'} />
      <div className="structure-editor-row">
        <select value={editor.platform} onChange={event => setEditor({ ...editor, platform: event.target.value })} aria-label="平台">
          {structurePlatforms.map(name => <option value={name} key={name}>{name}</option>)}
        </select>
        <select value={editor.content_type} onChange={event => setEditor({ ...editor, content_type: event.target.value })} aria-label="内容类型">
          {structureContentTypes.map(name => <option value={name} key={name}>{name}</option>)}
        </select>
        <span className="chip-gap" />
        <button className="outline-action" onClick={() => setEditor(null)}>取消</button>
        <button className="primary-action" onClick={saveEditor}>保存结构 <Check size={14} /></button>
      </div>
    </section>}
    {loading ? <p className="empty-state">正在加载结构库...</p> : items.length ? listMode ? (
      <div className="structure-list">
        {items.map(item => <article className={expandedId === item.id ? 'structure-row expanded' : 'structure-row'} key={item.id}>
          <button className={item.favorite ? 'structure-fav active' : 'structure-fav'} onClick={() => toggleFavorite(item)} aria-label={item.favorite ? '取消收藏' : '收藏'}><Star size={14} fill={item.favorite ? 'currentColor' : 'none'} /></button>
          <div className="structure-main" onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>
            <h3>{item.title}</h3>
            <p>{item.content_type} · {item.platform} · {item.steps.length} 步 · 使用 {item.usage_count} 次{item.source_kind === 'research' ? ' · 研究沉淀' : ''}</p>
            {expandedId === item.id && renderDetail(item)}
          </div>
        </article>)}
      </div>
    ) : (
      <div className="structure-grid">
        {items.map(item => <article className="trend-card structure-card" key={item.id} onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>
          <div className="card-top"><span className="platform-tag douyin">{item.content_type}</span><button className={item.favorite ? 'structure-fav active' : 'structure-fav'} onClick={event => { event.stopPropagation(); toggleFavorite(item) }} aria-label={item.favorite ? '取消收藏' : '收藏'}><Star size={14} fill={item.favorite ? 'currentColor' : 'none'} /></button></div>
          <h3>{item.title}</h3>
          <p>{item.steps.join(' · ')}</p>
          {expandedId === item.id && renderDetail(item)}
          <div className="card-foot"><span>{item.platform} · 使用 {item.usage_count} 次</span><span className="structure-meta">{item.steps.length} 步</span></div>
        </article>)}
      </div>
    ) : <div className="structure-empty">
      <p className="empty-state">暂无匹配的结构。尝试清除筛选，或在「热点研究」中刷新并拆解爆款内容自动沉淀结构，也可以手动添加第一条结构。</p>
      <button className="outline-action" onClick={clearFilters}>清除搜索与筛选</button>
    </div>}
    {items.length > 0 && items.length < total && <button className="load-more" onClick={loadMore}>加载更多（已显示 {items.length} / {total} 条）</button>}
  </section>
}

type HotSearchItem = { rank: number; title: string; heat: number; platform: string }
type SimilarAccount = { nickname: string; followers: string; pillar: string; similarity: number; reason: string }

function ResearchLibrary() {
  const [items, setItems] = useState<ResearchItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [platform, setPlatform] = useState('')
  const [sort, setSort] = useState<'latest' | 'discussions' | 'growth'>('latest')
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
  const [similarAccount, setSimilarAccount] = useState('')
  const [similarItems, setSimilarItems] = useState<SimilarAccount[]>([])
  const [similarSource, setSimilarSource] = useState('')

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

  const loadMore = () => {
    void apiJson<{ items: ResearchItem[]; total: number }>(`/api/research?${buildParams({ page: String(page + 1) }).toString()}`)
      .then(result => { setItems(current => [...current, ...result.items]); setTotal(result.total); setPage(page + 1); setError('') })
      .catch(() => setError('加载更多失败，请稍后重试。'))
  }

  const refreshResearch = () => {
    setBusy(true)
    void apiJson<{ items: ResearchItem[] }>('/api/research/refresh', { method: 'POST', headers: redfoxHeaders() })
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
      await apiJson<{ added: number; source: string }>(`/api/research/search`, { method: 'POST', headers: { 'content-type': 'application/json', ...redfoxHeaders() }, body: JSON.stringify({ keyword: target, platform: skillPlatform }) })
        .then(result => setSkillMessage(`已按「${target}」抓取 ${result.added} 条研究（${result.source === 'demo' ? '演示数据' : '红狐真实数据'}）`))
      const result = await apiJson<{ items: ResearchItem[]; total: number }>(`/api/research?${buildParams().toString()}`)
      setItems(result.items); setTotal(result.total); setPage(1)
    })
  }

  const fetchHotSearch = () => runSkill('hotSearch', async () => {
    const result = await apiJson<{ items: HotSearchItem[]; source: string }>(`/api/research/hot-search`, { method: 'POST', headers: { 'content-type': 'application/json', ...redfoxHeaders() }, body: JSON.stringify({ platform: skillPlatform }) })
    setHotItems(result.items || []); setHotSource(result.source === 'demo' ? '演示数据' : '红狐真实数据'); setHotPicked([])
  })

  const collectHot = () => runSkill('collect', async () => {
    const entries = hotItems.filter(item => hotPicked.includes(item.rank))
    await apiJson<{ added: number }>(`/api/research/hot-search/collect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries, platform: skillPlatform }) })
      .then(result => { setSkillMessage(`已将 ${result.added} 条热搜加入研究库`); setHotPicked([]) })
    const result = await apiJson<{ items: ResearchItem[]; total: number }>(`/api/research?${buildParams().toString()}`)
    setItems(result.items); setTotal(result.total); setPage(1)
  })

  const fetchSimilar = () => {
    if (!similarAccount.trim()) { setSkillError('请输入要研究的账号名称。'); return }
    runSkill('similar', async () => {
      const result = await apiJson<{ items: SimilarAccount[]; source: string }>(`/api/research/similar`, { method: 'POST', headers: { 'content-type': 'application/json', ...redfoxHeaders() }, body: JSON.stringify({ account: similarAccount.trim(), platform: skillPlatform }) })
      setSimilarItems(result.items || []); setSimilarSource(result.source === 'demo' ? '演示数据' : '红狐真实数据')
    })
  }

  const updateToggle = (key: keyof SkillToggles) => {
    const next = { ...toggles, [key]: !toggles[key] }
    setToggles(next); saveSkillToggles(next)
  }

  const clearFilters = () => { setQuery(''); setPlatform('') }

  return <section className="workspace-view"><div className="workspace-view-head"><div><span className="section-kicker">WORKSPACE / RESEARCH PULSE</span><h2>研究脉搏</h2><p>围绕定位和 IP 核心目标，沉淀可追溯的内容资产。</p></div><button className="primary-action" onClick={refreshResearch}>{busy ? '刷新中...' : '刷新研究'} <Radio size={15} /></button></div><div className="structure-library">
    <div className="skill-directory">
      <div className="skill-directory-head"><h3>红狐 Skill 目录</h3><span className="skill-source-tag">演示数据可用，配置红狐 Key 后自动切换真实数据</span></div>
      <div className="skill-cards">
        <article className="skill-card"><h4>关键词搜索</h4><p>默认能力 · 按关键词抓取爆款内容进研究库</p></article>
        <article className={toggles.hotSearch ? 'skill-card active' : 'skill-card'}><h4>热搜榜</h4><p>抓取平台热榜，一键加入研究库</p><button className={toggles.hotSearch ? 'chip active' : 'chip'} onClick={() => updateToggle('hotSearch')}>{toggles.hotSearch ? '已启用' : '已停用'}</button></article>
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
      <select className="structure-sort" value={sort} onChange={event => setSort(event.target.value as 'latest' | 'discussions' | 'growth')} aria-label="排序方式">
        <option value="latest">最新捕获</option>
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
    {loading ? <p className="empty-state">正在加载研究数据...</p> : items.length ? <div className="asset-list">
      {items.map(item => <article className="asset-row" key={item.id}>
        <span className="platform-tag xhs">{item.platform}</span>
        <div>
          <h3>{item.title}</h3>
          <p>{item.author || 'RedFox 研究库'} · 讨论 {item.metrics?.discussions || 0} · 增长 {item.metrics?.growth || 0}%</p>
          {openId === item.id && <div className="research-detail"><strong>爆款结构拆解</strong>{item.analysis?.structure?.length ? <span className="history-list">{item.analysis.structure.map((step, index) => <span key={`${item.id}-${index}`}>{step}</span>)}</span> : <small>暂无拆解结构。可先在爆款结构库中查看可复用框架，或等待刷新研究后重新生成。</small>}</div>}
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
    if (!title.trim() && !structureId) { setError('填写选题标题，或选择一个爆款结构。'); return }
    setBusy(true); setError('')
    const structure = structures.find(item => String(item.id) === structureId)
    const anchorTitle = title.trim() || structure?.title || ''
    void apiJson<DraftItem[]>('/api/drafts/generate', { method: 'POST', body: JSON.stringify({ topic: { title: anchorTitle, strategy_layer: 'trust', goal_refs: [] }, ...(structureId ? { structure_id: Number(structureId) } : {}), quote_ids: quoteIds, experience_ids: experienceIds }) })
      .then(result => { onGenerated(result); setTitle(''); setStructureId(''); setQuoteIds([]); setExperienceIds([]) })
      .catch(() => setError('生成失败，请稍后重试。'))
      .finally(() => setBusy(false))
  }

  return <div className="compose-panel">
    <div className="compose-panel-head"><h3>组合生成</h3><span>热点主题 + 个人经历 + 爆款结构 + 金句，一次组装成四平台草稿</span></div>
    <div className="compose-row">
      <input value={title} onChange={event => setTitle(event.target.value)} placeholder="选题标题，例如：结合最近的某个热点，说说你自己的经历…" aria-label="选题标题" />
      <select value={structureId} onChange={event => setStructureId(event.target.value)} aria-label="爆款结构">
        <option value="">选择爆款结构（可选）</option>
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

function WorkspaceView({ section, onNavigate }: { section: WorkspaceSection; onNavigate: (section: WorkspaceSection) => void }) {
  const [topics, setTopics] = useState<TopicItem[]>([])
  const [drafts, setDrafts] = useState<DraftItem[]>([])
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<Record<number, DraftItem[]>>({})
  const [compliance, setCompliance] = useState<Record<number, ComplianceResult>>({})
  const [complianceBusy, setComplianceBusy] = useState<number | null>(null)
  useEffect(() => {
    void apiJson<DraftItem[]>('/api/drafts').then(setDrafts).catch(() => undefined)
  }, [])
  const copyDraft = (draft: DraftItem) => { setBusy(true); void apiJson<DraftItem>(`/api/drafts/${draft.id}/copy`, { method: 'POST' }).then(copy => setDrafts(current => [copy, ...current])).catch(() => undefined).finally(() => setBusy(false)) }
  const loadHistory = (draft: DraftItem) => { void apiJson<DraftItem[]>(`/api/drafts/${draft.id}/history`).then(items => setHistory(current => ({ ...current, [draft.id]: items }))).catch(() => undefined) }
  const restoreDraft = (draft: DraftItem, version: number) => { setBusy(true); void apiJson<DraftItem>(`/api/drafts/${draft.id}/restore`, { method: 'POST', body: JSON.stringify({ version }) }).then(updated => { setDrafts(current => current.map(item => item.id === updated.id ? updated : item)); setHistory(current => ({ ...current, [draft.id]: updated.history || [] })) }).catch(() => undefined).finally(() => setBusy(false)) }
  const checkCompliance = (draft: DraftItem) => {
    setComplianceBusy(draft.id)
    void apiJson<ComplianceResult>(`/api/drafts/${draft.id}/compliance`, { method: 'POST', headers: { 'content-type': 'application/json', ...redfoxHeaders() }, body: JSON.stringify({}) })
      .then(result => setCompliance(current => ({ ...current, [draft.id]: result })))
      .catch(() => setCompliance(current => ({ ...current, [draft.id]: { hits: [], source: 'error', checked_length: 0 } })))
      .finally(() => setComplianceBusy(null))
  }
  if (section === 'IP 档案') return <ProfileReviewPanel />
  const generateTopics = () => {
    setBusy(true)
    void Promise.all([apiJson<ResearchItem[]>('/api/research'), apiJson<MaterialItem[]>('/api/materials')])
      .then(([research, materials]) => apiJson<TopicItem[]>('/api/topics/generate', { method: 'POST', body: JSON.stringify({ research_ids: research.slice(0, 3).map(item => item.id), material_ids: materials.slice(0, 3).map(item => item.id) }) }))
      .then(result => setTopics(result))
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }
  const generateDrafts = (topic: TopicItem) => { setBusy(true); void apiJson<DraftItem[]>('/api/drafts/generate', { method: 'POST', body: JSON.stringify({ topic_id: topic.id }) }).then(result => setDrafts(current => [...result, ...current])).catch(() => undefined).finally(() => setBusy(false)) }
  const useStructure = (structure: StructureItem) => { setBusy(true); void apiJson<DraftItem[]>('/api/drafts/generate', { method: 'POST', body: JSON.stringify({ structure_id: structure.id, topic: { title: structure.title, strategy_layer: 'trust', goal_refs: [] } }) }).then(() => onNavigate('内容创作')).catch(() => undefined).finally(() => setBusy(false)) }
  const updateDraft = (draft: DraftItem, patch: Partial<DraftItem>) => { setBusy(true); void apiJson<DraftItem>(`/api/drafts/${draft.id}`, { method: 'PUT', body: JSON.stringify(patch) }).then(updated => setDrafts(current => current.map(item => item.id === updated.id ? updated : item))).catch(() => undefined).finally(() => setBusy(false)) }
  if ((section as string) === '素材库') return <MaterialWorkspace />
  if (section === '热点研究') return <ResearchLibrary />
  const heading = section === '爆款结构库' ? '爆款结构库' : section === '选题助手' ? '选题助手' : '内容创作'
  return <section className="workspace-view"><div className="workspace-view-head"><div><span className="section-kicker">WORKSPACE / {section.toUpperCase()}</span><h2>{heading}</h2><p>围绕定位和 IP 核心目标，沉淀可追溯的内容资产。</p></div>{section === '选题助手' && <button className="primary-action" onClick={generateTopics}>{busy ? '生成中...' : '生成选题'} <Sparkles size={15} /></button>}</div>{section === '爆款结构库' && <StructureLibrary onUse={useStructure} />}{section === '选题助手' && <div className="asset-list">{topics.length ? topics.map(topic => <article className="asset-row" key={topic.id}><div><h3>{topic.title}</h3><p>{topic.content_job} · {topic.rationale}</p></div><button className="outline-action" onClick={() => generateDrafts(topic)}>生成草稿</button></article>) : <div className="structure-empty"><p className="empty-state">选择生成选题，系统会从当前研究和素材中建立来源链路。</p></div>}</div>}{section === '内容创作' && <><ComposePanel onGenerated={result => setDrafts(current => [...result, ...current])} />{drafts.length ? <div className="draft-grid">{drafts.map(draft => <article className="trend-card draft-card" key={draft.id}><div className="card-top"><span className="platform-tag douyin">{draft.platform}</span><span className="draft-version">v{draft.version || 1}</span></div><input className="draft-title-input" value={draft.title} onChange={event => setDrafts(current => current.map(item => item.id === draft.id ? { ...item, title: event.target.value } : item))} /><textarea className="draft-body-input" value={draft.body} onChange={event => setDrafts(current => current.map(item => item.id === draft.id ? { ...item, body: event.target.value } : item))} /><div className="card-foot"><span>{draft.fact_check_status}</span><button className="outline-action" onClick={() => updateDraft(draft, { title: draft.title, body: draft.body })}>{busy ? '保存中...' : '保存草稿'}</button></div>{history[draft.id] && <div className="history-list">{history[draft.id].map(item => <span key={`${draft.id}-${item.version}`}><small>v{item.version || 1}</small><button className="text-action" disabled={busy} onClick={() => restoreDraft(draft, item.version || 1)}>恢复</button></span>)}</div>}{compliance[draft.id] && <div className="compliance-result">{compliance[draft.id].source === 'error' ? <small role="alert">合规检查失败，请稍后重试。</small> : compliance[draft.id].hits.length ? compliance[draft.id].hits.map(hit => <span className="compliance-hit" key={hit.word}><strong>{hit.word}</strong><small>{hit.level} · {hit.suggestion}</small></span>) : <small>未检测到违禁词风险（{compliance[draft.id].source === 'demo' ? '演示词表' : '红狐词表'}）。</small>}</div>}<div className="draft-actions"><button className="outline-action" onClick={() => loadHistory(draft)}>查看历史</button><button className="outline-action" disabled={complianceBusy === draft.id || !loadSkillToggles().compliance} onClick={() => checkCompliance(draft)}>{complianceBusy === draft.id ? '检测中...' : '合规检查'}</button><button className="outline-action" disabled={busy} onClick={() => copyDraft(draft)}>复制草稿</button></div></article>)}</div> : <div className="structure-empty"><p className="empty-state">还没有草稿。用上方组合生成面板组装第一份文案，或去选题助手生成选题。</p></div>}</>}</section>
}

type ProfileReview = { id: string; status: string; extracted: Record<string, unknown>; source_refs?: unknown[] }

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
  const [reviews, setReviews] = useState<ProfileReview[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { void apiJson<ProfileReview[]>('/api/profile/reviews').then(setReviews).catch(() => setReviews([])) }, [])
  const review = (id: string, status: 'approved' | 'rejected') => {
    setBusy(true)
    void apiJson<ProfileReview>(`/api/profile/reviews/${id}`, { method: 'PUT', body: JSON.stringify({ status }) })
      .then(updated => setReviews(current => current.map(item => item.id === updated.id ? updated : item)))
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }
  return <section className="workspace-view"><div className="workspace-view-head"><div><span className="section-kicker">ASSET / IP PROFILE</span><h2>IP 档案审核</h2><p>审核从访谈、素材和外部资料中提取的定位信息，再用于后续内容生成。</p></div></div><div className="asset-list">{reviews.length ? reviews.map(item => <article className="asset-row" key={item.id}><div><h3>{String(item.extracted.role || item.extracted.title || '待审核档案片段')}</h3><p>{Object.entries(item.extracted).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join('、') : String(value)}`).join(' · ')}</p><small>来源引用 {item.source_refs?.length || 0} 条 · 当前状态 {item.status}</small></div><div className="row-actions"><button className="skip-action" disabled={busy} onClick={() => review(item.id, 'rejected')}>拒绝</button><button className="primary-action" disabled={busy} onClick={() => review(item.id, 'approved')}>通过审核</button></div></article>) : <p className="empty-state">暂无待审核档案。完成定位访谈或导入素材后，提取结果会出现在这里。</p>}</div></section>
}

type ShootingItem = { id: string; title: string; platform: string; status: string; script?: string; font_size?: number; scroll_speed?: number; version?: number }

function ShootingWorkspace({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<ShootingItem[]>([])
  const [active, setActive] = useState<ShootingItem | null>(null)
  const [playing, setPlaying] = useState(false)
  const [fontSize, setFontSize] = useState(24)
  const [scrollSpeed, setScrollSpeed] = useState(3)
  useEffect(() => { void apiJson<ShootingItem[]>('/api/shooting/today').then(setItems).catch(() => setItems([])) }, [])
  useEffect(() => {
    if (!active) return
    try {
      const saved = loadTeleprompterSettings(window.localStorage, active.id)
      if (saved.fontSize) setFontSize(saved.fontSize)
      if (saved.scrollSpeed) setScrollSpeed(saved.scrollSpeed)
      if (typeof saved.playing === 'boolean') setPlaying(saved.playing)
    } catch {
      localStorage.removeItem(`teleprompter:${active.id}`)
    }
  }, [active?.id])
  useEffect(() => {
    if (!active) return
    saveTeleprompterSettings(window.localStorage, active.id, { fontSize, scrollSpeed, playing })
  }, [active?.id, fontSize, scrollSpeed, playing])
  const update = (id: string, patch: Record<string, unknown>) => {
    void apiJson<ShootingItem>(`/api/shooting/${id}`, { method: 'PUT', body: JSON.stringify(patch) }).then(next => { setItems(current => current.map(item => item.id === id ? next : item)); setActive(next) }).catch(() => undefined)
  }
  return <section className="shoot-workspace"><div className="shoot-workspace-head"><div><span className="section-kicker">TODAY / SHOOTING DESK</span><h2>今日拍摄清单</h2><p>把准备好的内容，转成可以直接开拍的动作。</p></div><button className="close-review" onClick={onClose}><X size={16} /></button></div><div className="shoot-workspace-grid"><div className="shoot-items">{items.length ? items.map(item => <article className={active?.id === item.id ? 'shoot-item selected' : 'shoot-item'} key={item.id}><div><span className={`platform-tag ${item.platform === '小红书' ? 'xhs' : item.platform === '公众号' ? 'wechat' : 'douyin'}`}>{item.platform}</span><h3>{item.title}</h3></div><select value={item.status} onChange={event => update(item.id, { status: event.target.value })}><option value="ready_to_shoot">待拍摄</option><option value="in_progress">拍摄中</option><option value="completed">已完成</option></select><button className="row-arrow" onClick={() => { setActive(item); setFontSize(item.font_size || 24); setScrollSpeed(item.scroll_speed || 3) }}><ArrowUpRight size={17} /></button></article>) : <p className="empty-state">暂无待拍摄内容。先在内容创作中准备一条脚本。</p>}</div>{active && <div className="teleprompter"><div className="teleprompter-tools"><button onClick={() => setPlaying(!playing)}>{playing ? <Pause size={15} /> : <Play size={15} />} {playing ? '暂停' : '开始滚动'}</button><label>字号 <input type="range" min="16" max="42" value={fontSize} onChange={event => setFontSize(Number(event.target.value))} /></label><label>速度 <input type="range" min="1" max="8" value={scrollSpeed} onChange={event => setScrollSpeed(Number(event.target.value))} /></label></div><div className={playing ? 'teleprompter-script is-playing' : 'teleprompter-script'} style={{ fontSize }}><span>{active.platform} · 提词模式</span><h3>{active.title}</h3><p>{active.script || '脚本内容将在内容创作完成后显示。你可以先确认镜头节奏，再开始拍摄。'}</p></div><button className="primary-action" onClick={() => update(active.id, { status: active.status === 'completed' ? 'ready_to_shoot' : 'completed', font_size: fontSize, scroll_speed: scrollSpeed })}>{active.status === 'completed' ? '重新安排拍摄' : '标记为已完成'} <Check size={16} /></button></div>}</div></section>
}

function PasswordGate({ theme, font, onSuccess }: { theme: ThemeKey; font: FontKey; onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = () => {
    if (busy || !password) return
    setBusy(true); setError('')
    void apiJson('/api/auth/session', { method: 'POST', body: JSON.stringify({ password }) })
      .then(onSuccess)
      .catch(() => setError('访问密码不正确，请重新输入。'))
      .finally(() => setBusy(false))
  }

  return <main className={`app theme-${theme} font-${font}`}><div className="password-gate"><div className="brand"><div className="brand-mark">定</div><div><strong>定位派</strong><span>个人 IP 内容成长平台</span></div></div><h1>输入访问密码</h1><p>这是一份私人的内容工作台，请输入访问密码继续。</p><form onSubmit={(event) => { event.preventDefault(); submit() }}><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="访问密码" autoFocus aria-label="访问密码" /><button className="primary-action" type="submit" disabled={busy || !password}>{busy ? '验证中...' : '进入工作台'} <ArrowUpRight size={16} /></button></form>{error && <p className="error-note" role="alert">{error}</p>}</div></main>
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
