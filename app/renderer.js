const glyph = document.getElementById('glyph')
const status = document.getElementById('status')
const toggle = document.getElementById('toggle')
const access = document.getElementById('access')
const input = document.getElementById('input')
const custom = document.getElementById('custom')
const customToggle = document.getElementById('custom-toggle')
const board = document.getElementById('board')
const volumeInput = document.getElementById('volume')
const skinMenu = document.getElementById('skin-menu')
const skinList = document.getElementById('skin-list')
const skinCurrent = document.getElementById('skin-current')
const exportConfig = document.getElementById('export-config')
const importConfig = document.getElementById('import-config')
const resetConfig = document.getElementById('reset-config')
const recBar = document.getElementById('rec-bar')
const configActions = document.getElementById('config-actions')
const recLabel = document.getElementById('rec-label')
const recSave = document.getElementById('rec-save')
const recCancel = document.getElementById('rec-cancel')

const layout = window.KEY_LAYOUT
const specs = layout.allKeys()
const specById = new Map(specs.map((item) => [item.id, item]))
const RECORD_MS = 4000

const audios = new Map()
const clipUrls = new Map()
const bundled = new Map()
const customBytes = new Map()

let enabled = true
let trusted = true
let platform = ''
let heard = false
let volume = 1
let skin = 'white'
let mode = 'live'
let recordingName = null
let arming = false
let rec = null
let volumeTimer = 0
let notice = ''

function specOf(name) {
  return specById.get(name)
}

function face(spec) {
  if (platform === 'win32' && spec.labelWin) return spec.labelWin
  return spec.label
}

function spoken(name) {
  const spec = specOf(name)
  if (!spec) return name
  if (platform === 'win32' && spec.spokenWin) return spec.spokenWin
  return spec.spoken
}

function labelOf(name) {
  const spec = specOf(name)
  return spec ? face(spec) : name
}

function hasDefault(name) {
  const spec = specOf(name)
  return Boolean(spec && spec.bundled)
}

function micDenied() {
  if (platform === 'win32') return '没有麦克风权限。请在系统里允许语音键盘使用麦克风'
  return '没有麦克风权限。请到系统设置的麦克风里允许语音键盘'
}

function showIdle(text) {
  glyph.textContent = text
  glyph.classList.add('idle')
  glyph.classList.remove('word')
}

function showKey(name) {
  const text = labelOf(name)
  glyph.textContent = text
  glyph.classList.remove('idle')
  glyph.classList.toggle('word', text.length > 1)
}

function paint() {
  document.body.classList.toggle('live', enabled && trusted)
  document.body.classList.toggle('paused', !enabled)
  document.body.classList.toggle('custom', mode === 'custom')
  toggle.textContent = enabled ? '暂停' : '继续'
  customToggle.textContent = mode === 'custom' ? '完成' : '自定义音频'
  customToggle.setAttribute('aria-pressed', mode === 'custom' ? 'true' : 'false')
  custom.hidden = mode !== 'custom'
  glyph.hidden = mode === 'custom'
  const recording = Boolean(recordingName || arming)
  recBar.hidden = !recordingName
  configActions.hidden = Boolean(recordingName)
  if (recordingName) recLabel.textContent = `正在录 ${spoken(recordingName)}`
  exportConfig.disabled = recording
  importConfig.disabled = recording
  resetConfig.disabled = recording
  recSave.disabled = !recordingName
  recCancel.disabled = !recordingName
  const mac = platform === 'darwin'
  access.hidden = !mac
  input.hidden = !mac
  if (notice && !recordingName && !arming) {
    status.textContent = notice
    return
  }
  if (mode === 'custom' && recording) {
    status.textContent = recordingName
      ? `正在录 ${spoken(recordingName)}，可以取消`
      : '正在打开麦克风'
    return
  }
  if (mode === 'custom') {
    status.textContent = '没有原来读音、也没录过的键不出声'
    return
  }
  if (!trusted) {
    status.textContent = '需要允许辅助功能。若允许后仍无声，再打开输入监控'
    if (!heard) showIdle('允许辅助功能后，切到其他软件按键就会读出来')
    return
  }
  if (!enabled) {
    status.textContent = '已暂停'
    return
  }
  status.textContent = heard ? '后台读音开着，关掉窗口也会继续' : '可以切到其他软件，按键就会读出来'
  if (!heard) showIdle('按键就会读出来')
}

function dropClip(name) {
  const prev = clipUrls.get(name)
  if (prev) URL.revokeObjectURL(prev)
  clipUrls.delete(name)
  audios.delete(name)
}

function setClip(name, bytes) {
  dropClip(name)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
  const audio = new Audio(url)
  audio.preload = 'auto'
  audio.volume = volume
  clipUrls.set(name, url)
  audios.set(name, audio)
}

async function loadAudios() {
  const entries = await window.voice.audios()
  for (const [name, bytes] of entries) {
    bundled.set(name, bytes)
    if (!customBytes.has(name)) setClip(name, bytes)
  }
  const custom = await window.voice.customAudios()
  for (const [name, bytes] of custom) {
    customBytes.set(name, bytes)
    setClip(name, bytes)
  }
}

function play(name) {
  const audio = audios.get(name)
  if (!audio) return
  audio.volume = volume
  audio.pause()
  audio.currentTime = 0
  audio.play().catch(() => {
    status.textContent = '这个读音没有播出来'
  })
}

const SKIN_LABEL = { black: '黑色', white: '白色', pink: '粉色', blue: '蓝色' }

function applySkin(next) {
  skin = SKIN_LABEL[next] ? next : 'white'
  document.body.dataset.skin = skin
  skinMenu.dataset.skin = skin
  skinCurrent.textContent = SKIN_LABEL[skin]
  for (const button of skinList.querySelectorAll('[data-skin]')) {
    button.setAttribute('aria-checked', button.dataset.skin === skin ? 'true' : 'false')
  }
}

function setThemeOpen(open) {
  skinList.hidden = !open
  skinMenu.setAttribute('aria-expanded', open ? 'true' : 'false')
}

function applyVolume(next) {
  volume = next
  volumeInput.value = String(Math.round(volume * 100))
  for (const audio of audios.values()) audio.volume = volume
}

function rememberVolume(next) {
  applyVolume(next)
  clearTimeout(volumeTimer)
  volumeTimer = setTimeout(() => {
    window.voice.setVolume(volume)
  }, 120)
}

function resetClips() {
  for (const name of [...audios.keys()]) {
    if (!bundled.has(name) && !customBytes.has(name)) dropClip(name)
  }
  for (const [name, bytes] of bundled) {
    if (!customBytes.has(name)) setClip(name, bytes)
  }
  for (const [name, bytes] of customBytes) setClip(name, bytes)
}

function keycap(spec, grid) {
  const name = spec.id
  const covered = customBytes.has(name)
  const defaults = hasDefault(name)
  const recording = recordingName === name
  const blocked = arming || Boolean(recordingName && recordingName !== name)
  const key = document.createElement('div')
  key.className = `key${covered ? ' covered' : defaults ? ' plain' : ' empty'}${recording ? ' recording' : ''}`
  if (grid && spec.colSpan > 1) key.classList.add('col2')
  if (grid && spec.rowSpan > 1) key.classList.add('row2')
  key.dataset.name = name
  key.style.setProperty('--span', String(spec.span || 1))
  const cap = document.createElement('span')
  const text = face(spec)
  cap.className = 'keycap'
  cap.classList.toggle('compact', text.length > 1 && (spec.span || 1) < 2 && (spec.colSpan || 1) < 2)
  cap.textContent = text
  const restore = document.createElement('button')
  restore.type = 'button'
  restore.className = 'restore'
  restore.textContent = defaults ? '恢复' : '去掉'
  const restoreIdle = !covered || recording
  restore.classList.toggle('is-idle', restoreIdle)
  restore.disabled = blocked || restoreIdle
  restore.tabIndex = restoreIdle ? -1 : 0
  restore.setAttribute('aria-hidden', restoreIdle ? 'true' : 'false')
  restore.title = defaults ? `恢复 ${spoken(name)} 原来的读音` : `去掉 ${spoken(name)} 的录音`
  restore.addEventListener('click', (event) => {
    event.stopPropagation()
    onRestore(name)
  })
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = 'cancel'
  cancel.textContent = '取消'
  cancel.classList.toggle('is-idle', !recording)
  cancel.disabled = !recording
  cancel.tabIndex = recording ? 0 : -1
  cancel.setAttribute('aria-hidden', recording ? 'false' : 'true')
  cancel.title = '取消这次录音'
  cancel.addEventListener('click', (event) => {
    event.stopPropagation()
    stopRecording(false)
  })
  const legend = document.createElement('span')
  legend.className = 'face'
  legend.append(cap, recording ? cancel : restore)
  key.append(legend)
  key.addEventListener('click', () => onRecord(name))
  return key
}

function renderFlex(items, className) {
  const row = document.createElement('div')
  row.className = className
  for (const item of items) {
    if (item.gap) {
      const spacer = document.createElement('div')
      spacer.className = 'spacer'
      spacer.style.setProperty('--span', String(item.gap))
      row.append(spacer)
    } else {
      row.append(keycap(item, false))
    }
  }
  return row
}

function renderCells(items, className) {
  const grid = document.createElement('div')
  grid.className = className
  for (const item of items) {
    if (!item) {
      const hole = document.createElement('div')
      hole.className = 'slot'
      grid.append(hole)
    } else {
      grid.append(keycap(item, true))
    }
  }
  return grid
}

function renderBoard() {
  const kb = document.createElement('div')
  kb.className = 'kb'
  const main = document.createElement('div')
  main.className = 'kb-col'
  main.append(renderFlex(layout.functionRow, 'fn-row'))
  const rows = document.createElement('div')
  rows.className = 'rows'
  for (const row of layout.mainRows) rows.append(renderFlex(row, 'row'))
  main.append(rows)
  const cluster = document.createElement('div')
  cluster.className = 'kb-col'
  cluster.append(renderFlex(layout.printRow, 'fn-row'))
  cluster.append(renderCells(layout.nav, 'nav'))
  kb.append(main, cluster)
  board.replaceChildren(kb)
}

function concatFloats(chunks) {
  let length = 0
  for (const chunk of chunks) length += chunk.length
  const out = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function encodeWav(samples, sampleRate) {
  const dataBytes = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, dataBytes, true)
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }
  return new Uint8Array(buffer)
}

function teardownRecorder(current) {
  clearTimeout(current.timer)
  current.processor.onaudioprocess = null
  try { current.source.disconnect() } catch (error) { /* already stopped */ }
  try { current.processor.disconnect() } catch (error) { /* already stopped */ }
  try { current.mute.disconnect() } catch (error) { /* already stopped */ }
  current.stream.getTracks().forEach((track) => track.stop())
  const sampleRate = current.ctx.sampleRate
  const samples = concatFloats(current.chunks)
  current.ctx.close()
  return { sampleRate, samples }
}

async function stopRecording(save) {
  if (!rec) return
  const current = rec
  rec = null
  recordingName = null
  notice = ''
  const { sampleRate, samples } = teardownRecorder(current)
  const tooShort = samples.length < sampleRate * 0.12
  if (!save || tooShort) {
    if (save && tooShort) notice = '录音太短，没有保存'
    renderBoard()
    paint()
    return
  }
  const wav = encodeWav(samples, sampleRate)
  try {
    await window.voice.saveCustom(current.name, wav)
  } catch (error) {
    notice = '这段录音没有保存'
    renderBoard()
    paint()
    return
  }
  customBytes.set(current.name, wav)
  setClip(current.name, wav)
  renderBoard()
  paint()
}

async function startRecording(name) {
  if (arming || recordingName) return
  arming = true
  notice = ''
  renderBoard()
  paint()
  let stream = null
  try {
    const mic = await window.voice.ensureMic()
    if (!mic || !mic.ok) {
      notice = micDenied()
      return
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      },
    })
    const ctx = new AudioContext()
    if (ctx.state === 'suspended') await ctx.resume()
    const source = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    const mute = ctx.createGain()
    mute.gain.value = 0
    const chunks = []
    processor.onaudioprocess = (event) => {
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
    }
    source.connect(processor)
    processor.connect(mute)
    mute.connect(ctx.destination)
    const timer = setTimeout(() => {
      stopRecording(true)
    }, RECORD_MS)
    rec = { name, stream, ctx, processor, mute, source, chunks, timer }
    recordingName = name
  } catch (error) {
    if (stream && !rec) stream.getTracks().forEach((track) => track.stop())
    const reason = error && error.name
    notice = reason === 'NotAllowedError' || reason === 'SecurityError'
      ? micDenied()
      : '麦克风没有打开'
  } finally {
    arming = false
    renderBoard()
    paint()
  }
}

function onRecord(name) {
  if (arming) return
  if (recordingName && recordingName !== name) return
  if (recordingName === name) {
    stopRecording(true)
    return
  }
  startRecording(name)
}

async function onRestore(name) {
  if (recordingName || arming || !customBytes.has(name)) return
  notice = ''
  try {
    await window.voice.clearCustom(name)
  } catch (error) {
    notice = '没有回到原来的读音'
    paint()
    return
  }
  customBytes.delete(name)
  const bytes = bundled.get(name)
  if (bytes) setClip(name, bytes)
  else dropClip(name)
  renderBoard()
  paint()
}

volumeInput.addEventListener('input', () => {
  rememberVolume(Number(volumeInput.value) / 100)
})

skinMenu.addEventListener('click', () => {
  setThemeOpen(skinList.hidden)
})

skinList.addEventListener('click', (event) => {
  const item = event.target.closest('[data-skin]')
  if (!item) return
  applySkin(item.dataset.skin)
  window.voice.setSkin(skin)
  setThemeOpen(false)
})

document.addEventListener('click', (event) => {
  if (!event.target.closest('.theme')) setThemeOpen(false)
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setThemeOpen(false)
})

toggle.addEventListener('click', async () => {
  notice = ''
  const next = await window.voice.setEnabled(!enabled)
  enabled = next.enabled
  trusted = next.trusted
  platform = next.platform
  paint()
})

customToggle.addEventListener('click', async () => {
  notice = ''
  if (recordingName) await stopRecording(true)
  mode = mode === 'custom' ? 'live' : 'custom'
  if (mode === 'custom') renderBoard()
  paint()
})

recSave.addEventListener('click', () => stopRecording(true))
recCancel.addEventListener('click', () => stopRecording(false))

exportConfig.addEventListener('click', async () => {
  if (recordingName || arming) return
  notice = ''
  const result = await window.voice.exportConfig()
  if (!result || result.canceled) return
  notice = result.ok ? `已保存配置，里面有 ${result.count} 段录音` : (result.error || '配置没有保存')
  paint()
})

resetConfig.addEventListener('click', async () => {
  if (recordingName || arming) return
  notice = ''
  const result = await window.voice.resetConfig()
  if (!result || result.canceled) return
  if (!result.ok) {
    notice = result.error || '没有恢复默认'
    paint()
    return
  }
  customBytes.clear()
  if (typeof result.volume === 'number') applyVolume(result.volume)
  resetClips()
  renderBoard()
  notice = '已恢复默认，自定义录音已清空'
  paint()
})

importConfig.addEventListener('click', async () => {
  if (recordingName || arming) return
  notice = ''
  const result = await window.voice.importConfig()
  if (!result || result.canceled) return
  if (!result.ok) {
    notice = result.error || '配置没有导入'
    paint()
    return
  }
  customBytes.clear()
  for (const [name, bytes] of result.entries) customBytes.set(name, bytes)
  if (typeof result.volume === 'number') applyVolume(result.volume)
  resetClips()
  renderBoard()
  notice = `已导入 ${result.entries.length} 段录音`
  paint()
})

access.addEventListener('click', () => window.voice.openPrivacy('accessibility'))
input.addEventListener('click', () => window.voice.openPrivacy('input'))

window.voice.onKey((name) => {
  if (!audios.has(name)) return
  if (!recordingName && !arming) notice = ''
  heard = true
  showKey(name)
  if (recordingName || arming) {
    paint()
    return
  }
  play(name)
  paint()
})

window.voice.onStatus((next) => {
  enabled = next.enabled
  trusted = next.trusted
  platform = next.platform
  paint()
})

document.addEventListener('visibilitychange', () => {
  if (document.hidden && recordingName) stopRecording(true)
})

window.voice.getState().then((state) => {
  enabled = state.enabled
  trusted = state.trusted
  platform = state.platform
  if (typeof state.volume === 'number') applyVolume(state.volume)
  if (state.skin) applySkin(state.skin)
  paint()
})

loadAudios().then(() => {
  if (mode === 'custom') renderBoard()
  if (!heard) paint()
}).catch(() => {
  notice = '读音文件没有加载成功'
  paint()
})

window.runSelfTest = async () => {
  const entries = await window.voice.audios()
  if (!Array.isArray(entries) || entries.length !== 40) {
    return { ok: false, error: `读音数量应为 40，实际 ${entries ? entries.length : 0}` }
  }
  const found = entries.find(([name]) => name === 'A')
  if (!found) return { ok: false, error: '缺少 A.wav' }
  const audio = new Audio(URL.createObjectURL(new Blob([found[1]], { type: 'audio/wav' })))
  audio.volume = 0
  try {
    await audio.play()
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error) }
  }
  audio.pause()
  const wav = encodeWav(new Float32Array(1000), 16000)
  if (wav[0] !== 0x52 || wav[1] !== 0x49 || wav[2] !== 0x46 || wav[3] !== 0x46) {
    return { ok: false, error: 'wav 头不对' }
  }
  const themeItems = [...skinList.querySelectorAll('[data-skin]')].map((item) => item.dataset.skin)
  if (themeItems.join(',') !== 'black,white,pink,blue') {
    return { ok: false, error: '皮肤应为黑白粉蓝四套' }
  }
  applySkin('blue')
  const blueItem = skinList.querySelector('[data-skin="blue"]')
  if (document.body.dataset.skin !== 'blue' || blueItem.getAttribute('aria-checked') !== 'true' || skinCurrent.textContent !== '蓝色') {
    return { ok: false, error: '蓝色皮肤没有标成选中' }
  }
  applySkin('white')
  const bundledCount = specs.filter((item) => item.bundled).length
  if (bundledCount !== 40) return { ok: false, error: `默认读音键应为 40，实际 ${bundledCount}` }
  customBytes.clear()
  recordingName = null
  renderBoard()
  const keys = document.querySelectorAll('#board .key')
  if (keys.length !== specs.length) {
    return { ok: false, error: `键盘应为 ${specs.length} 键，实际 ${keys.length}` }
  }
  if (document.querySelectorAll('#board .key.plain').length !== 40) {
    return { ok: false, error: '有默认读音的键没有标成浅色' }
  }
  if (document.querySelectorAll('#board .key.empty').length !== specs.length - 40) {
    return { ok: false, error: '没有声音的键没有标成灰色' }
  }
  const hint = document.getElementById('custom-hint').textContent
  if (!hint.includes('点击虚拟键盘录制') || !hint.includes('敲真实键盘播放预览')) {
    return { ok: false, error: '界面上应有居中的录制和预览提示' }
  }
  if (document.querySelector('#board .icon')) {
    return { ok: false, error: '键盘上不应再有播放或录音按钮' }
  }
  const plain = document.querySelector('#board .key.plain')
  if (!plain || !plain.querySelector('.keycap')) {
    return { ok: false, error: '默认读音的键应有文字' }
  }
  const empty = document.querySelector('#board .key.empty')
  if (!empty || !empty.querySelector('.keycap')) {
    return { ok: false, error: '没有声音的键应有文字' }
  }
  customBytes.set('A', found[1])
  customBytes.set('SPACE', found[1])
  renderBoard()
  const coveredA = document.querySelector('#board .key.covered[data-name="A"]')
  if (!coveredA || coveredA.querySelector('.icon') || !coveredA.querySelector('.restore:not(.is-idle)')) {
    return { ok: false, error: '录过的字母键应能恢复，且没有录音按钮' }
  }
  const space = document.querySelector('#board .key.covered[data-name="SPACE"]')
  if (!space || space.querySelector('.icon')) {
    return { ok: false, error: '空格录过音后不应有录音按钮' }
  }
  recordingName = 'SPACE'
  renderBoard()
  const live = document.querySelector('#board .key.recording[data-name="SPACE"]')
  if (!live || !live.querySelector('.cancel')) return { ok: false, error: '重新录音时没有取消' }
  recordingName = null
  return { ok: true, count: entries.length }
}
