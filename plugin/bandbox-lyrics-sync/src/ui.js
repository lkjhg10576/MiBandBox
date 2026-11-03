/**
 * 插件界面：使用 AstroBox 原生声明式 UI（ui 接口）。
 *
 * 注意：v4 的 ui 元素方法名是 camelCase（flexDirection / scrollTop ...），
 * 枚举值是大写字符串（'DIV' / 'BUTTON' / 'SCROLL-AREA' ...）。
 */
import { Element, render } from 'astrobox:psys-host-v4/ui'

const C = {
  bg: '#111417',
  card: '#1E2226',
  text: '#FFFFFF',
  dim: 'rgba(255,255,255,0.55)',
  accent: '#0D6EFF',
  ok: '#00A846',
  warn: '#FF9F0A'
}

/**
 * 造一个元素。
 */
function el(type, content) {
  return new Element(type, content === undefined ? undefined : String(content))
}

/**
 * 造一个文本块。
 */
function text(content, color, size) {
  return el('P', content).textColor(color || C.text).size(size || 14)
}

/**
 * 造一个卡片容器。
 */
function card(children) {
  const c = el('DIV').bg(C.card).radius(16).padding(14).widthFull()
  for (let i = 0; i < children.length; i++) {
    c.child(children[i])
  }
  return c
}

/**
 * 造一个按钮。
 */
function button(label, id, bgColor) {
  return el('BUTTON', label)
    .bg(bgColor || C.accent)
    .textColor('#FFFFFF')
    .radius(12)
    .padding(10)
    .on('CLICK', id)
}

/**
 * 根据状态构造整棵元素树并渲染。
 *
 * @param {string} elementId 宿主分配的组件 id
 * @param {object} state 插件状态
 */
export function renderUI(elementId, state) {
  const root = el('DIV').flexDirection('COLUMN').padding(16).gap(12).widthFull()

  // ---- 顶部：手环信息 ----
  const devLines = []
  if (state.deviceName) {
    const online = state.watchOnline ? ' · 在线' : ''
    const saved = state.deviceSource === 'saved' ? ' · 历史设备' : ''
    devLines.push(text('手环：' + state.deviceName + saved + online, C.text, 15))
  } else {
    devLines.push(text('未检测到已连接的手环', C.dim, 15))
    devLines.push(text('请确认 AstroBox 已连接手环，并允许插件的设备权限', C.dim, 12))
  }
  if (state.deviceAddr) {
    devLines.push(text(state.deviceAddr, C.dim, 12))
  }
  if (state.deviceCount > 1) {
    devLines.push(text('共 ' + state.deviceCount + ' 个已连接设备', C.dim, 12))
  }
  root.child(card(devLines))

  // ---- 状态区 ----
  const statusColor =
    state.status === 'sent' ? C.ok :
    state.status === 'failed' ? C.warn :
    state.status === 'sending' ? C.accent : C.dim
  root.child(card([text(state.statusText, statusColor, 15)]))

  // ---- 设备刷新 / 诊断 ----
  const tools = el('DIV').flex().flexDirection('ROW').gap(8).widthFull()
  tools.child(button('刷新设备', 'refresh-devices', '#33383D').flexGrow(1))
  tools.child(button(state.debug ? '关闭诊断' : '诊断', 'toggle-debug', '#33383D').flexGrow(1))
  root.child(tools)

  // ---- 诊断（放在顶部，避免被预览区挤出屏幕）----
  if (state.debug) {
    const dbg = []
    dbg.push(text('平台：' + (state.platform || '未知'), C.dim, 12))
    dbg.push(
      text(
        '设备：' + state.deviceCount + ' 个' +
          (state.deviceSource ? '（' + state.deviceSource + '）' : ''),
        C.dim,
        12
      )
    )
    dbg.push(text('UI：' + (state.lastUiEvent || '无'), C.dim, 12))
    dbg.push(text('动作：' + (state.lastAction || '无'), C.dim, 12))
    dbg.push(text('手环：' + (state.lastReply || '无'), C.dim, 12))
    dbg.push(text('选择：' + (state.pickResult || '无'), C.dim, 12))
    dbg.push(text('宿主：' + (state.lastHost || '无'), C.dim, 12))
    root.child(card(dbg))
  }

  // ---- 选择文件 ----
  root.child(button('选择 LRC 文件', 'pick-file'))

  // ---- 预览 ----
  if (state.fileName || state.title) {
    const preview = []
    preview.push(text('歌名：' + (state.title || '（未命名）'), C.text, 15))
    preview.push(
      text(
        '行数：' + state.lineCount + '  字数：' + state.charCount,
        C.dim,
        13
      )
    )
    const sample = state.previewLines.join('\n')
    if (sample) {
      const box = el('SCROLL-AREA').height(160).widthFull().bg('#15181B').radius(10)
      box.child(text(sample, C.dim, 13))
      preview.push(box)
    }
    root.child(card(preview))
  }

  // ---- 发送 ----
  if (state.hasContent) {
    root.child(button('发送到手环', 'send', state.status === 'sending' ? C.dim : C.accent))
  }

  // ---- 多设备选择 ----
  if (state.needsDeviceChoice && state.devices.length > 1) {
    const opts = []
    opts.push(text('选择目标手环：', C.text, 15))
    for (let i = 0; i < state.devices.length; i++) {
      const d = state.devices[i]
      opts.push(button(d.name + ' (' + d.addr + ')', 'pick-device:' + d.addr, '#33383D'))
    }
    root.child(card(opts))
  }

  // ---- 错误 ----
  if (state.lastError) {
    root.child(card([text(state.lastError, C.warn, 13)]))
  }

  render(elementId, root)
}

export default { renderUI }
