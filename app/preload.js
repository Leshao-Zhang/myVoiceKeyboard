const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('voice', {
  getState: () => ipcRenderer.invoke('get-state'),
  setEnabled: (enabled) => ipcRenderer.invoke('set-enabled', enabled),
  setVolume: (volume) => ipcRenderer.invoke('set-volume', volume),
  setSkin: (skin) => ipcRenderer.invoke('set-skin', skin),
  openPrivacy: (kind) => ipcRenderer.invoke('open-privacy', kind),
  audios: () => ipcRenderer.invoke('audios'),
  customAudios: () => ipcRenderer.invoke('custom-audios'),
  saveCustom: (name, bytes) => ipcRenderer.invoke('save-custom', name, bytes),
  clearCustom: (name) => ipcRenderer.invoke('clear-custom', name),
  ensureMic: () => ipcRenderer.invoke('ensure-mic'),
  exportConfig: () => ipcRenderer.invoke('export-config'),
  importConfig: () => ipcRenderer.invoke('import-config'),
  resetConfig: () => ipcRenderer.invoke('reset-config'),
  onKey: (callback) => {
    ipcRenderer.on('key', (_event, name) => callback(name))
  },
  onStatus: (callback) => {
    ipcRenderer.on('status', (_event, status) => callback(status))
  },
})
