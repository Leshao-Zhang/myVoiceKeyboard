const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('voice', {
  getState: () => ipcRenderer.invoke('get-state'),
  setEnabled: (enabled) => ipcRenderer.invoke('set-enabled', enabled),
  openPrivacy: (kind) => ipcRenderer.invoke('open-privacy', kind),
  audios: () => ipcRenderer.invoke('audios'),
  onKey: (callback) => {
    ipcRenderer.on('key', (_event, name) => callback(name))
  },
  onStatus: (callback) => {
    ipcRenderer.on('status', (_event, status) => callback(status))
  },
})
