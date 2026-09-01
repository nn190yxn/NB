import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, isAllowedIpcChannel } from './electron-core.mjs'

const invoke = (channel, ...args) => {
  if (!isAllowedIpcChannel(channel)) throw new Error('IPC channel not allowed')
  return ipcRenderer.invoke(channel, ...args)
}

contextBridge.exposeInMainWorld('desktopApp', Object.freeze({
  login: password => invoke(IPC_CHANNELS.login, password),
  refreshSession: () => invoke(IPC_CHANNELS.refresh),
  logout: () => invoke(IPC_CHANNELS.clearSession),
  setLaunchAtLogin: enabled => invoke(IPC_CHANNELS.setLaunchAtLogin, enabled),
  selectSyncDirectory: () => invoke(IPC_CHANNELS.selectSyncDirectory),
  getSyncRuntime: () => invoke(IPC_CHANNELS.getSyncRuntime),
  refreshSync: () => invoke(IPC_CHANNELS.refreshSync),
  scanSyncDirectory: id => invoke(IPC_CHANNELS.scanSyncDirectory, id),
  quit: () => invoke(IPC_CHANNELS.quit),
}))
