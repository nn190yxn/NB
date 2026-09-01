const IPC_CHANNELS = Object.freeze({
  getSession: 'session:get',
  login: 'session:login',
  refresh: 'session:refresh',
  clearSession: 'session:clear',
  setLaunchAtLogin: 'app:set-launch-at-login',
  selectSyncDirectory: 'sync:select-directory',
  getSyncRuntime: 'sync:get-runtime',
  refreshSync: 'sync:refresh',
  scanSyncDirectory: 'sync:scan-directory',
  quit: 'app:quit',
})

export function allowedIpcChannels() { return Object.values(IPC_CHANNELS) }

export function isAllowedIpcChannel(channel) { return allowedIpcChannels().includes(channel) }

export function appWindowOptions(preload) {
  return { width: 1440, height: 960, minWidth: 1024, minHeight: 700, show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } }
}

export function normalizeAppOrigin(origin) {
  const url = new URL(origin)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('应用地址必须使用 HTTP(S)')
  return url.origin
}

export function shouldHideOnClose({ quitting, platform }) { return platform === 'win32' && !quitting }

export function nextWindowState(current, event) {
  if (event === 'close' && shouldHideOnClose(current)) return { ...current, hidden: true }
  if (event === 'quit') return { ...current, quitting: true, hidden: false }
  return current
}

export { IPC_CHANNELS }
