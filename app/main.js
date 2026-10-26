const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell, systemPreferences } = require('electron')
const fs = require('fs')
const path = require('path')

const NAMES = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'0123456789',
  'LEFT',
  'RIGHT',
  'UP',
  'DOWN',
]

app.setName('语音键盘')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

const selfTest = process.env.VOICE_SELF_TEST === '1'
let enabled = true
let hookStarted = false
let listenersReady = false
let trusted = process.platform !== 'darwin'
let quitting = false
let win = null
let tray = null
let uIOhook = null
let keyMap = new Map()
const held = new Set()

function audioDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'audios')
  return path.join(__dirname, '..', 'keyboard', 'audios')
}

function missingAudios() {
  return NAMES.filter((name) => !fs.existsSync(path.join(audioDir(), `${name}.wav`)))
}

function fatal(message) {
  console.error(message)
  if (!selfTest) dialog.showErrorBox('语音键盘', message)
  app.exit(1)
  throw new Error(message)
}

function loadHook() {
  const hook = require('uiohook-napi')
  uIOhook = hook.uIOhook
  const { UiohookKey } = hook
  keyMap = new Map()
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (UiohookKey[ch] !== undefined) keyMap.set(UiohookKey[ch], ch)
  }
  for (let i = 0; i <= 9; i++) {
    const code = UiohookKey[String(i)]
    if (code !== undefined) keyMap.set(code, String(i))
  }
  const arrows = [
    ['ArrowLeft', 'LEFT'],
    ['ArrowRight', 'RIGHT'],
    ['ArrowUp', 'UP'],
    ['ArrowDown', 'DOWN'],
  ]
  for (const [key, name] of arrows) {
    if (UiohookKey[key] !== undefined) keyMap.set(UiohookKey[key], name)
  }
  if (keyMap.size !== 40) {
    fatal(`按键映射应为 40，实际 ${keyMap.size}`)
  }
}

function send(channel, payload) {
  if (!win || win.isDestroyed()) return
  win.webContents.send(channel, payload)
}

function publishStatus() {
  send('status', { enabled, trusted, platform: process.platform })
  rebuildMenu()
}

function macTrusted(prompt) {
  if (process.platform !== 'darwin') return true
  return systemPreferences.isTrustedAccessibilityClient(prompt)
}

function startHook() {
  if (hookStarted || selfTest) return
  if (process.platform === 'darwin' && !macTrusted(false)) return
  if (!listenersReady) {
    uIOhook.on('keydown', (event) => {
      if (held.has(event.keycode)) return
      held.add(event.keycode)
      if (!enabled) return
      const name = keyMap.get(event.keycode)
      if (name) send('key', name)
    })
    uIOhook.on('keyup', (event) => {
      held.delete(event.keycode)
    })
    listenersReady = true
  }
  try {
    const started = uIOhook.start()
    if (started && typeof started.then === 'function') {
      started.catch((error) => fatal(`键盘监听没有启动：${error.message || error}`))
    }
  } catch (error) {
    fatal(`键盘监听没有启动：${error.message || error}`)
    return
  }
  hookStarted = true
  trusted = true
  publishStatus()
}

function refreshTrust() {
  if (process.platform !== 'darwin') {
    trusted = true
    startHook()
    return
  }
  const ok = macTrusted(false)
  if (ok === trusted && (!ok || hookStarted)) return
  trusted = ok
  if (ok) startHook()
  else publishStatus()
}

function setEnabled(next) {
  enabled = Boolean(next)
  if (!enabled) held.clear()
  publishStatus()
}

function showWindow() {
  if (!win || win.isDestroyed()) return
  if (process.platform === 'win32') win.setSkipTaskbar(false)
  win.show()
  win.focus()
}

function hideWindow() {
  if (!win || win.isDestroyed()) return
  if (process.platform === 'win32') win.setSkipTaskbar(true)
  win.hide()
}

function openPrivacy(kind) {
  if (process.platform !== 'darwin') return
  const anchor = kind === 'input' ? 'Privacy_ListenEvent' : 'Privacy_Accessibility'
  shell.openExternal(`x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?${anchor}`)
}

function loginOpenAtLogin() {
  if (!app.isPackaged) return false
  return app.getLoginItemSettings().openAtLogin
}

function setOpenAtLogin(openAtLogin) {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin })
}

function rebuildMenu() {
  const privacy = process.platform === 'darwin'
    ? [
        { type: 'separator' },
        { label: '辅助功能设置…', click: () => openPrivacy('accessibility') },
        { label: '输入监控设置…', click: () => openPrivacy('input') },
      ]
    : []
  const template = [
    {
      label: '语音键盘',
      submenu: [
        { label: '显示窗口', click: showWindow },
        {
          label: enabled ? '暂停读音' : '继续读音',
          click: () => setEnabled(!enabled),
        },
        {
          label: '开机时打开',
          type: 'checkbox',
          checked: loginOpenAtLogin(),
          enabled: app.isPackaged,
          click: (item) => setOpenAtLogin(item.checked),
        },
        ...privacy,
        { type: 'separator' },
        process.platform === 'darwin'
          ? { label: '退出语音键盘', role: 'quit' }
          : { label: '退出语音键盘', click: () => app.quit() },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  if (tray) tray.setContextMenu(Menu.buildFromTemplate(template[0].submenu))
}

function trayImagePath() {
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'trayColor.png'
  const packed = path.join(__dirname, 'build', file)
  const unpacked = packed.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
  return fs.existsSync(unpacked) ? unpacked : packed
}

function createTray() {
  const image = nativeImage.createFromPath(trayImagePath())
  if (image.isEmpty()) fatal('菜单栏图标没有加载成功')
  if (process.platform === 'darwin') image.setTemplateImage(true)
  tray = new Tray(image)
  tray.setToolTip('语音键盘')
  tray.on('click', showWindow)
  rebuildMenu()
}

function createWindow() {
  win = new BrowserWindow({
    width: 860,
    height: 560,
    minWidth: 520,
    minHeight: 360,
    title: '语音键盘',
    show: false,
    backgroundColor: '#f6f4ef',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  win.webContents.setBackgroundThrottling(false)
  win.on('close', (event) => {
    if (quitting || selfTest) return
    event.preventDefault()
    hideWindow()
  })
  if (!selfTest) win.once('ready-to-show', () => win.show())
  const loaded = new Promise((resolve, reject) => {
    win.webContents.once('did-finish-load', resolve)
    win.webContents.once('did-fail-load', (_event, _code, description) => {
      reject(new Error(description || '窗口没有打开'))
    })
  })
  win.loadFile(path.join(__dirname, 'index.html'))
  return loaded
}

async function runSelfTest(loaded) {
  try {
    await loaded
    const result = await win.webContents.executeJavaScript('window.runSelfTest()', true)
    if (!result || !result.ok) {
      console.error((result && result.error) || '读音播放失败')
      app.exit(1)
      return
    }
    console.error(`已加载 ${result.count} 个读音`)
    app.exit(0)
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error))
    app.exit(1)
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.on('before-quit', () => {
    quitting = true
    if (hookStarted) uIOhook.stop()
  })
  app.on('window-all-closed', () => {})
  app.on('activate', showWindow)
  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.leshao.voicekeyboard')
    app.setAboutPanelOptions({
      applicationName: '语音键盘',
      applicationVersion: app.getVersion(),
      copyright: '按键只用来选读音，不记录、不上传',
    })
    loadHook()
    const missing = missingAudios()
    if (missing.length) {
      fatal(`缺少读音：${missing.join('、')}`)
      return
    }
    const loaded = createWindow()
    if (selfTest) {
      runSelfTest(loaded)
      return
    }
    createTray()
    if (process.platform === 'darwin' && !macTrusted(false)) macTrusted(true)
    refreshTrust()
    setInterval(refreshTrust, 1500)
    publishStatus()
  })
}

ipcMain.handle('get-state', () => ({ enabled, trusted, platform: process.platform }))
ipcMain.handle('set-enabled', (_event, next) => {
  setEnabled(next)
  return { enabled, trusted, platform: process.platform }
})
ipcMain.handle('open-privacy', (_event, kind) => openPrivacy(kind))
ipcMain.handle('audios', async () => {
  const entries = await Promise.all(NAMES.map(async (name) => {
    const data = await fs.promises.readFile(path.join(audioDir(), `${name}.wav`))
    return [name, data]
  }))
  return entries
})
