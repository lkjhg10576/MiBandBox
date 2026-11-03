/**
 * 手机端互传通道封装（@system.interconnect）。
 *
 * 官方文档形态：
 *   import interconnect from '@system.interconnect'
 *   const connect = interconnect.instance()
 *   connect.onmessage = (data) => {}   // data 为字符串
 *   connect.send({ data, success, fail })
 *
 * 社区形态：
 *   interconn.subscribe(evt => evt.data ?? evt.payloadText)
 *
 * 两种形态都兼容：取值时兼容 string 与 { data } / { payloadText }。
 *
 * 连接状态说明：
 *   `getReadyState` / `diagnosis` 判断的是 Vela 配套 App 的连接状态；
 *   在 AstroBox 这种“非官方配套 App”场景下并不可靠，所以这里只把它当提示，
 *   页面最终以 ping/pong 心跳为准。
 */
import interconnect from '@system.interconnect'

let connect = null
let boundConnect = null
let inited = false
let subscribed = false

// 订阅者列表（模块级）
const listeners = []
const statusListeners = []

// 最后一条消息缓存：页面刚订阅时能立刻拿到，避免「刚进页面就收到消息」丢失
let lastMessage = null

// 0 未知 / 1 连接打开 / 2 连接关闭
let linkState = 0

// onmessage 与 subscribe 同时可用时，同一条消息可能被投递两次，这里做一次去重
let lastDispatchText = ''
let lastDispatchAt = 0

/**
 * 取出消息文本：兼容字符串与对象形态。
 */
function extractText(raw) {
  if (raw == null) return ''
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object') {
    if (typeof raw.data === 'string') return raw.data
    if (typeof raw.payloadText === 'string') return raw.payloadText
    if (typeof raw.payload === 'string') return raw.payload
    if (raw.data != null && typeof raw.data.toString === 'function') {
      return String(raw.data)
    }
  }
  return String(raw)
}

/**
 * 把收到的消息分发给所有订阅者。
 */
function dispatch(raw) {
  const text = extractText(raw)
  if (!text) return
  const now = Date.now()
  if (text === lastDispatchText && now - lastDispatchAt < 80) return
  lastDispatchText = text
  lastDispatchAt = now
  lastMessage = text
  // 先分发给页面（页面会立即标记已连接），再更新连接状态，避免触发多余探测
  for (let i = 0; i < listeners.length; i++) {
    try {
      listeners[i](text)
    } catch (e) {}
  }
  // 收到任何消息都说明对端在线
  if (linkState !== 1) setLinkState(1)
}

/**
 * 通知连接状态变化。
 */
function notifyStatus() {
  for (let i = 0; i < statusListeners.length; i++) {
    try {
      statusListeners[i](linkState)
    } catch (e) {}
  }
}

/**
 * 更新连接状态（去重后通知）。
 */
function setLinkState(next) {
  if (linkState === next) return
  linkState = next
  notifyStatus()
}

/**
 * 初始化连接对象与消息回调。全局只需调用一次。
 */
function init() {
  // 注意：instance() 在 App 启动早期可能返回 null；不能在失败时把 inited
  // 永久置为 true，否则整个生命周期都不会再尝试初始化。
  if (connect) return connect
  try {
    connect = interconnect.instance()
  } catch (e) {
    connect = null
  }
  if (!connect) return null

  inited = true
  if (boundConnect === connect) return connect
  boundConnect = connect

  // 官方形态：赋值 onmessage
  try {
    connect.onmessage = (data) => {
      dispatch(data)
    }
  } catch (e) {}

  // 社区形态：subscribe
  try {
    if (typeof connect.subscribe === 'function') {
      connect.subscribe((evt) => {
        dispatch(evt)
      })
      subscribed = true
    }
  } catch (e) {}

  // 连接打开/关闭/错误回调；部分固件只提供这些，不提供 getReadyState
  try {
    connect.onopen = () => {
      setLinkState(1)
    }
  } catch (e) {}
  try {
    connect.onclose = () => {
      setLinkState(2)
    }
  } catch (e) {}
  try {
    connect.onerror = () => {
      setLinkState(2)
    }
  } catch (e) {}

  return connect
}

/**
 * 订阅消息。返回取消订阅的函数。
 */
function onMessage(cb) {
  if (typeof cb !== 'function') return () => {}
  if (listeners.indexOf(cb) < 0) {
    listeners.push(cb)
  }
  return () => off(cb)
}

/**
 * 取消订阅。
 */
function off(cb) {
  const i = listeners.indexOf(cb)
  if (i >= 0) listeners.splice(i, 1)
}

/**
 * 取出最近一条消息（没有则返回 null）。
 */
function getLastMessage() {
  return lastMessage
}

/**
 * 清空消息缓存（页面隐藏时调用，避免旧 pong 被下次进入误用）。
 */
function clearLastMessage() {
  lastMessage = null
}

/**
 * 订阅连接状态。返回取消订阅的函数。
 */
function onStatus(cb) {
  if (typeof cb !== 'function') return () => {}
  if (statusListeners.indexOf(cb) < 0) {
    statusListeners.push(cb)
  }
  if (linkState !== 0) {
    try {
      cb(linkState)
    } catch (e) {}
  }
  return () => {
    const i = statusListeners.indexOf(cb)
    if (i >= 0) statusListeners.splice(i, 1)
  }
}

/**
 * 当前连接状态：0 未知 / 1 打开 / 2 关闭。
 */
function getLinkState() {
  return linkState
}

/**
 * 发送消息。data 可以是字符串或对象（对象会被 JSON 序列化）。
 */
function send(data, success, fail) {
  if (!connect) {
    if (fail) fail({ code: 1000, message: 'interconnect not initialized' })
    return false
  }
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  try {
    connect.send({
      data: payload,
      success: success || function () {},
      fail: (err, code) => {
        const num = Number(code)
        if (num === 1006) {
          // 连接已断开：下次 init 重新取实例
          connect = null
          setLinkState(2)
        }
        if (fail) fail(err, code)
      }
    })
    return true
  } catch (e) {
    // 实例可能已失效，下次 probe 时重新 init
    connect = null
    if (fail) fail({ code: 1000, message: String(e && e.message ? e.message : e) })
    return false
  }
}

/**
 * 把 success 回调收到的 status 统一成数字。
 */
function parseStatus(data) {
  const raw =
    data && typeof data === 'object' && typeof data.status !== 'undefined'
      ? data.status
      : data
  const value = Number(raw)
  return isNaN(value) ? 0 : value
}

/**
 * 调用 connect 实例或 interconnect 模块上的同名方法。
 * 不同固件把 getReadyState / diagnosis 挂在不同层级，这里都兼容。
 */
function callApi(name, options) {
  if (connect && typeof connect[name] === 'function') {
    connect[name](options)
    return true
  }
  if (typeof interconnect[name] === 'function') {
    interconnect[name](options)
    return true
  }
  return false
}

/**
 * 查询连接状态：1 已连接 / 2 已断开 / 0 未知。
 */
function readyState(cb) {
  if (!connect) {
    if (cb) cb(0)
    return
  }
  try {
    const handled = callApi('getReadyState', {
      success: (data) => {
        const status = parseStatus(data)
        if (status === 1) setLinkState(1)
        else if (status === 2) setLinkState(2)
        if (cb) cb(status)
      },
      fail: (data, code) => {
        const num = Number(code)
        if (num === 1006) setLinkState(2)
        if (cb) cb(num === 1006 ? 2 : 0)
      }
    })
    if (!handled && cb) cb(0)
  } catch (e) {
    if (cb) cb(0)
  }
}

/**
 * 诊断对端：0 OK / 204 超时 / 1001 对端未安装 / 1000 其他。
 */
function diagnosis(timeout, cb) {
  if (!connect) {
    if (cb) cb(1000, 'not initialized')
    return
  }
  try {
    const handled = callApi('diagnosis', {
      timeout: timeout || 3000,
      success: (data) => {
        const status = parseStatus(data)
        if (status === 0) setLinkState(1)
        else if (status === 204 || status === 1001) setLinkState(2)
        if (cb) cb(status, '')
      },
      fail: (err) => {
        const code =
          err && typeof err.code !== 'undefined' ? Number(err.code) : 1000
        if (cb) cb(isNaN(code) ? 1000 : code, (err && err.message) || '')
      }
    })
    if (!handled && cb) cb(1000, 'not supported')
  } catch (e) {
    if (cb) cb(1000, String(e && e.message ? e.message : e))
  }
}

/**
 * 是否已初始化。
 */
function isReady() {
  return !!connect
}

export default {
  init,
  onMessage,
  off,
  send,
  readyState,
  diagnosis,
  onStatus,
  getLinkState,
  getLastMessage,
  clearLastMessage,
  isReady
}
