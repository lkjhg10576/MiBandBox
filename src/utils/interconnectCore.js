/**
 * 手机端互传通道纯逻辑工厂（无平台模块依赖，可在 Node 单测）。
 *
 * 状态统一挂在 root.__bbIC 上：工具链把每个页面打成独立 bundle，
 * 通过共享全局态保证同一个 connect 实例只绑定一次 onmessage/subscribe/
 * onopen/onclose/onerror，防止多页面多次 init 导致原生层回调累计持有。
 */

const KEY = '__bbIC'

export function createInterconnect(native, root) {
  const r =
    root ||
    (typeof globalThis !== 'undefined'
      ? globalThis
      : typeof global !== 'undefined'
        ? global
        : {})

  if (!r[KEY]) {
    r[KEY] = {
      connect: null,
      boundConnect: null,
      inited: false,
      subscribed: false,
      listeners: [],
      statusListeners: [],
      lastMessage: null,
      // 0 未知 / 1 连接打开 / 2 连接关闭
      linkState: 0,
      lastDispatchText: '',
      lastDispatchAt: 0
    }
  }

  const st = r[KEY]

  /** 取出消息文本：兼容字符串与对象形态。 */
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

  /** 通知连接状态变化。 */
  function notifyStatus() {
    const list = st.statusListeners.slice()
    for (let i = 0; i < list.length; i++) {
      try {
        list[i](st.linkState)
      } catch (e) {}
    }
  }

  /** 更新连接状态（去重后通知）。 */
  function setLinkState(next) {
    if (st.linkState === next) return
    st.linkState = next
    notifyStatus()
  }

  /** 把收到的消息分发给所有订阅者。 */
  function dispatch(raw) {
    const text = extractText(raw)
    if (!text) return
    const now = Date.now()
    if (text === st.lastDispatchText && now - st.lastDispatchAt < 80) return
    st.lastDispatchText = text
    st.lastDispatchAt = now
    st.lastMessage = text
    // 先分发给页面（页面会立即标记已连接），再更新连接状态，避免触发多余探测
    const list = st.listeners.slice()
    for (let i = 0; i < list.length; i++) {
      try {
        list[i](text)
      } catch (e) {}
    }
    // 收到任何消息都说明对端在线
    if (st.linkState !== 1) setLinkState(1)
  }

  /** 初始化连接对象与消息回调。每个 connect 实例只绑定一次。 */
  function init() {
    // instance() 在 App 启动早期可能返回 null；不能在失败时阻断后续重连
    if (st.connect) return st.connect
    try {
      st.connect = native && typeof native.instance === 'function' ? native.instance() : null
    } catch (e) {
      st.connect = null
    }
    if (!st.connect) return null

    st.inited = true
    if (st.boundConnect === st.connect) return st.connect
    st.boundConnect = st.connect

    // 官方形态：赋值 onmessage
    try {
      st.connect.onmessage = (data) => {
        dispatch(data)
      }
    } catch (e) {}

    // 社区形态：subscribe
    try {
      if (typeof st.connect.subscribe === 'function') {
        st.connect.subscribe((evt) => {
          dispatch(evt)
        })
        st.subscribed = true
      }
    } catch (e) {}

    // 连接打开/关闭/错误回调；部分固件只提供这些，不提供 getReadyState
    try {
      st.connect.onopen = () => {
        setLinkState(1)
      }
    } catch (e) {}
    try {
      st.connect.onclose = () => {
        setLinkState(2)
      }
    } catch (e) {}
    try {
      st.connect.onerror = () => {
        setLinkState(2)
      }
    } catch (e) {}

    return st.connect
  }

  /** 取消订阅。 */
  function off(cb) {
    const i = st.listeners.indexOf(cb)
    if (i >= 0) st.listeners.splice(i, 1)
  }

  /** 订阅消息。返回取消订阅的函数。 */
  function onMessage(cb) {
    if (typeof cb !== 'function') return () => {}
    if (st.listeners.indexOf(cb) < 0) {
      st.listeners.push(cb)
    }
    return () => off(cb)
  }

  /** 取出最近一条消息（没有则返回 null）。 */
  function getLastMessage() {
    return st.lastMessage
  }

  /** 清空消息缓存（页面隐藏时调用，避免旧 pong 被下次进入误用）。 */
  function clearLastMessage() {
    st.lastMessage = null
  }

  /** 订阅连接状态。返回取消订阅的函数。 */
  function onStatus(cb) {
    if (typeof cb !== 'function') return () => {}
    if (st.statusListeners.indexOf(cb) < 0) {
      st.statusListeners.push(cb)
    }
    if (st.linkState !== 0) {
      try {
        cb(st.linkState)
      } catch (e) {}
    }
    return () => {
      const i = st.statusListeners.indexOf(cb)
      if (i >= 0) st.statusListeners.splice(i, 1)
    }
  }

  /** 当前连接状态：0 未知 / 1 打开 / 2 关闭。 */
  function getLinkState() {
    return st.linkState
  }

  /** 发送消息。data 可以是字符串或对象（对象会被 JSON 序列化）。 */
  function send(data, success, fail) {
    // 断连（1006）或实例失效后 connect 会被置 null：先尝试重建实例，
    // 否则 reply() 这类不显式 init 的调用方会从此发不出消息
    if (!st.connect) init()
    if (!st.connect) {
      if (fail) fail({ code: 1000, message: 'interconnect not initialized' })
      return false
    }
    const payload = typeof data === 'string' ? data : JSON.stringify(data)
    try {
      st.connect.send({
        data: payload,
        success: success || function () {},
        fail: (err, code) => {
          const num = Number(code)
          if (num === 1006) {
            st.connect = null
            setLinkState(2)
          }
          if (fail) fail(err, code)
        }
      })
      return true
    } catch (e) {
      st.connect = null
      if (fail) fail({ code: 1000, message: String(e && e.message ? e.message : e) })
      return false
    }
  }

  function parseStatus(data) {
    const raw =
      data && typeof data === 'object' && typeof data.status !== 'undefined'
        ? data.status
        : data
    const value = Number(raw)
    return isNaN(value) ? 0 : value
  }

  function callApi(name, options) {
    if (st.connect && typeof st.connect[name] === 'function') {
      st.connect[name](options)
      return true
    }
    if (native && typeof native[name] === 'function') {
      native[name](options)
      return true
    }
    return false
  }

  /** 查询连接状态：1 已连接 / 2 已断开 / 0 未知。 */
  function readyState(cb) {
    if (!st.connect) {
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

  /** 诊断对端：0 OK / 204 超时 / 1001 对端未安装 / 1000 其他。 */
  function diagnosis(timeout, cb) {
    if (!st.connect) {
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

  /** 是否已初始化。 */
  function isReady() {
    return !!st.connect
  }

  return {
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
}

export default { createInterconnect }
