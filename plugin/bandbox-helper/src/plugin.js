/**
 * BandBox辅助 —— AstroBox 插件主入口（API Level 4）。
 *
 * ⚠️ 宿主接口的调用约定（踩过的坑，务必保留）：
 *
 *   Level 4 的宿主接口几乎全部是 `async func`。在 JS 侧它们表现为 **Promise**，
 *   不 `await` 的话拿到的是 Promise 对象而不是值：
 *     - `platform()` 返回 "[object Promise]"
 *     - `getConnectedDeviceList()` 返回 Promise，`.length` 是 undefined
 *       → 设备列表恒为空、心跳永远发不出去
 *     - `pickFile()` 返回 Promise → 文件选择器的结果永远读不到，
 *       而且宿主那边的「取文件」任务没人 await，会被直接取消
 *       → 点击「选择 LRC 文件」什么都不会发生
 *
 *   顶层 `result<T, E>` 在 JS 里是「成功返回 T / 失败抛 E」，
 *   所以宿主报错的唯一入口就是 try/catch，不能靠检查返回值。
 *
 *   `option<T>` 用 `null` 表示 none（不是 undefined）。
 *
 *   因此：**所有宿主调用都必须 await**，统一走 `hostCall()`。
 *
 * 职责：
 *   - lifecycle.onLoad：初始化状态
 *   - event.onUiRender：渲染声明式 UI、刷新设备、注册手环消息接收
 *   - event.onUiEvent：处理按钮点击
 *   - event.onEvent：处理手环回执（interconnect-message）、设备动作与宿主定时器
 */
import { pickFile } from 'astrobox:psys-host-v4/dialog'
import { platform } from 'astrobox:psys-host-v4/os'
import { sendQaicMessage } from 'astrobox:psys-host-v4/interconnect'
import { registerInterconnectRecv } from 'astrobox:psys-host-v4/register'
import {
  setTimeout as setHostTimeout,
  setInterval as setHostInterval,
  clearTimer
} from 'astrobox:psys-host-v4/timer'

import lrc from './lrc.js'
import protocol from './protocol.js'
import device from './device.js'
import { resolveAction } from './actions.js'
import { renderUI } from './ui.js'
import otp from './otp.js'
import otpAccounts from './otpAccounts.js'
import otpProtocol from './otpProtocol.js'
import otpSync from './otpSync.js'

/** 等 ACK 的超时时间（毫秒） */
const ACK_TIMEOUT = 20000

/** 设备列表的最小刷新间隔（毫秒），避免频繁调宿主 */
const DEVICE_REFRESH_MIN = 2000

/**
 * 全局状态（模块级单例）。
 */
const state = {
  deviceAddr: '',
  deviceName: '',
  devices: [],
  deviceSource: '',
  lastDeviceRefresh: 0,
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
  renderTarget: '',
  timer: null,
  heartbeatTimer: null,
  heartbeatSeq: 0,
  heartbeatBusy: false,
  // 诊断信息：手机端文件选择器/事件桥接出问题时，用户可以直接看到
  platform: '',
  debug: false,
  lastUiEvent: '',
  lastAction: '',
  lastReply: '',
  pickResult: '',
  lastHost: '',
  watchOnline: false,
  // ---- 动态口令（0.3.0 新增）----
  tab: 'lyrics',
  otpSync: otpSync.createOtpSync(),
  otpLoaded: false, // 已从手环拉取过全量
  otpBusy: false, // 下发中
  otpStatusText: '点击「拉取数据」从手环读取账户',
  otpPendingId: '',
  otpPendingKind: '', // 'save' | 'pull' | 'offset'
  otpTimer: null, // OTP ACK 超时 timer（与歌词 state.timer 互不复用）
  tickTimer: null, // 1s 验证码刷新 timer
  otpOffsetSec: 0, // 手表侧 timeOffsetSec（pong/ready 同步回来）
  otpWatchCount: 0, // 手表侧账户数（pong/ready 同步回来）
  timeSkewSec: 0, // 手表时间 - 手机时间（秒），由 pong/ready 的 time 字段估算
  timeSkewHandled: false,
  otpDialog: null, // { kind, ... } 自绘弹窗
  lastOtpReply: ''
}

/**
 * 是否已有可发送的内容。
 */
function hasContent() {
  return state.lines.length > 0 && !!state.title
}

/**
 * 截断诊断字符串，避免 UI 被超长内容撑开。
 */
function clip(value, max) {
  const text = String(value == null ? '' : value)
  return text.length > max ? text.slice(0, max) + '…' : text
}

/**
 * 统一取错误文案。
 */
function errorText(e) {
  if (e === null || e === undefined) return ''
  if (typeof e === 'string') return e
  if (typeof e.message === 'string' && e.message) return e.message
  try {
    return JSON.stringify(e)
  } catch (x) {
    return String(e)
  }
}

/**
 * 把任意事件值转成可读字符串（诊断用）。
 */
function describeValue(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch (e) {
    return String(value)
  }
}

/**
 * 描述一个值的「形状」，用于诊断宿主返回值到底是什么。
 */
function shapeOf(value) {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array(' + value.length + ')'
  if (typeof value === 'object') {
    const keys = []
    for (const k in value) {
      if (Object.prototype.hasOwnProperty.call(value, k)) keys.push(k)
      if (keys.length >= 5) break
    }
    return '{' + keys.join(',') + '}'
  }
  return typeof value
}

/**
 * 调用宿主接口并统一处理异常。
 *
 * Level 4 的宿主接口都是 `async func` → JS 侧返回 Promise，必须 await；
 * 顶层 result 失败时是抛错，所以这里 catch 后转成 { ok:false, error }。
 *
 * 用 thunk 而不是 (fn, args) 是为了保持「直接调用」的语义，
 * 不改动宿主函数的 this 绑定。
 *
 * @param {string} name 接口名（诊断用）
 * @param {Function} thunk 调用宿主接口的闭包
 */
async function hostCall(name, thunk) {
  try {
    const value = await thunk()
    state.lastHost = name + ' → ' + shapeOf(value)
    return { ok: true, value }
  } catch (e) {
    state.lastHost = name + ' ✗ ' + clip(errorText(e), 60)
    return { ok: false, error: errorText(e) }
  }
}

/**
 * 取文件内容的字节数（兼容 Uint8Array / ArrayBuffer / 普通数组）。
 */
function dataLength(data) {
  if (!data) return 0
  if (typeof data.byteLength === 'number') return data.byteLength
  if (typeof data.length === 'number') return data.length
  return 0
}

/**
 * 把宿主的 pick-file 返回值摊平成 { name, data }。
 *
 * 正常情况是 record 直接摊平；这里再兼容一层嵌套 result（{ tag:'ok', val }），
 * 避免宿主换实现就读不到数据。
 */
function unwrapPickResult(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (raw.tag === 'err') return null
  if (raw.tag === 'ok') return unwrapPickResult(raw.val)
  if (typeof raw.name === 'string') {
    return { name: raw.name, data: raw.data }
  }
  if (raw.val && typeof raw.val === 'object') return unwrapPickResult(raw.val)
  return null
}

/**
 * 安卓文件选择器有时只返回 content URI 片段（没有真实文件名），
 * 用它推出来的歌名会是 `audio%3A1000012345` 之类，这里识别并回退到首行歌词。
 */
function isUriLikeName(name) {
  const text = String(name || '')
  return (
    text.indexOf('%3A') >= 0 ||
    text.indexOf('%2F') >= 0 ||
    text.indexOf('content:') === 0 ||
    text.indexOf('document%3A') === 0 ||
    text.indexOf('primary%3A') === 0
  )
}

/**
 * 选择歌名：优先 [ti:]，其次是正常文件名，最后是首行歌词。
 */
function pickTitle(parsed, fileName) {
  const fromName = lrc.titleFromFileName(fileName)
  if (parsed.title && parsed.title !== fromName) return parsed.title
  if (isUriLikeName(fileName)) {
    const first = parsed.lines && parsed.lines.length ? parsed.lines[0] : ''
    return first ? first.slice(0, 30) : '未命名'
  }
  return parsed.title || fromName || '未命名'
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
    deviceCount: state.devices.length,
    deviceSource: state.deviceSource,
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
    hasContent: hasContent(),
    watchOnline: state.watchOnline,
    debug: state.debug,
    platform: state.platform,
    lastUiEvent: state.lastUiEvent,
    lastAction: state.lastAction,
    lastReply: state.lastReply,
    pickResult: state.pickResult,
    lastHost: state.lastHost,
    // ---- 动态口令 ----
    tab: state.tab,
    otpLoaded: state.otpLoaded,
    otpBusy: state.otpBusy,
    otpStatusText: state.otpStatusText,
    otpPending: otpPendingCount(),
    otpAccounts: otpViewAccounts(),
    otpDialog: state.otpDialog,
    timeSkewSec: state.timeSkewSec
  }
}

/**
 * 待保存修改数（三态 delta）。
 */
function otpPendingCount() {
  if (!state.otpLoaded) return 0
  try {
    const d = otpSync.getSyncDelta(state.otpSync)
    return d.upsert.length + d.remove.length
  } catch (e) {
    return 0
  }
}

/**
 * OTP 列表视图：每个账户一行，带实时验证码与倒计时。
 * 每秒由 otp-tick 驱动 repaint（弹窗打开时跳过）。
 */
function otpViewAccounts() {
  if (!state.otpLoaded) return []
  const now = otp.epochSeconds()
  const offset = Number(state.otpOffsetSec) || 0
  const out = []
  for (let i = 0; i < state.otpSync.local.length; i++) {
    const a = state.otpSync.local[i]
    const st = otp.resolveOtpState(a, now, offset)
    const issuerName = a.issuer ? a.issuer + ' · ' + a.name : a.name || '未命名'
    out.push({
      id: a.id,
      title: issuerName,
      sub: a.type === 'hotp' ? 'HOTP' : 'TOTP · ' + a.period + 's',
      code: st.ok ? otp.formatCode(st.code) : '',
      remaining: st.ok ? st.remaining : 0,
      state: st.ok ? 'ok' : st.reason === 'unsupported-algorithm' ? 'unsupported' : 'invalid'
    })
  }
  return out
}

/**
 * 重绘界面。
 */
function repaint() {
  if (!state.renderTarget) return
  try {
    renderUI(state.renderTarget, viewState())
  } catch (e) {
    // QuickJS 运行时没有 console，渲染失败时只能静默；错误会留在界面状态里
  }
}

/**
 * 刷新设备列表。
 */
async function refreshDevices() {
  const res = await device.list()
  state.lastDeviceRefresh = Date.now()
  if (!res.ok) {
    state.devices = []
    state.deviceSource = ''
    state.deviceAddr = ''
    state.deviceName = ''
    state.lastError = res.reason || '无法获取设备列表'
    return res
  }

  state.devices = res.devices
  state.deviceSource = res.source || ''
  if (state.deviceAddr) {
    let stillConnected = false
    for (let i = 0; i < res.devices.length; i++) {
      if (res.devices[i].addr === state.deviceAddr) {
        stillConnected = true
        state.deviceName = res.devices[i].name
        break
      }
    }
    if (!stillConnected) {
      state.deviceAddr = ''
      state.deviceName = ''
    }
  }

  if (!state.deviceAddr && res.devices.length === 1) {
    state.deviceAddr = res.devices[0].addr
    state.deviceName = res.devices[0].name
  }
  return res
}

/**
 * 为所有已连接设备注册手环消息接收。
 *
 * 手环进入「从手机传输」页会发 ready / ping；只有提前注册，插件才能收到并回 pong。
 * 返回成功注册的数量。
 */
async function registerRecvAll() {
  let ok = 0
  for (let i = 0; i < state.devices.length; i++) {
    const addr = state.devices[i].addr
    const res = await hostCall('registerInterconnectRecv', () =>
      registerInterconnectRecv(addr, protocol.TARGET_PKG)
    )
    if (res.ok) {
      ok++
    } else {
      state.lastError = '注册手环消息接收失败：' + res.error
    }
  }
  if (!state.devices.length) {
    // 部分宿主允许空地址作为“任意设备”兜底；失败也不影响后续按设备注册
    const res = await hostCall('registerInterconnectRecv', () =>
      registerInterconnectRecv('', protocol.TARGET_PKG)
    )
    if (res.ok) ok++
  }
  return ok
}

/**
 * 向所有已连接手环发一次 hello 心跳。
 *
 * 手环侧的 `interconnect.send` 在某些固件/签名组合下不可用（会直接失败），
 * 因此连接状态不能只靠手环发 ping；手机主动发心跳，手环收到 hello 就会显示已连接。
 * 这个方向也是歌词下发使用的方向，可靠性更高。
 */
async function sendHeartbeat() {
  if (state.heartbeatBusy) return
  state.heartbeatBusy = true
  try {
    // 设备列表可能因为权限/连接时机为空；心跳时低频重试一次
    if (!state.devices.length && Date.now() - state.lastDeviceRefresh > 10000) {
      await refreshDevices()
      await registerRecvAll()
    }
    if (!state.devices.length) {
      if (state.watchOnline) {
        state.watchOnline = false
        if (state.debug) repaint()
      }
      return
    }
    state.heartbeatSeq++
    const id = protocol.makeId('hb')
    const json = protocol.hello(id)
    // OTP 心跳：同一设备遍历里多发一条 bandbox-otp hello（带手机 Unix 秒，
    // 手表用于时间偏差提示）。不新建第二个心跳 timer。
    const otpJson = otpProtocol.helloMessage(Math.floor(Date.now() / 1000))
    let sent = 0
    let lastError = ''
    for (let i = 0; i < state.devices.length; i++) {
      const addr = state.devices[i].addr
      const res = await hostCall('sendQaicMessage', () =>
        sendQaicMessage(addr, protocol.TARGET_PKG, json)
      )
      if (res.ok) {
        sent++
        // OTP hello 发送失败不影响歌词在线状态（手表→手机方向部分固件不可用）
        await hostCall('sendQaicMessage', () =>
          sendQaicMessage(addr, otpProtocol.TARGET_PKG, otpJson)
        )
      } else {
        lastError = res.error
      }
    }
    if (sent > 0) {
      state.watchOnline = true
      if (state.debug) repaint()
    } else {
      state.watchOnline = false
      // 不要覆盖更重要的解析/发送错误；只在没有错误时提示心跳失败
      if (lastError && !state.lastError) state.lastError = '心跳发送失败：' + lastError
      if (state.debug) repaint()
    }
  } finally {
    state.heartbeatBusy = false
  }
}

/**
 * 启动手机→手环心跳（5 秒一次，插件销毁时宿主会自动清理）。
 */
async function startHeartbeat() {
  if (state.heartbeatTimer !== null) return
  try {
    state.heartbeatTimer = setHostInterval(5000, 'heartbeat')
  } catch (e) {
    state.heartbeatTimer = null
    return
  }
  await sendHeartbeat()
}

/**
 * 回复手环心跳。
 */
async function replyPong(addr, id) {
  const target = addr || state.deviceAddr
  if (!target) return
  const res = await hostCall('sendQaicMessage', () =>
    sendQaicMessage(target, protocol.TARGET_PKG, protocol.pong(id))
  )
  if (!res.ok && state.debug) {
    state.lastError = '回复手环心跳失败：' + res.error
  }
}

/**
 * 回复手环 OTP 心跳。
 */
async function replyOtpPong(addr, id) {
  const target = addr || state.deviceAddr
  if (!target) return
  const msg = otpProtocol.pongMessage(
    id,
    state.otpSync.local.length,
    Number(state.otpOffsetSec) || 0,
    otp.epochSeconds()
  )
  const res = await hostCall('sendQaicMessage', () =>
    sendQaicMessage(target, otpProtocol.TARGET_PKG, msg)
  )
  if (!res.ok && state.debug) {
    state.lastError = '回复手环 OTP 心跳失败：' + res.error
  }
}

/**
 * 取消当前 ACK 超时定时器。
 *
 * QuickJS 运行时没有 setTimeout/clearTimeout，必须使用宿主 timer 接口。
 */
function stopTimer() {
  if (state.timer === null || state.timer === undefined) return
  try {
    clearTimer(state.timer)
  } catch (e) {
    // 定时器可能已经触发，忽略
  }
  state.timer = null
}

/**
 * 取消 OTP ACK 超时定时器（与歌词 stopTimer 互不复用）。
 */
function stopOtpTimer() {
  if (state.otpTimer === null || state.otpTimer === undefined) return
  try {
    clearTimer(state.otpTimer)
  } catch (e) {
    // 定时器可能已经触发，忽略
  }
  state.otpTimer = null
}

/**
 * 处理宿主 timer 事件。
 *
 * 宿主投递的 payload 是 JSON：{ timerId, kind, payload }。
 */
async function handleTimer(raw) {
  let info
  try {
    info = JSON.parse(raw)
  } catch (e) {
    return
  }
  if (info && info.payload === 'heartbeat') {
    await sendHeartbeat()
    return
  }
  // OTP 1s tick：重算验证码与倒计时；弹窗打开时跳过 repaint（防输入被清空）
  if (info && info.payload === 'otp-tick') {
    if (state.tab === 'otp' && !state.otpDialog) repaint()
    return
  }
  // OTP ACK 超时（payload 前缀 otp-ack:<id>，与歌词 pendingId 区分）
  if (info && typeof info.payload === 'string' && info.payload.indexOf('otp-ack:') === 0) {
    const id = info.payload.slice('otp-ack:'.length)
    if (id !== state.otpPendingId) return
    state.otpTimer = null
    if (!state.otpBusy) return
    state.otpBusy = false
    state.otpPendingId = ''
    state.otpPendingKind = ''
    state.otpStatusText = '未收到手环确认，内容已保留，可重试保存'
    if (state.tab === 'otp') repaint()
    return
  }
  if (!info || info.payload !== state.pendingId) return
  state.timer = null
  if (state.status !== 'sending') return
  state.status = 'failed'
  state.statusText = '手环未响应'
  state.lastError = '手环未响应（可能未停留在「从手机传输」页面）'
  repaint()
}

/**
 * 处理手环回执（信封解包后按 app 字段分流到歌词 / OTP）。
 */
async function handleReply(raw) {
  const env = protocol.unwrapInterconnectPayload(raw)

  // OTP 与歌词共用一条通道：先探测 app 字段，分流到对应处理分支。
  // 非 JSON、非 OTP 的消息一律交给歌词分支（decode 会回 bad-app 静默忽略）。
  let isOtp = false
  try {
    const probe = JSON.parse(env.data)
    if (probe && typeof probe === 'object' && probe.app === otpProtocol.APP_ID) {
      isOtp = true
    }
  } catch (e) {}

  if (isOtp) {
    await handleOtpReply(env)
  } else {
    await handleLyricsReply(env)
  }
}

/**
 * 动态口令协议回执。
 */
async function handleOtpReply(env) {
  const parsed = otpProtocol.parse(env.data)
  if (!parsed.ok) return
  const msg = parsed.msg
  state.lastOtpReply = clip(msg.type + (msg.id ? ' ' + msg.id : ''), 40)
  if (state.debug && state.tab === 'otp') repaint()

  if (msg.type === 'ready' || msg.type === 'pong' || msg.type === 'ping') {
    state.watchOnline = true
    if (msg.type === 'ping') {
      await replyOtpPong(env.addr, msg.id)
    }
    state.otpWatchCount = Math.floor(Number(msg.accountsCount) || 0)
    state.otpOffsetSec = Math.floor(Number(msg.timeOffsetSec) || 0)
    if (msg.time) {
      const skew = otp.epochSeconds() - Math.floor(Number(msg.time))
      state.timeSkewSec = Math.abs(skew) >= 3 ? skew : 0
      if (Math.abs(state.timeSkewSec) >= 5 && !state.timeSkewHandled && state.tab === 'otp') {
        state.otpDialog = {
          kind: 'offset',
          suggested: -state.timeSkewSec
        }
        state.timeSkewHandled = true
      }
      state.otpStatusText =
        '手环在线 · ' + state.otpWatchCount + ' 个账户 · 偏移 ' + state.otpOffsetSec + 's'
    }
    if (state.tab === 'otp') repaint()
    return
  }

  // 与本次 OTP 发送无关的迟到回执：按 pendingId 过滤
  if (msg.id && state.otpPendingId && msg.id !== state.otpPendingId) return

  if (msg.type === 'ack') {
    stopOtpTimer()
    state.otpBusy = false
    if (state.otpPendingKind === 'save') {
      otpSync.commitSuccess(state.otpSync)
      state.otpStatusText = '已保存到手环（' + (msg.received || 0) + ' 条）'
    } else if (state.otpPendingKind === 'offset') {
      state.otpStatusText = '已下发校时偏移，验证码应已恢复'
      state.timeSkewSec = 0
    } else {
      state.otpStatusText = '手环已确认'
    }
    state.otpPendingId = ''
    state.otpPendingKind = ''
    if (state.tab === 'otp') repaint()
    return
  }

  if (msg.type === 'err') {
    stopOtpTimer()
    state.otpBusy = false
    state.otpStatusText = otpProtocol.ERROR_TEXT[msg.reason] || ('失败：' + msg.reason)
    // 保留 otpLocal，用户可重试
    state.otpPendingId = ''
    state.otpPendingKind = ''
    if (state.tab === 'otp') repaint()
    return
  }

  if (msg.type === 'progress') {
    state.otpStatusText = '传输中 ' + (msg.received || 0) + '/' + (msg.total || 0)
    if (state.tab === 'otp' && !state.otpDialog) repaint()
    return
  }

  if (msg.type === 'accounts') {
    // list_accounts 的单条应答（小数据）
    stopOtpTimer()
    otpSync.replaceAll(state.otpSync, msg.accounts || [])
    state.otpLoaded = true
    state.otpBusy = false
    state.otpPendingId = ''
    state.otpPendingKind = ''
    state.otpStatusText = '已拉取 ' + state.otpSync.local.length + ' 个账户'
    if (state.tab === 'otp' && !state.otpDialog) repaint()
    return
  }

  if (msg.type === 'chunk') {
    // 手表→手机方向的 accounts 应答也可能分片（账户多时）
    if (!state.otpSession) state.otpSession = otpProtocol.createSession()
    const res = otpProtocol.acceptChunk(state.otpSession, msg)
    if (!res.ok) {
      state.otpSession = otpProtocol.createSession()
      return
    }
    if (!res.done) return
    const kind = res.kind
    const payload = res.payload
    state.otpSession = otpProtocol.createSession()
    if (kind === 'accounts') {
      stopOtpTimer()
      otpSync.replaceAll(state.otpSync, payload.accounts || [])
      state.otpLoaded = true
      state.otpBusy = false
      state.otpPendingId = ''
      state.otpPendingKind = ''
      state.otpStatusText = '已拉取 ' + state.otpSync.local.length + ' 个账户'
      if (state.tab === 'otp' && !state.otpDialog) repaint()
    }
    return
  }
}

/**
 * 歌词协议回执（0.2.x 逻辑逐字保留）。
 */
async function handleLyricsReply(env) {
  const parsed = protocol.decode(env.data)

  if (state.debug) {
    state.lastReply = clip(
      (env.addr || '-') + ' | ' + (env.pkgName || '-') + ' | ' +
        (parsed.ok ? parsed.msg.type : parsed.reason),
      100
    )
  }
  if (!parsed.ok) {
    if (state.debug) repaint()
    return
  }

  const msg = parsed.msg
  const addr = env.addr || state.deviceAddr

  if (msg.type === 'ping') {
    state.watchOnline = true
    await replyPong(addr, msg.id)
    if (state.status === 'idle' || state.status === 'ready') {
      state.statusText = '手环在线，等待发送'
    }
    if (state.debug) repaint()
    return
  }

  if (msg.type === 'ready') {
    state.watchOnline = true
    await replyPong(addr, msg.id)
    if (state.status !== 'sending') {
      state.statusText = hasContent() ? '手环已就绪，可以发送' : '手环已进入「从手机传输」页面'
    }
    repaint()
    return
  }

  if (msg.type === 'pong') {
    state.watchOnline = true
    if (state.debug) repaint()
    return
  }

  // 上一次发送的迟到回执：只过滤 ack / err / progress
  if (msg.id && state.pendingId && msg.id !== state.pendingId) return

  const info = protocol.describeReply(msg)

  if (msg.type === 'ack') {
    stopTimer()
    state.status = 'sent'
    state.statusText = info.text
    state.lastError = ''
    state.watchOnline = true
    repaint()
    return
  }

  if (msg.type === 'err') {
    stopTimer()
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
    state.watchOnline = true
    repaint()
    return
  }
}

/**
 * 选择文件并解析。
 */
async function doPickFile() {
  // pickFile 是异步调用，先把状态画出来
  state.statusText = '正在打开文件选择器…'
  state.lastError = ''
  state.pickResult = 'opening'
  repaint()

  const res = await hostCall('pickFile', () =>
    pickFile(
      // copy-to 是 option<string>，JS 侧用 null 表示 none
      { read: true, copyTo: null },
      { multiple: false, extensions: ['lrc'], defaultDirectory: '', defaultFileName: '' }
    )
  )

  if (!res.ok) {
    state.status = 'idle'
    state.statusText = '选择文件失败'
    state.lastError = '文件选择器调用失败：' + res.error
    state.pickResult = 'error: ' + clip(res.error, 80)
    repaint()
    return
  }

  const picked = unwrapPickResult(res.value)
  const bytes = picked ? dataLength(picked.data) : 0
  if (!picked || !bytes) {
    state.status = 'idle'
    state.statusText = '未选择文件'
    state.pickResult = picked ? 'empty: ' + picked.name : 'empty'
    repaint()
    return
  }

  state.pickResult = 'ok: ' + (picked.name || '') + ' (' + bytes + ' B)'

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
  state.title = pickTitle(parsed, picked.name)

  // 单行超预算的文件手环端切不开（会破坏「不切断一行」约定），解析期直接拒绝
  const check = protocol.checkTransferable(state.title, parsed.lines)
  if (!check.ok) {
    state.status = 'failed'
    state.statusText = '歌词文件异常，未导入'
    state.lastError =
      check.reason === 'title-too-long'
        ? '歌词文件存在异常（标题过长），手环端无法切分，导入失败' +
          '（' + check.bytes + ' 字节，上限 ' + check.limit + '）'
        : '歌词文件存在异常（单行过长），手环端无法切分，导入失败' +
          '（第 ' + (check.lineIndex + 1) + ' 行，' + check.bytes + ' 字节，上限 ' + check.limit + '）'
    state.lines = []
    state.title = ''
    state.previewLines = []
    // fileName 保留，方便用户知道是哪个文件出的问题
    repaint()
    return
  }

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
async function doSend() {
  if (!hasContent()) {
    state.lastError = '请先选择并解析一个 LRC 文件'
    repaint()
    return
  }

  if (!state.devices.length) await refreshDevices()
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
  const registered = await registerRecvAll()
  if (!registered) {
    state.status = 'failed'
    state.statusText = '无法接收手环回执'
    state.lastError = '注册手环消息接收失败（设备数：' + state.devices.length + '）'
    repaint()
    return
  }

  const plan = protocol.planSend(state.title, state.lines)
  state.pendingId = plan.id
  state.status = 'sending'
  state.sent = 0
  state.total = plan.mode === 'chunk' ? plan.total : 1
  state.statusText = '正在发送…'
  state.lastError = ''
  repaint()

  // 发送是异步的，进度只能靠手环回的 progress 消息驱动
  if (plan.mode === 'single') {
    const res = await hostCall('sendQaicMessage', () =>
      sendQaicMessage(dev.addr, protocol.TARGET_PKG, plan.json)
    )
    if (!res.ok) {
      state.status = 'failed'
      state.statusText = '发送失败'
      state.lastError = res.error
      repaint()
      return
    }
  } else {
    for (let i = 0; i < plan.chunks.length; i++) {
      const json = protocol.chunkMessage(plan.id, i, plan.total, plan.title, plan.chunks[i])
      const res = await hostCall('sendQaicMessage', () =>
        sendQaicMessage(dev.addr, protocol.TARGET_PKG, json)
      )
      if (!res.ok) {
        state.status = 'failed'
        state.statusText = '发送失败'
        state.lastError = res.error
        repaint()
        return
      }
    }
  }

  // 等 ACK：用宿主 timer（QuickJS 没有 setTimeout），到期通过 timer 事件回来
  stopTimer()
  state.timer = setHostTimeout(ACK_TIMEOUT, state.pendingId)
}

/**
 * 刷新设备列表并重新注册接收。
 */
async function doRefreshDevices() {
  await refreshDevices()
  await registerRecvAll()
  if (!state.devices.length) {
    state.lastError = '没有检测到已连接的手环'
  } else {
    state.lastError = ''
    if (!hasContent()) {
      state.statusText = '已检测到 ' + state.devices.length + ' 个手环'
    }
  }
  repaint()
}

/**
 * 选设备。
 */
async function doPickDevice(addr) {
  state.deviceAddr = addr
  for (let i = 0; i < state.devices.length; i++) {
    if (state.devices[i].addr === addr) {
      state.deviceName = state.devices[i].name
      break
    }
  }
  state.needsDeviceChoice = false
  state.statusText = '已选择 ' + (state.deviceName || addr)
  await registerRecvAll()
  repaint()
}

// ------------------------------------------------------------------
// 动态口令（0.3.0 新增）
// ------------------------------------------------------------------

/**
 * 选一台目标手环（OTP 与歌词共用设备选择）。
 */
async function otpPickDevice() {
  if (!state.devices.length) await refreshDevices()
  const picked = device.pick(state.devices, state.deviceAddr)
  if (!picked.ok) {
    if (picked.needChoice) {
      state.needsDeviceChoice = true
      state.otpStatusText = '请选择目标手环'
    } else {
      state.otpStatusText = picked.reason
    }
    return null
  }
  state.deviceAddr = picked.device.addr
  state.deviceName = picked.device.name
  state.needsDeviceChoice = false
  return picked.device
}

/**
 * 从手环拉取全量账户。
 */
async function doOtpPull() {
  const dev = await otpPickDevice()
  if (!dev) {
    repaint()
    return
  }
  const registered = await registerRecvAll()
  if (!registered) {
    state.otpStatusText = '注册手环消息接收失败'
    repaint()
    return
  }
  state.otpBusy = true
  state.otpStatusText = '正在拉取…'
  repaint()
  const id = otpProtocol.makeId('ol')
  state.otpPendingId = id
  state.otpPendingKind = 'pull'
  const res = await hostCall('sendQaicMessage', () =>
    sendQaicMessage(dev.addr, otpProtocol.TARGET_PKG, otpProtocol.listAccountsMessage(id))
  )
  if (!res.ok) {
    state.otpBusy = false
    state.otpPendingId = ''
    state.otpPendingKind = ''
    state.otpStatusText = '拉取失败：' + res.error
    repaint()
    return
  }
  stopOtpTimer()
  state.otpTimer = setHostTimeout(ACK_TIMEOUT, 'otp-ack:' + id)
}

/**
 * 下发增量（保存修改）。
 */
async function doOtpSave() {
  if (!state.otpLoaded) {
    state.otpStatusText = '请先「拉取数据」'
    repaint()
    return
  }
  const delta = otpSync.getSyncDelta(state.otpSync)
  if (!delta.upsert.length && !delta.remove.length) {
    state.otpStatusText = '没有待保存的修改'
    repaint()
    return
  }
  const dev = await otpPickDevice()
  if (!dev) {
    repaint()
    return
  }
  const registered = await registerRecvAll()
  if (!registered) {
    state.otpStatusText = '注册手环消息接收失败'
    repaint()
    return
  }
  const plan = otpProtocol.planSync('sync_delta', delta)
  if (plan.mode === 'invalid') {
    state.otpStatusText =
      otpProtocol.ERROR_TEXT[plan.reason] + '（第 ' + (plan.index + 1) + ' 条）'
    repaint()
    return
  }
  state.otpBusy = true
  state.otpStatusText = '正在下发…'
  repaint()
  const jsons = plan.mode === 'single' ? [plan.json] : plan.jsons
  for (let i = 0; i < jsons.length; i++) {
    const res = await hostCall('sendQaicMessage', () =>
      sendQaicMessage(dev.addr, otpProtocol.TARGET_PKG, jsons[i])
    )
    if (!res.ok) {
      state.otpBusy = false
      state.otpPendingId = ''
      state.otpPendingKind = ''
      state.otpStatusText = '下发失败：' + res.error
      // 保留 otpLocal 可重试
      repaint()
      return
    }
  }
  state.otpPendingId = plan.id
  state.otpPendingKind = 'save'
  stopOtpTimer()
  state.otpTimer = setHostTimeout(ACK_TIMEOUT, 'otp-ack:' + plan.id)
}

/**
 * 应用时间偏差：向手环下发 set_offset。
 */
async function doOtpApplyOffset() {
  const suggested = state.otpDialog && state.otpDialog.suggested
    ? Math.floor(state.otpDialog.suggested)
    : -state.timeSkewSec
  if (!suggested) {
    state.otpDialog = null
    repaint()
    return
  }
  const dev = await otpPickDevice()
  if (!dev) {
    repaint()
    return
  }
  state.otpDialog = null
  state.otpBusy = true
  state.otpStatusText = '正在下发校时偏移…'
  repaint()
  const id = otpProtocol.makeId('os')
  state.otpPendingId = id
  state.otpPendingKind = 'offset'
  const res = await hostCall('sendQaicMessage', () =>
    sendQaicMessage(dev.addr, otpProtocol.TARGET_PKG, otpProtocol.setOffsetMessage(suggested, id))
  )
  if (!res.ok) {
    state.otpBusy = false
    state.otpPendingId = ''
    state.otpPendingKind = ''
    state.otpStatusText = '校时失败：' + res.error
    repaint()
    return
  }
  stopOtpTimer()
  state.otpTimer = setHostTimeout(ACK_TIMEOUT, 'otp-ack:' + id)
}

/**
 * 从 eventPayload 提取输入值（TEXTAREA 的 INPUT 事件）。
 * 宿主可能给字符串、JSON 或 { value | text | content | data } 对象。
 */
function extractInputValue(payload) {
  if (payload === null || payload === undefined) return ''
  if (typeof payload === 'string') {
    try {
      const obj = JSON.parse(payload)
      if (obj && typeof obj === 'object') {
        for (const k of ['value', 'text', 'content', 'data', 'input']) {
          if (typeof obj[k] === 'string') return obj[k]
        }
        return ''
      }
    } catch (e) {
      // 非 JSON：就是原始文本
      return payload
    }
    return payload
  }
  if (typeof payload === 'object') {
    for (const k of ['value', 'text', 'content', 'data', 'input']) {
      if (typeof payload[k] === 'string') return payload[k]
    }
  }
  return ''
}

/**
 * 批量粘贴导入：解析 otpauth 文本 → 写 local（待「保存修改」下发）。
 */
async function doOtpPasteApply() {
  if (!state.otpDialog || state.otpDialog.kind !== 'paste') return
  const text = String((state.otpDialog.draft && state.otpDialog.draft.pasteText) || '')
  if (!text.trim()) {
    state.otpStatusText = '粘贴内容为空'
    repaint()
    return
  }
  const parsed = otpAccounts.parseOtpauthText(text)
  if (!parsed.accounts.length) {
    state.otpStatusText = '没有解析到有效账户，请检查文本格式'
    repaint()
    return
  }
  const count = otpSync.applyLocalUpsert(state.otpSync, parsed.accounts)
  state.otpDialog = null
  state.otpStatusText =
    '已导入 ' + count + ' 条' +
    (parsed.invalid.length ? '，' + parsed.invalid.length + ' 行无法识别' : '') +
    '，点「保存修改」同步到手环'
  repaint()
}

// ------------------------------------------------------------------
// 导出给宿主的接口
// ------------------------------------------------------------------

export const lifecycle = {
  /**
   * 插件加载完成后调用。
   *
   * 注意：安装流程会同步等待 onLoad 返回，这里不要调用任何需要权限的宿主接口，
   * 否则会在安装阶段弹权限框甚至卡住安装。
   */
  async onLoad() {
    // QuickJS 运行时没有 console，不要在这里打印日志
  }
}

export const event = {
  /**
   * 手环回执（interconnect-message）、设备动作（device-action）与宿主定时器（timer）都从这里进来。
   */
  async onEvent(eventType, eventPayload) {
    const type = String(eventType || '').toLowerCase().replace(/[-_]/g, '')
    if (type === 'interconnectmessage') {
      await handleReply(eventPayload)
    } else if (type === 'timer') {
      await handleTimer(eventPayload)
    } else if (type === 'deviceaction') {
      await refreshDevices()
      await registerRecvAll()
      await startHeartbeat()
      if (state.debug) repaint()
    }
    return ''
  },

  /**
   * UI 事件：按钮点击等。
   *
   * 不同宿主把 on(CLICK, id) 的 id 放在 eventId 或 eventPayload 里，
   * 统一交给 actions.resolveAction 解析。WIT 声明返回 string，返回 undefined 会触发 wasm trap。
   */
  async onUiEvent(eventId, uiEvent, eventPayload) {
    const action = resolveAction(eventId, eventPayload)
    state.lastUiEvent = clip(
      describeValue(eventId) + ' | ' + describeValue(eventPayload),
      120
    )
    state.lastAction = action || '未识别'

    if (action === 'pick-file') {
      await doPickFile()
    } else if (action === 'send') {
      await doSend()
    } else if (action === 'refresh-devices') {
      await doRefreshDevices()
    } else if (action === 'toggle-debug') {
      state.debug = !state.debug
      repaint()
    } else if (action && action.indexOf('pick-device:') === 0) {
      await doPickDevice(action.slice('pick-device:'.length))
    } else if (action === 'tab-lyrics') {
      state.tab = 'lyrics'
      repaint()
    } else if (action === 'tab-otp') {
      state.tab = 'otp'
      repaint()
    } else if (action === 'otp-pull') {
      await doOtpPull()
    } else if (action === 'otp-add') {
      state.otpDialog = {
        kind: 'edit',
        editId: '',
        draft: { name: '', issuer: '', secret: '' }
      }
      repaint()
    } else if (action && action.indexOf('otp-edit:') === 0) {
      const editId = action.slice('otp-edit:'.length)
      const account = state.otpSync.local.find((a) => a.id === editId)
      if (account) {
        state.otpDialog = {
          kind: 'edit',
          editId,
          draft: {
            name: account.name || '',
            issuer: account.issuer || '',
            secret: account.secret || ''
          }
        }
        repaint()
      }
    } else if (action && action.indexOf('otp-del:') === 0) {
      const delId = action.slice('otp-del:'.length)
      const account = state.otpSync.local.find((a) => a.id === delId)
      if (account) {
        state.otpDialog = {
          kind: 'del',
          id: delId,
          title: (account.issuer ? account.issuer + ' · ' : '') + (account.name || '未命名')
        }
        repaint()
      }
    } else if (action === 'otp-del-yes') {
      if (state.otpDialog && state.otpDialog.kind === 'del') {
        otpSync.applyLocalRemove(state.otpSync, state.otpDialog.id)
        state.otpDialog = null
        state.otpStatusText = '已标记删除，点「保存修改」同步到手环'
      }
      repaint()
    } else if (action === 'otp-edit-done') {
      if (state.otpDialog && state.otpDialog.kind === 'edit') {
        const draft = state.otpDialog.draft
        if (!draft.secret) {
          state.otpStatusText = '密钥不能为空'
        } else {
          // 同凭据复用已有 id：编辑场景沿用 editId，新建场景去重
          const reuse = state.otpDialog.editId
          const incoming = {
            id: reuse || otpAccounts.makeAccountId(),
            name: draft.name || '',
            issuer: draft.issuer || '',
            secret: draft.secret,
            type: 'totp',
            algorithm: 'SHA1',
            digits: 6,
            period: 30
          }
          otpSync.applyLocalUpsert(state.otpSync, [incoming])
          state.otpDialog = null
          state.otpStatusText = '已记入本地，点「保存修改」同步到手环'
        }
      }
      repaint()
    } else if (action === 'otp-save') {
      const pending = otpPendingCount()
      if (!pending) {
        state.otpStatusText = '没有待保存的修改'
        repaint()
        return ''
      }
      const delta = otpSync.getSyncDelta(state.otpSync)
      state.otpDialog = {
        kind: 'confirm-save',
        upsertCount: delta.upsert.length,
        removeCount: delta.remove.length
      }
      repaint()
    } else if (action === 'otp-confirm-save') {
      state.otpDialog = null
      await doOtpSave()
    } else if (action === 'otp-paste') {
      state.otpDialog = {
        kind: 'paste',
        draft: { pasteText: (state.otpDialog && state.otpDialog.draft && state.otpDialog.draft.pasteText) || '' }
      }
      repaint()
    } else if (action === 'otp-paste-apply') {
      await doOtpPasteApply()
    } else if (action === 'otp-export') {
      state.otpDialog = {
        kind: 'export',
        exportText: otpAccounts.exportAllAsUris(state.otpSync.local)
      }
      repaint()
    } else if (action === 'otp-export-close' || action === 'otp-dialog-close') {
      state.otpDialog = null
      repaint()
    } else if (action === 'otp-offset-apply') {
      await doOtpApplyOffset()
    } else if (action === 'otp-offset-dismiss') {
      state.timeSkewSec = 0
      if (state.otpDialog && state.otpDialog.kind === 'offset') state.otpDialog = null
      repaint()
    } else if (action && action.indexOf('otp-field:') === 0) {
      // TEXTAREA 的 INPUT 事件：只更新草稿不 repaint（避免输入被重绘清空）
      if (state.otpDialog && state.otpDialog.draft) {
        const field = action.slice('otp-field:'.length)
        const value = extractInputValue(eventPayload)
        if (field === 'pasteText') {
          state.otpDialog.draft.pasteText = value
        } else if (field === 'name') {
          state.otpDialog.draft.name = value.slice(0, otpAccounts.NAME_LIMIT)
        } else if (field === 'issuer') {
          state.otpDialog.draft.issuer = value.slice(0, otpAccounts.ISSUER_LIMIT)
        } else if (field === 'secret') {
          state.otpDialog.draft.secret = value
        }
      }
    } else if (state.debug) {
      repaint()
    }
    return ''
  },

  /**
   * 渲染插件页面。先画一帧，再请求设备列表并注册手环消息接收。
   */
  async onUiRender(elementId) {
    state.renderTarget = elementId || state.renderTarget
    const res = await hostCall('platform', () => platform())
    state.platform = res.ok ? String(res.value || '') : ''
    repaint()
    await refreshDevices()
    await registerRecvAll()
    await startHeartbeat()
    // OTP 1s tick：验证码/倒计时刷新。onUiRender 可能被多次调用，
    // 用 tickTimer !== null 防重复（照 startHeartbeat 的 heartbeatTimer 写法）
    if (state.tickTimer === null) {
      try {
        state.tickTimer = setHostInterval(1000, 'otp-tick')
      } catch (e) {
        state.tickTimer = null
      }
    }
    repaint()
  },

  /**
   * 文本卡片渲染（本插件不使用）。
   */
  async onCardRender() {}
}
