const glyph = document.getElementById('glyph')
const status = document.getElementById('status')
const toggle = document.getElementById('toggle')
const access = document.getElementById('access')
const input = document.getElementById('input')

const audios = new Map()
let enabled = true
let trusted = true
let platform = ''
let heard = false

function showIdle(text) {
  glyph.textContent = text
  glyph.classList.add('idle')
  glyph.classList.remove('word')
}

function showKey(name) {
  glyph.textContent = name
  glyph.classList.remove('idle')
  glyph.classList.toggle('word', name.length > 1)
}

function paint() {
  document.body.classList.toggle('live', enabled && trusted)
  document.body.classList.toggle('paused', !enabled)
  toggle.textContent = enabled ? '暂停' : '继续'
  const mac = platform === 'darwin'
  access.hidden = !mac
  input.hidden = !mac
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

async function loadAudios() {
  const entries = await window.voice.audios()
  for (const [name, bytes] of entries) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
    const audio = new Audio(url)
    audio.preload = 'auto'
    audios.set(name, audio)
  }
}

function play(name) {
  const audio = audios.get(name)
  if (!audio) return
  audio.pause()
  audio.currentTime = 0
  audio.play().catch(() => {
    status.textContent = '这个读音没有播出来'
  })
}

toggle.addEventListener('click', async () => {
  const next = await window.voice.setEnabled(!enabled)
  enabled = next.enabled
  trusted = next.trusted
  platform = next.platform
  paint()
})

access.addEventListener('click', () => window.voice.openPrivacy('accessibility'))
input.addEventListener('click', () => window.voice.openPrivacy('input'))

window.voice.onKey((name) => {
  heard = true
  showKey(name)
  play(name)
  paint()
})

window.voice.onStatus((next) => {
  enabled = next.enabled
  trusted = next.trusted
  platform = next.platform
  paint()
})

window.voice.getState().then((state) => {
  enabled = state.enabled
  trusted = state.trusted
  platform = state.platform
  paint()
})

loadAudios().then(() => {
  if (!heard) paint()
}).catch(() => {
  status.textContent = '读音文件没有加载成功'
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
  return { ok: true, count: entries.length }
}
