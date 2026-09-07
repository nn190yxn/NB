import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, safeStorage, session } from 'electron'
import { createHash } from 'node:crypto'
import { desktopAuthRequest } from './auth-request.mjs'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { appWindowOptions, IPC_CHANNELS, nextWindowState, resolveAppOrigin } from './electron-core.mjs'
import { drainSyncQueue, enqueueSyncEvent, scanSyncDirectory, validateSyncDirectory, watchDirectory } from './sync-client.mjs'

const origin = resolveAppOrigin(process.env.APP_ORIGIN)
const userDataPath = app.getPath('userData')
const stateFile = join(userDataPath, 'session.bin')
let queueFile = null
const deviceId = `desktop-${createHash('sha256').update(`${hostname()}:${userDataPath}`).digest('hex').slice(0, 16)}`
let mainWindow
let tray
let lifecycle = { platform: process.platform, quitting: false, hidden: false }
const syncWatchers = new Map()
let syncRuntime = { device_id: deviceId, device_name: hostname(), directories: [], queue_count: 0, last_error: null }

function sessionCookie(value = readSession()) {
  if (!value) return null
  const pair = value.split(';', 1)[0]
  const separator = pair.indexOf('=')
  if (separator <= 0) return null
  return { name: pair.slice(0, separator), value: pair.slice(separator + 1) }
}
async function restoreStoredSession() {
  const cookie = sessionCookie()
  if (!cookie) return false
  await session.defaultSession.cookies.set({ url: origin, ...cookie, httpOnly: true, secure: origin.startsWith('https:') })
  return true
}
async function syncApi(path, options = {}) {
  const cookie = readSession()
  if (!cookie) throw new Error('桌面会话不可用，请重新登录')
  const response = await fetch(`${origin}${path}`, { ...options, headers: { 'content-type': 'application/json', cookie, ...(options.headers || {}) } })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `同步请求失败: ${response.status}`)
  return response.json()
}
async function updateDirectoryStatus(directory, status, error = null) {
  return syncApi(`/api/sync-directories/${directory.id}`, { method: 'PUT', body: JSON.stringify({ sync_status: status, sync_error: error, last_scanned_at: status === 'watching' ? new Date().toISOString() : undefined }) })
}
function stopDirectoryWatcher(id) {
  syncWatchers.get(id)?.close()
  syncWatchers.delete(id)
}
async function drainDesktopQueue() {
  const cookie = readSession()
  if (!cookie || !queueFile) return
  const targetFile = queueFile
  const result = await drainSyncQueue(targetFile, origin, deviceId, fetch, cookie)
  if (queueFile === targetFile && readSession() === cookie) syncRuntime.queue_count = result.remaining.length
}
async function scanDirectoryNow(directory) {
  const cookie = readSession()
  if (!cookie || !queueFile) throw new Error('请先登录再同步')
  const validation = validateSyncDirectory(directory.local_path)
  if (!validation.ok) { stopDirectoryWatcher(directory.id); await updateDirectoryStatus(directory, validation.status, validation.error); return validation }
  for (const file of scanSyncDirectory(directory.local_path)) enqueueSyncEvent(queueFile, { ...file, directory_id: directory.id })
  await drainDesktopQueue()
  if (readSession() !== cookie) throw new Error('账号已变更，请重新同步')
  await updateDirectoryStatus(directory, 'watching')
  return { ok: true, status: 'watching' }
}
async function refreshDesktopSync() {
  const cookie = readSession()
  const assertAccount = () => { if (!cookie || readSession() !== cookie) throw new Error('账号已变更，请重新同步') }
  try {
    const identity = await syncApi('/api/auth/session')
    assertAccount()
    if (!identity.user_id) throw new Error('同步需要已登录账号')
    queueFile = join(userDataPath, `sync-queue-${createHash('sha256').update(identity.user_id).digest('hex')}.json`)
    await syncApi('/api/devices/heartbeat', { method: 'POST', body: JSON.stringify({ id: deviceId, name: hostname() }) })
    assertAccount()
    const directories = await syncApi('/api/sync-directories')
    assertAccount()
    const mine = directories.filter(item => item.device_id === deviceId)
    for (const id of [...syncWatchers.keys()]) if (!mine.some(item => item.id === id && item.enabled)) stopDirectoryWatcher(id)
    for (const directory of mine) {
      assertAccount()
      if (!directory.enabled) { stopDirectoryWatcher(directory.id); continue }
      const validation = validateSyncDirectory(directory.local_path)
      if (!validation.ok) { stopDirectoryWatcher(directory.id); await updateDirectoryStatus(directory, validation.status, validation.error); continue }
      if (!syncWatchers.has(directory.id)) {
        const targetFile = queueFile
        const watcher = watchDirectory(directory.local_path, event => {
          if (readSession() !== cookie || queueFile !== targetFile) return
          enqueueSyncEvent(targetFile, { ...event, directory_id: directory.id })
          void drainDesktopQueue().catch(error => { syncRuntime.last_error = error.message })
        })
        syncWatchers.set(directory.id, watcher)
      }
      await updateDirectoryStatus(directory, 'watching')
    }
    assertAccount()
    syncRuntime = { ...syncRuntime, directories: mine, queue_count: existsSync(queueFile) ? JSON.parse(readFileSync(queueFile, 'utf8')).length : 0, last_error: null }
  } catch (error) { if (readSession() === cookie) syncRuntime.last_error = error.message }
  return syncRuntime
}

function readSession() {
  if (!safeStorage.isEncryptionAvailable() || !existsSync(stateFile)) return null
  try { return safeStorage.decryptString(readFileSync(stateFile)) } catch { return null }
}
function writeSession(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用')
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(stateFile, safeStorage.encryptString(value), { mode: 0o600 })
}
function clearSession() { if (existsSync(stateFile)) unlinkSync(stateFile) }
function showWindow() { lifecycle = { ...lifecycle, hidden: false }; mainWindow?.show(); mainWindow?.focus() }
function createWindow() {
  mainWindow = new BrowserWindow(appWindowOptions(join(import.meta.dirname, 'preload.mjs')))
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.on('close', event => {
    const next = nextWindowState(lifecycle, 'close')
    if (next.hidden) { event.preventDefault(); lifecycle = next; mainWindow.hide() }
  })
  mainWindow.loadURL(origin)
  mainWindow.once('ready-to-show', showWindow)
}
function registerIpc() {
  ipcMain.handle(IPC_CHANNELS.getSession, () => Boolean(readSession()))
  ipcMain.handle(IPC_CHANNELS.login, async (_event, credentials) => {
    const request = desktopAuthRequest(credentials)
    const result = await fetch(`${origin}${request.path}`, request.options)
    if (!result.ok) throw new Error((await result.json().catch(() => null))?.error || '登录或注册失败')
    const cookie = result.headers.get('set-cookie')
    if (!cookie) throw new Error('登录响应缺少会话')
    for (const id of [...syncWatchers.keys()]) stopDirectoryWatcher(id)
    queueFile = null
    syncRuntime = { ...syncRuntime, directories: [], queue_count: 0, last_error: null }
    writeSession(cookie)
    await restoreStoredSession()
    await refreshDesktopSync()
    return true
  })
  ipcMain.handle(IPC_CHANNELS.refresh, async () => {
    const cookie = readSession()
    if (!cookie) return false
    const result = await fetch(`${origin}/api/auth/session`, { headers: { cookie } })
    return result.ok
  })
  ipcMain.handle(IPC_CHANNELS.clearSession, async () => { const cookie = sessionCookie(); clearSession(); queueFile = null; syncRuntime = { ...syncRuntime, directories: [], queue_count: 0, last_error: null }; for (const id of [...syncWatchers.keys()]) stopDirectoryWatcher(id); if (cookie) await session.defaultSession.cookies.remove(origin, cookie.name).catch(() => undefined); return true })
  ipcMain.handle(IPC_CHANNELS.setLaunchAtLogin, (_event, enabled) => { app.setLoginItemSettings({ openAtLogin: Boolean(enabled), args: ['--hidden'] }); return Boolean(enabled) })
  ipcMain.handle(IPC_CHANNELS.selectSyncDirectory, async () => { const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0] })
  ipcMain.handle(IPC_CHANNELS.getSyncRuntime, () => structuredClone(syncRuntime))
  ipcMain.handle(IPC_CHANNELS.refreshSync, refreshDesktopSync)
  ipcMain.handle(IPC_CHANNELS.scanSyncDirectory, async (_event, id) => { const directory = syncRuntime.directories.find(item => item.id === id); if (!directory) throw new Error('同步目录不属于当前设备'); return scanDirectoryNow(directory) })
  ipcMain.handle(IPC_CHANNELS.quit, () => { lifecycle = nextWindowState(lifecycle, 'quit'); app.quit(); return true })
}
app.whenReady().then(async () => {
  registerIpc(); await restoreStoredSession(); createWindow(); if (readSession()) void refreshDesktopSync()
  tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip('定位派')
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开工作台', click: showWindow }, { label: '退出', click: () => { lifecycle = nextWindowState(lifecycle, 'quit'); app.quit() } }]))
  tray.on('click', showWindow)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  app.on('activate', showWindow)
})
app.on('before-quit', () => { lifecycle = nextWindowState(lifecycle, 'quit') })
app.on('window-all-closed', event => { if (process.platform !== 'darwin') event.preventDefault() })
