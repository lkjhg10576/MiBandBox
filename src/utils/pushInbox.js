/**
 * 推送收件箱：冷启动减负的缓冲层。
 *
 * 背景：app.ux onCreate 原本无条件 init otpBridge / qrBridge，等于把整条
 * OTP/QR 协议栈（otpProtocol + otp + otpAccounts + otpStore + qrProtocol +
 * qrFavStore + 两个 bridge，合计约 68KB 源码）拉进 app.jsc 的启动求值路径。
 * 实测 band10 模拟器冷启动：bundle 开始求值 → onCreate 约 38ms，绝大部分
 * 花在协议栈求值上（手环 CPU 远慢于模拟器，真机占比只会更高）。
 *
 * 做法：启动只留这一份薄缓冲层。插件推来的消息按 app 字段分流后存起来；
 * 用户真正进入 OTP / 二维码页时，对应的桥接层来 claim，把缓冲原样回放给
 * 它 —— 落库、回执都照旧，**数据不丢**。
 *
 * 约束：
 *   ① interconnect 的 80ms 同文本去重照旧生效（本层在分发链路上游，不改它）。
 *   ② 歌词协议（bandbox-lyrics）不进缓冲 —— 歌词页自己订阅 interconnect，
 *      它的就绪广播也由歌词页自带，与本层无关。
 *   ③ 分片事务（type=chunk）单独一桶并保序保留，桶满才丢最旧的；普通
 *      消息桶先被回收，避免打断正在传的分片。
 *   ④ 某个桶被 claim 后，后续消息直通该桶的 handler，不再缓冲。
 *
 * 状态必须挂在 global 上：工具链把每个页面打成独立 bundle、模块级变量不
 * 跨 bundle 共享 —— app.jsc 里的缓冲与页面 bundle 里的 claim 必须看到
 * 同一份状态，否则缓冲的消息没人认领。挂法照 global.js / perf.js 的先例。
 */
import interconnectUtil from './interconnect'

const PLAIN_CAP = 32
const CHUNK_CAP = 96

const g =
  typeof global !== 'undefined'
    ? global
    : typeof globalThis !== 'undefined'
      ? globalThis
      : {}

const KEY = '__bbPushInbox'

function makeBucket() {
  return { plain: [], chunk: [], handler: null }
}

if (!g[KEY]) {
  g[KEY] = {
    buckets: { otp: makeBucket(), qr: makeBucket() },
    linkStatus: 0,
    inited: false
  }
}

const st = g[KEY]

/**
 * 轻量分类：只看顶层 app / type 两个字段。
 * 解析失败或不是本项目的协议 → 不缓冲（歌词协议等由各自页面处理）。
 */
function classify(text) {
  if (typeof text !== 'string') return null
  if (text.indexOf('"bandbox-otp"') < 0 && text.indexOf('"bandbox-qr"') < 0) {
    return null
  }
  let obj = null
  try {
    obj = JSON.parse(text)
  } catch (e) {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  if (obj.app === 'bandbox-otp') return { key: 'otp', chunk: obj.type === 'chunk' }
  if (obj.app === 'bandbox-qr') return { key: 'qr', chunk: false }
  return null
}

/** 收到一条原始消息：未认领则缓冲，已认领则直通。 */
function onRaw(text) {
  const c = classify(text)
  if (!c) return
  const b = st.buckets[c.key]
  if (b.handler) {
    try {
      b.handler(text)
    } catch (e) {}
    return
  }
  if (c.chunk) {
    b.chunk.push(text)
    while (b.chunk.length > CHUNK_CAP) b.chunk.shift()
  } else {
    b.plain.push(text)
    while (b.plain.length > PLAIN_CAP) b.plain.shift()
  }
}

/** 订阅 interconnect（app.ux onCreate 里调用，紧跟 interconnectUtil.init 之后）。 */
function init() {
  if (st.inited) return
  st.inited = true
  interconnectUtil.onMessage(onRaw)
  interconnectUtil.onStatus((s) => {
    st.linkStatus = s
  })
  // 订阅之前就收到的最后一条：补处理一次，避免漏
  const cached = interconnectUtil.getLastMessage()
  if (cached) onRaw(cached)
}

/**
 * 认领某个协议的缓冲消息并回放。
 * @param {'otp'|'qr'} key 协议桶
 * @param {function(string):void} handler 桥接层的 handle
 * @returns {number} 回放条数
 */
function claim(key, handler) {
  const b = st.buckets[key]
  if (!b || typeof handler !== 'function') return 0
  b.handler = handler
  const list = b.plain.concat(b.chunk)
  b.plain.length = 0
  b.chunk.length = 0
  for (let i = 0; i < list.length; i++) {
    try {
      b.handler(list[i])
    } catch (e) {}
  }
  return list.length
}

/** 最近一次连接状态（1 = 已连通），供桥接层补发就绪广播。 */
function latestStatus() {
  return st.linkStatus
}

/** 某个桶里还压着多少条未处理的推送。 */
function pendingCount(key) {
  const b = st.buckets[key]
  return b ? b.plain.length + b.chunk.length : 0
}

export default { init, claim, latestStatus, pendingCount }
