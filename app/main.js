const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, session, shell, systemPreferences } = require('electron')
const fs = require('fs')
const path = require('path')

const layout = require('./keys')
const NAMES = layout.allKeys().filter((item) => item.bundled).map((item) => item.id)
const KEYS = layout.allKeys()
const MODIFIERS = new Set(KEYS.filter((item) => item.modifier).map((item) => item.id))

app.setName('语音键盘')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

const selfTest = process.env.VOICE_SELF_TEST === '1'
const ALLOWED = new Set(KEYS.map((item) => item.id))
let enabled = true
const SKINS = new Set(['black', 'white', 'pink', 'blue'])
const SKIN_BACKGROUND = {
  black: '#121212',
  white: '#f6f4ef',
  pink: '#fff5f7',
  blue: '#f3f7fb',
}
let volume = 1
let skin = 'white'
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

function customDir() {
  return path.join(app.getPath('userData'), 'custom-audios')
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function clampVolume(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return volume
  return Math.min(1, Math.max(0, number))
}

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))
    if (raw && typeof raw.volume === 'number') volume = clampVolume(raw.volume)
    if (raw && SKINS.has(raw.skin)) skin = raw.skin
  } catch (error) {
    volume = 1
    skin = 'white'
  }
}

function saveSettings() {
  const file = settingsPath()
  const body = JSON.stringify({ volume, skin })
  fs.promises.mkdir(path.dirname(file), { recursive: true })
    .then(() => fs.promises.writeFile(file, body))
    .catch(() => {})
}

function persistVolume(next) {
  volume = clampVolume(next)
  saveSettings()
  return volume
}

function persistSkin(next) {
  if (!SKINS.has(next)) return skin
  skin = next
  saveSettings()
  if (win && !win.isDestroyed()) win.setBackgroundColor(SKIN_BACKGROUND[skin])
  return skin
}

function assertKeyName(name) {
  if (typeof name !== 'string' || !ALLOWED.has(name)) {
    throw new Error('未知按键')
  }
}

function asWav(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
  if (buf.length < 44 || buf.length > 1500000) return null
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return null
  if (buf.toString('ascii', 8, 12) !== 'WAVE') return null
  return buf
}

function listCustomNames() {
  let files = []
  try {
    files = fs.readdirSync(customDir())
  } catch (error) {
    return []
  }
  return files
    .filter((file) => file.endsWith('.wav') && !file.startsWith('.'))
    .map((file) => file.slice(0, -4))
    .filter((name) => ALLOWED.has(name))
}

function suppressedByModifier(event) {
  if (!(event.ctrlKey || event.altKey || event.metaKey)) return false
  const name = keyMap.get(event.keycode)
  return !MODIFIERS.has(name)
}

function installPermissions() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'microphone' || permission === 'audioCapture')
  })
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
  const missing = []
  for (const spec of KEYS) {
    for (const hookName of [spec.hook, ...spec.alias]) {
      const code = UiohookKey[hookName]
      if (code === undefined) {
        missing.push(hookName)
        continue
      }
      const previous = keyMap.get(code)
      if (previous && previous !== spec.id) fatal(`按键码冲突：${hookName} 与 ${previous}`)
      keyMap.set(code, spec.id)
    }
  }
  if (missing.length) fatal(`缺少按键映射：${missing.join('、')}`)
  if (NAMES.length !== 40) fatal(`默认读音应为 40，实际 ${NAMES.length}`)
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
      if (!enabled || suppressedByModifier(event)) return
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
  const anchor = kind === 'input'
    ? 'Privacy_ListenEvent'
    : kind === 'microphone'
      ? 'Privacy_Microphone'
      : 'Privacy_Accessibility'
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
    width: 1180,
    height: 720,
    minWidth: 900,
    minHeight: 620,
    title: '语音键盘',
    show: false,
    backgroundColor: SKIN_BACKGROUND[skin],
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

const gotLock = selfTest || app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  if (!selfTest) app.on('second-instance', showWindow)
  app.on('before-quit', () => {
    quitting = true
    if (hookStarted) uIOhook.stop()
  })
  app.on('window-all-closed', () => {})
  app.on('activate', showWindow)
  app.whenReady().then(() => {
    installPermissions()
    loadSettings()
    if (process.platform === 'win32') app.setAppUserModelId('com.leshao.voicekeyboard')
    app.setAboutPanelOptions({
      applicationName: '语音键盘',
      applicationVersion: app.getVersion(),
      copyright: '按键只用来选读音，不记录、不上传。自己录的声音也只留在这台电脑上',
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

ipcMain.handle('export-config', async () => {
  try {
    const picked = await dialog.showSaveDialog(win, {
      title: '保存配置',
      defaultPath: '语音键盘配置.json',
      filters: [{ name: '语音键盘配置', extensions: ['json'] }],
    })
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }
    let filePath = picked.filePath
    if (!filePath.toLowerCase().endsWith('.json')) filePath += '.json'
    const audios = {}
    for (const name of listCustomNames()) {
      const wav = asWav(await fs.promises.readFile(path.join(customDir(), `${name}.wav`)))
      if (wav) audios[name] = wav.toString('base64')
    }
    await fs.promises.writeFile(filePath, JSON.stringify({
      kind: 'voice-keyboard-config',
      version: 1,
      volume,
      audios,
    }))
    return { ok: true, count: Object.keys(audios).length }
  } catch (error) {
    console.error(error)
    return { ok: false, error: '配置没有保存' }
  }
})
ipcMain.handle('import-config', async () => {
  try {
    const picked = await dialog.showOpenDialog(win, {
      title: '导入配置',
      filters: [{ name: '语音键盘配置', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true }
    const filePath = picked.filePaths[0]
    const stat = await fs.promises.stat(filePath)
    if (stat.size > 40 * 1024 * 1024) return { ok: false, error: '配置文件太大' }
    let raw
    try {
      raw = JSON.parse(await fs.promises.readFile(filePath, 'utf8'))
    } catch (error) {
      return { ok: false, error: '这份文件不是语音键盘配置' }
    }
    if (!raw || raw.kind !== 'voice-keyboard-config' || raw.version !== 1 || !raw.audios || typeof raw.audios !== 'object' || Array.isArray(raw.audios)) {
      return { ok: false, error: '这份文件不是语音键盘配置' }
    }
    const entries = []
    for (const [name, encoded] of Object.entries(raw.audios)) {
      if (!ALLOWED.has(name) || typeof encoded !== 'string') continue
      const wav = asWav(Buffer.from(encoded, 'base64'))
      if (!wav) return { ok: false, error: '配置里有一段录音无法读取' }
      entries.push([name, wav])
    }
    if (Object.keys(raw.audios).length && !entries.length) {
      return { ok: false, error: '配置里没有能用的按键' }
    }
    const nextVolume = typeof raw.volume === 'number' ? clampVolume(raw.volume) : volume
    const confirm = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['导入', '取消'],
      defaultId: 0,
      cancelId: 1,
      message: '导入会替换现在的自定义录音',
      detail: `这份配置里有 ${entries.length} 段录音。`,
    })
    if (confirm.response !== 0) return { ok: false, canceled: true }
    await fs.promises.mkdir(customDir(), { recursive: true })
    const keep = new Set(entries.map(([name]) => name))
    for (const name of listCustomNames()) {
      if (!keep.has(name)) await fs.promises.rm(path.join(customDir(), `${name}.wav`), { force: true })
    }
    for (const [name, wav] of entries) {
      const dest = path.join(customDir(), `${name}.wav`)
      const tmp = path.join(customDir(), `.${name}.wav.tmp`)
      await fs.promises.writeFile(tmp, wav)
      await fs.promises.rename(tmp, dest)
    }
    persistVolume(nextVolume)
    return { ok: true, volume: nextVolume, entries }
  } catch (error) {
    console.error(error)
    return { ok: false, error: '配置没有导入' }
  }
})
ipcMain.handle('get-state', () => ({ enabled, trusted, platform: process.platform, volume, skin }))
ipcMain.handle('set-volume', (_event, next) => persistVolume(next))
ipcMain.handle('set-skin', (_event, next) => persistSkin(next))
ipcMain.handle('custom-audios', async () => {
  const entries = []
  for (const name of listCustomNames()) {
    try {
      const data = await fs.promises.readFile(path.join(customDir(), `${name}.wav`))
      if (data.length >= 44 && data.toString('ascii', 0, 4) === 'RIFF') entries.push([name, data])
    } catch (error) {
      continue
    }
  }
  return entries
})
ipcMain.handle('save-custom', async (_event, name, data) => {
  assertKeyName(name)
  const buf = asWav(data)
  if (!buf) throw new Error('这段录音无法保存')
  await fs.promises.mkdir(customDir(), { recursive: true })
  const dest = path.join(customDir(), `${name}.wav`)
  const tmp = path.join(customDir(), `.${name}.wav.tmp`)
  await fs.promises.writeFile(tmp, buf)
  await fs.promises.rename(tmp, dest)
  return true
})
ipcMain.handle('reset-config', async () => {
  const confirm = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['恢复默认', '取消'],
    defaultId: 0,
    cancelId: 1,
    message: '恢复默认会清掉现在的自定义录音',
    detail: '音量也会回到原来的大小。皮肤不变。',
  })
  if (confirm.response !== 0) return { ok: false, canceled: true }
  for (const name of listCustomNames()) {
    await fs.promises.rm(path.join(customDir(), `${name}.wav`), { force: true })
  }
  persistVolume(1)
  return { ok: true, volume: 1 }
})
ipcMain.handle('clear-custom', async (_event, name) => {
  assertKeyName(name)
  await fs.promises.rm(path.join(customDir(), `${name}.wav`), { force: true })
  return true
})
ipcMain.handle('ensure-mic', async () => {
  if (process.platform !== 'darwin' || typeof systemPreferences.askForMediaAccess !== 'function') {
    return { ok: true }
  }
  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted') return { ok: true }
  if (status === 'denied' || status === 'restricted') return { ok: false }
  return { ok: Boolean(await systemPreferences.askForMediaAccess('microphone')) }
})
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
