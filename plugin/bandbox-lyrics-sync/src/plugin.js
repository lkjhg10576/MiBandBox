/**
 * BandBox歌词同步 —— AstroBox 插件主入口（API Level 4）。
 *
 * 职责：
 *   - lifecycle.onLoad：初始化状态、注册 interconnect 接收
 *   - event.onUiRender：渲染声明式 UI
 *   - event.onUiEvent：处理按钮点击
 *   - event.onEvent：处理手环回执（interconnect-message）
 */
import { pickFile } from 'astrobox:psys-host-v4/dialog'
import { sendQaicMessage } from 'astrobox:psys-host-v4/interconnect'
import { registerInterconnectRecv } from 'astrobox:psys-host-v4/register'

import lrc from './lrc.js'
import protocol from './protocol.js'
import device from './device.js'
import { renderUI } from './ui.js'

/** 等 ACK 的超时时间（毫秒） */
const ACK_TIMEOUT = 20000

/**
 * 全局状态（模块级单例）。
 */
const state = {
  deviceAddr: '',
  deviceName: '',
  devices: [],
  needsDeviceChoice: false,
  fileName: '',
  title: '',
  lines: [],
  previewLines: [],
  status: 'idle', // idle | ready | sending | sent | failed
  statusText: '请先选择一个 LRC 文件',
  lastError: '',
  sent: 0,
  total: 0,
  pendingId: '',
  elementId: '',
  timer: null
}

/**
 * 是否已有可发送的内容。
 */
function hasContent() {
  return state.lines.length > 0 && !!state.title
}

/**
 * 把状态整理成 UI 层需要的形状。
 */
function viewState() {
  let chars = 0
  for (let i = 0; i < state.lines.length; i++) chars += state.lines[i].length
  return {
    deviceName: state.deviceName,
    deviceAddr: state.deviceAddr,
    devices: state.devices,
    needsDeviceChoice: state.needsDeviceChoice,
    fileName: state.fileName,
    title: state.title,
    lineCount: state.lines.length,
    charCount: chars,
    previewLines: state.previewLines.slice(0, 20),
    status: state.status,
    statusText: state.statusText,
    lastError: state.lastError,
    sent: state.sent,
    total: state.total,
    hasContent: hasContent()
  }
}

/**
 * 重绘界面。
 */
function repaint() {
  if (!state.elementId) return
  try {
    renderUI(state.elementId, viewState())
  } catch (e) {
    console.log('[bandbox] repaint failed: ' + String(e))
  }
}

/**
 * 刷新设备列表。
 */
function refreshDevices() {
  const res = device.list()
  if (!res.ok) {
    state.devices = []
    state.deviceAddr = ''
    state.deviceName = ''
    return
  }
  state.devices = res.devices
  if (!state.deviceAddr && res.devices.length === 1) {
    state.deviceAddr = res.devices[0].addr
    state.deviceName = res.devices[0].name
  }
}

/**
 * 注册接收手环消息。
 */
function registerRecv() {
  try {
    registerInterconnectRecv(state.deviceAddr, protocol.TARGET_PKG)
  } catch (e) {
    console.log('[bandbox] register-interconnect-recv failed: ' + String(e))
  }
}

/**
 * 处理手环回执。
 */
function handleReply(raw) {
  const parsed = protocol.decode(raw)
  if (!parsed.ok) return
  const msg = parsed.msg
  const info = protocol.describeReply(msg)

  if (msg.type === 'ack') {
    clearTimeout(state.timer)
    state.timer = null
    state.status = 'sent'
    state.statusText = info.text
    state.lastError = ''
    repaint()
    return
  }

  if (msg.type === 'err') {
    clearTimeout(state.timer)
    state.timer = null
    state.status = 'failed'
    state.statusText = '发送失败'
    state.lastError = info.text
    repaint()
    return
  }

  if (msg.type === 'progress') {
    state.sent = msg.received || 0
    state.total = msg.total || 0
    state.statusText = '传输中 ' + state.sent + '/' + state.total
    repaint()
    return
  }

  if (msg.type === 'ready') {
    state.statusText = '手环已进入「从手机传输」页面'
    repaint()
    return
  }
}

/**
 * 选择文件并解析。
 */
function doPickFile() {
  // pick-file 是同步阻塞调用，先把状态画出来
  state.statusText = '正在打开文件选择器…'
  state.lastError = ''
  repaint()

  let picked
  try {
    picked = pickFile(
      { read: true, copyTo: undefined },
      { multiple: false, extensions: ['lrc'], defaultDirectory: '', defaultFileName: '' }
    )
  } catch (e) {
    state.status = 'idle'
    state.statusText = '选择文件失败'
    state.lastError = String(e && e.message ? e.message : e)
    repaint()
    return
  }

  if (!picked || !picked.data) {
    state.status = 'idle'
    state.statusText = '未选择文件'
    repaint()
    return
  }

  const parsed = lrc.parseLrcBytes(picked.data, picked.name)
  if (!parsed.ok) {
    state.status = 'idle'
    state.statusText = '解析失败'
    state.lastError = parsed.reason || '该文件没有可用的歌词行'
    state.lines = []
    state.title = ''
    state.fileName = picked.name || ''
    repaint()
    return
  }

  state.fileName = picked.name || ''
  state.title = parsed.title || lrc.titleFromFileName(picked.name) || '未命名'
  state.lines = parsed.lines
  state.previewLines = parsed.lines.slice(0, 20)
  state.status = 'ready'
  state.statusText = '已解析 ' + parsed.lines.length + ' 行，可以发送'
  state.lastError = ''
  repaint()
}

/**
 * 发送到手环。
 */
function doSend() {
  if (!hasContent()) {
    state.lastError = '请先选择并解析一个 LRC 文件'
    repaint()
    return
  }

  refreshDevices()
  const picked = device.pick(state.devices, state.deviceAddr)
  if (!picked.ok) {
    if (picked.needChoice) {
      state.needsDeviceChoice = true
      state.statusText = '请选择目标手环'
      state.lastError = ''
    } else {
      state.status = 'failed'
      state.statusText = '无法发送'
      state.lastError = picked.reason
    }
    repaint()
    return
  }

  const dev = picked.device
  state.deviceAddr = dev.addr
  state.deviceName = dev.name
  state.needsDeviceChoice = false
  registerRecv()

  const plan = protocol.planSend(state.title, state.lines)
  state.pendingId = plan.id
  state.status = 'sending'
  state.sent = 0
  state.total = plan.mode === 'chunk' ? plan.total : 1
  state.statusText = '正在发送…'
  state.lastError = ''
  repaint()

  // 发送是同步阻塞的，进度只能靠手环回的 progress 消息驱动
  if (plan.mode === 'single') {
    try {
      sendQaicMessage(dev.addr, protocol.TARGET_PKG, plan.json)
    } catch (e) {
      state.status = 'failed'
      state.statusText = '发送失败'
      state.lastError = String(e && e.message ? e.message : e)
      repaint()
      return
    }
  } else {
    for (let i = 0; i < plan.chunks.length; i++) {
      const json = protocol.chunkMessage(plan.id, i, plan.total, plan.title, plan.chunks[i])
      try {
        sendQaicMessage(dev.addr, protocol.TARGET_PKG, json)
      } catch (e) {
        state.status = 'failed'
        state.statusText = '发送失败'
        state.lastError = String(e && e.message ? e.message : e)
        repaint()
        return
      }
    }
  }

  // 等 ACK：超时保护
  if (state.timer) clearTimeout(state.timer)
  state.timer = setTimeout(() => {
    if (state.status === 'sending') {
      state.status = 'failed'
      state.statusText = '手环未响应'
      state.lastError = '手环未响应（可能未停留在「从手机传输」页面）'
      repaint()
    }
  }, ACK_TIMEOUT)
}

/**
 * 选设备。
 */
function doPickDevice(addr) {
  state.deviceAddr = addr
  for (let i = 0; i < state.devices.length; i++) {
    if (state.devices[i].addr === addr) {
      state.deviceName = state.devices[i].name
      break
    }
  }
  state.needsDeviceChoice = false
  state.statusText = '已选择 ' + state.deviceName
  registerRecv()
  repaint()
}

// ------------------------------------------------------------------
// 导出给宿主的接口
// ------------------------------------------------------------------

export function onLoad() {
  console.log('[bandbox] plugin loaded')
  refreshDevices()
  if (state.deviceAddr) registerRecv()
  return undefined
}

export function onUiRender(elementId) {
  state.elementId = elementId
  refreshDevices()
  repaint()
  return undefined
}

export function onUiEvent(elementId, uiEvent, eventPayload) {
  state.elementId = elementId || state.elementId
  let id = eventPayload
  if (typeof id !== 'string') {
    try {
      id = JSON.parse(eventPayload).id
    } catch (e) {
      id = String(eventPayload)
    }
  }
  if (id === 'pick-file') {
    doPickFile()
  } else if (id === 'send') {
    doSend()
  } else if (typeof id === 'string' && id.indexOf('pick-device:') === 0) {
    doPickDevice(id.slice('pick-device:'.length))
  }
  return undefined
}

export function onEvent(eventType, eventPayload) {
  if (eventType === 'interconnect-message') {
    handleReply(eventPayload)
  }
  return ''
}

export function onCardRender() {
  return undefined
}

export default { onLoad, onUiRender, onUiEvent, onEvent, onCardRender }
