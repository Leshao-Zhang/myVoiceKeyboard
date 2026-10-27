(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.KEY_LAYOUT = api
})(typeof window !== 'undefined' ? window : global, function () {
function key(id, hook, label, spoken, extra) {
  return Object.assign({
    id,
    hook,
    label,
    spoken,
    span: 1,
    colSpan: 1,
    rowSpan: 1,
    bundled: false,
    modifier: false,
    alias: [],
  }, extra || {})
}

function gap(span) {
  return { gap: span }
}

function letters(text) {
  return text.split('').map((ch) => key(ch, ch, ch, ch, { bundled: true }))
}

function digits() {
  return '1234567890'.split('').map((ch) => key(ch, ch, ch, ch, { bundled: true }))
}

function functions(names) {
  return names.map((name) => key(name, name, name, name))
}

const layout = {
  functionRow: [
    key('ESC', 'Escape', 'Esc', '退出'),
    gap(0.55),
    ...functions(['F1', 'F2', 'F3', 'F4']),
    gap(0.45),
    ...functions(['F5', 'F6', 'F7', 'F8']),
    gap(0.45),
    ...functions(['F9', 'F10', 'F11', 'F12']),
  ],
  mainRows: [
    [
      key('BACKQUOTE', 'Backquote', '`', '反引号'),
      ...digits(),
      key('MINUS', 'Minus', '-', '减号'),
      key('EQUAL', 'Equal', '=', '等号'),
      key('BACKSPACE', 'Backspace', '⌫', '退格', { span: 2 }),
    ],
    [
      key('TAB', 'Tab', 'Tab', '跳格', { span: 1.5 }),
      ...letters('QWERTYUIOP'),
      key('BRACKET_L', 'BracketLeft', '[', '左方括号'),
      key('BRACKET_R', 'BracketRight', ']', '右方括号'),
      key('BACKSLASH', 'Backslash', '\\', '反斜杠', { span: 1.5 }),
    ],
    [
      key('CAPS', 'CapsLock', 'Caps', '大写锁定', { span: 1.75 }),
      ...letters('ASDFGHJKL'),
      key('SEMICOLON', 'Semicolon', ';', '分号'),
      key('QUOTE', 'Quote', "'", '引号'),
      key('ENTER', 'Enter', '⏎', '回车', { span: 2.25 }),
    ],
    [
      key('SHIFT', 'Shift', 'Shift', '上档', { span: 2.25 }),
      ...letters('ZXCVBNM'),
      key('COMMA', 'Comma', ',', '逗号'),
      key('PERIOD', 'Period', '.', '句号'),
      key('SLASH', 'Slash', '/', '斜杠'),
      key('SHIFT_R', 'ShiftRight', 'Shift', '右上档', { span: 2.75 }),
    ],
    [
      key('CTRL', 'Ctrl', 'Ctrl', '控制', { span: 1.5, modifier: true }),
      key('ALT', 'Alt', 'Alt', '选项', { span: 1.5, modifier: true, spokenWin: 'Alt' }),
      key('META', 'Meta', '⌘', '命令', { span: 1.5, modifier: true, labelWin: 'Win', spokenWin: 'Win' }),
      key('SPACE', 'Space', '空格', '空格', { span: 6 }),
      key('META_R', 'MetaRight', '⌘', '右命令', { span: 1.5, modifier: true, labelWin: 'Win', spokenWin: '右 Win' }),
      key('ALT_R', 'AltRight', 'Alt', '右选项', { span: 1.5, modifier: true, spokenWin: '右 Alt' }),
      key('CTRL_R', 'CtrlRight', 'Ctrl', '右控制', { span: 1.5, modifier: true }),
    ],
  ],
  printRow: [
    key('PRINT', 'PrintScreen', 'Prt', '截屏'),
    key('SCROLL', 'ScrollLock', 'Scr', '滚动锁定'),
  ],
  nav: [
    key('INSERT', 'Insert', 'Ins', '插入'),
    key('HOME', 'Home', 'Home', '行首'),
    key('PAGEUP', 'PageUp', 'PgUp', '上翻'),
    key('DELETE', 'Delete', 'Del', '删除'),
    key('END', 'End', 'End', '行尾'),
    key('PAGEDOWN', 'PageDown', 'PgDn', '下翻'),
    null, null, null,
    null,
    key('UP', 'ArrowUp', '↑', '上', { bundled: true }),
    null,
    key('LEFT', 'ArrowLeft', '←', '左', { bundled: true }),
    key('DOWN', 'ArrowDown', '↓', '下', { bundled: true }),
    key('RIGHT', 'ArrowRight', '→', '右', { bundled: true }),
  ],
}

function collect(list, out) {
  for (const item of list) {
    if (!item) continue
    if (Array.isArray(item)) collect(item, out)
    else if (item.id) out.push(item)
  }
}

function allKeys() {
  const out = []
  collect([layout.functionRow, layout.mainRows, layout.printRow, layout.nav], out)
  return out
}

layout.allKeys = allKeys
return layout
})
