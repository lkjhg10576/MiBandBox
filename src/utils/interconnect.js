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
 */
import interconnect from '@system.interconnect'

let connect = null
let inited = false
let subscribed = false

// 订阅者列表（模块级）
const listeners = []

// 最后一条消息缓存：页面刚订阅时能立刻拿到，避免「刚进页面就收到消息」丢失
let lastMessage = null

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
  lastMessage = text
  for (let i = 0; i < listeners.length; i++) {
    try {
      listeners[i](text)
    } catch (e) {}
  }
}

/**
 * 初始化连接对象与消息回调。全局只需调用一次。
 */
function init() {
  if (inited) return connect
  inited = true
  try {
    connect = interconnect.instance()
  } catch (e) {
    connect = null
    return null
  }
  if (!connect) return null

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
      fail: fail || function () {}
    })
    return true
  } catch (e) {
    if (fail) fail({ code: 1000, message: String(e && e.message ? e.message : e) })
    return false
  }
}

/**
 * 查询连接状态：1 已连接 / 2 已断开。
 */
function readyState(cb) {
  if (!connect) {
    if (cb) cb(0)
    return
  }
  try {
    connect.getReadyState({
      success: (data) => {
        const status = data && typeof data.status !== 'undefined' ? data.status : (data || 0)
        if (cb) cb(status)
      },
      fail: () => {
        if (cb) cb(0)
      }
    })
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
    connect.diagnosis({
      timeout: timeout || 3000,
      success: (data) => {
        const status = data && typeof data.status !== 'undefined' ? data.status : (data || 0)
        if (cb) cb(status, '')
      },
      fail: (err) => {
        const code = err && typeof err.code !== 'undefined' ? err.code : 1000
        if (cb) cb(code, (err && err.message) || '')
      }
    })
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
  getLastMessage,
  isReady
}
