/**
 * OTP 接收层：bandbox-otp 协议的唯一入口。
 *
 * 与互联层的关系（不改 interconnect.js / lyricsTransfer.js）：
 *   ① dispatch() 会把同一文本分发给所有 listener，歌词订阅与本模块同时收到，
 *      双方都靠 app 字段过滤（歌词 parse 对 OTP 消息返回 bad-app 静默忽略）。
 *   ② interconnect 有 80ms 同文本去重 → OTP 每条消息 id 必须唯一（协议已保证）。
 *   ③ 消息接收改为「认领 pushInbox 缓冲」：启动路径只留 pushInbox 这一份
 *      薄缓冲层（见 pushInbox.js 的背景说明），本模块的协议栈不进 app.jsc，
 *      冷启动少求值约 68KB 协议代码。
 *      init() 时把缓冲原样回放给 handle()，落库与回执照旧 —— 数据不丢，
 *      代价是「插件显示手环在线」的时点推迟到用户首次进入 OTP 相关页。
 *   ④ 认领后消息直达本模块，不重复订阅 interconnect。
 *
 * 回执不当强依赖：手表→手机方向在部分固件不可用，reply() 失败静默。
 */
import interconnectUtil from './interconnect'
import otpProtocol from './otpProtocol'
import otpStore from './otpStore'
import otp from './otp'
import pushInbox from './pushInbox'

/**
 * 状态挂在 global 上：工具链把每个页面打成独立 bundle、模块级变量不跨
 * bundle 共享。分片会话（session）必须全 app 只有一份 —— 同一笔分片事务
 * 的各片可能分落在不同页面（list / sync）被认领，会话一分裂就重组失败。
 * 挂法照 global.js / perf.js 的先例。
 */
const g =
  typeof global !== 'undefined'
    ? global
    : typeof globalThis !== 'undefined'
      ? globalThis
      : {}

const KEY = '__bbOtpBridge'

if (!g[KEY]) {
  g[KEY] = {
    // 分片会话（跨页面存活）
    session: otpProtocol.createSession(),
    inited: false,
    lastAnnounceAt: 0,
    lastHelloTime: 0,
    syncListeners: []
  }
}

const st = g[KEY]

// 本 bundle 的连接状态订阅句柄（各 bundle 的 interconnect 副本独立，句柄也独立）
let statusUnsub = null

function notifySync(info) {
  st.syncListeners.slice().forEach((fn) => {
    try {
      fn(info)
    } catch (e) {}
  })
}

function onSync(cb) {
  if (typeof cb === 'function' && st.syncListeners.indexOf(cb) < 0) {
    st.syncListeners.push(cb)
  }
  return () => {
    const idx = st.syncListeners.indexOf(cb)
    if (idx >= 0) st.syncListeners.splice(idx, 1)
  }
}

/**
 * 发送一条编码消息给手机（失败静默）。
 */
function send(json) {
  if (!interconnectUtil.isReady()) interconnectUtil.init()
  if (!interconnectUtil.isReady()) return
  interconnectUtil.send(json, () => {}, () => {})
}

/**
 * 回执（带 id 关联；无 id 时现造一个唯一 id）。
 */
function reply(json) {
  send(json)
}

/**
 * 手表→手机 就绪广播（status 变化 / 10s 节流）。
 *
 * lastAnnounceAt 统一用**秒**（otp.epochSeconds()）：早前 onStatus 里用
 * Date.now()（毫秒）赋值、这里又按秒比较，单位不一致会让自己的节流把
 * 广播挡掉（now - lastAnnounceAt 为负 → 直接 return）。
 */
function announceReady() {
  const now = otp.epochSeconds()
  if (now - st.lastAnnounceAt < 10) return
  st.lastAnnounceAt = now
  reply(
    otpProtocol.readyMessage(otpStore.list().length, otpStore.getTimeOffsetSec(), now)
  )
}

/**
 * 全量账户下发（list_accounts 应答）：planSync 自动分片。
 */
function sendAccounts(msgId) {
  const plan = otpProtocol.planSync('accounts', { accounts: otpStore.list() }, msgId)
  if (plan.mode === 'invalid') {
    reply(otpProtocol.errMessage(plan.id, plan.reason))
    return
  }
  if (plan.mode === 'single') {
    reply(plan.json)
    return
  }
  for (let i = 0; i < plan.jsons.length; i++) {
    reply(plan.jsons[i])
  }
}

/**
 * 应用一次全量覆盖（upsert_accounts）：逐条校验后一次性落盘。
 * 返回 { okCount, firstError }。
 */
function applyUpsert(accounts) {
  const arr = Array.isArray(accounts) ? accounts : []
  const check = otpStore.validateAll(arr)
  if (check.firstError) return check
  otpStore.applyDelta(arr, [])
  return check
}

/**
 * 处理一条已 parse 通过的 OTP 消息。
 */
function handleMessage(msg) {
  const type = msg.type
  const id = typeof msg.id === 'string' ? msg.id : otpProtocol.makeId('or')

  if (type === 'hello' || type === 'ping') {
    if (type === 'hello') {
      st.lastHelloTime = Math.floor(Number(msg.time) || 0)
    }
    reply(
      otpProtocol.pongMessage(
        id,
        otpStore.list().length,
        otpStore.getTimeOffsetSec(),
        otp.epochSeconds()
      )
    )
    return
  }

  if (type === 'list_accounts') {
    sendAccounts(id)
    return
  }

  if (type === 'upsert_accounts') {
    const r = applyUpsert(msg.accounts)
    if (r.firstError) {
      reply(otpProtocol.errMessage(id, r.firstError))
      return
    }
    notifySync({ count: r.okCount, type: 'upsert' })
    reply(otpProtocol.ackMessage(id, r.okCount))
    return
  }

  if (type === 'remove_account') {
    const ids = Array.isArray(msg.ids) ? msg.ids : []
    let removed = 0
    for (let i = 0; i < ids.length; i++) {
      if (otpStore.remove(String(ids[i]))) removed++
    }
    reply(otpProtocol.ackMessage(id, removed))
    return
  }

  if (type === 'sync_delta') {
    const upsert = Array.isArray(msg.upsert) ? msg.upsert : []
    const remove = Array.isArray(msg.remove) ? msg.remove : []
    const check = otpStore.validateAll(upsert)
    if (check.firstError) {
      reply(otpProtocol.errMessage(id, check.firstError))
      return
    }
    otpStore.applyDelta(upsert, remove)
    notifySync({ count: upsert.length, removeCount: remove.length, type: 'delta' })
    reply(otpProtocol.ackMessage(id, upsert.length + remove.length))
    return
  }

  if (type === 'set_offset') {
    let offset = Math.floor(Number(msg.offset) || 0)
    if (offset < otpStore.OFFSET_MIN) offset = otpStore.OFFSET_MIN
    if (offset > otpStore.OFFSET_MAX) offset = otpStore.OFFSET_MAX
    otpStore.setTimeOffsetSec(offset)
    reply(otpProtocol.ackMessage(id))
    return
  }

  if (type === 'chunk') {
    const res = otpProtocol.acceptChunk(st.session, msg)
    if (!res.ok) {
      reply(otpProtocol.errMessage(id, res.reason))
      st.session = otpProtocol.createSession()
      return
    }
    if (!res.done) {
      reply(otpProtocol.progressMessage(id, res.received, res.total))
      return
    }
    const kind = res.kind
    const payload = res.payload
    st.session = otpProtocol.createSession()
    if (kind === 'upsert_accounts') {
      const r = applyUpsert(payload && payload.accounts)
      if (r.firstError) {
        reply(otpProtocol.errMessage(id, r.firstError))
        return
      }
      notifySync({ count: r.okCount, type: 'upsert' })
      reply(otpProtocol.ackMessage(id, r.okCount))
      return
    }
    if (kind === 'sync_delta') {
      const upsert = (payload && payload.upsert) || []
      const remove = (payload && payload.remove) || []
      const check = otpStore.validateAll(upsert)
      if (check.firstError) {
        reply(otpProtocol.errMessage(id, check.firstError))
        return
      }
      otpStore.applyDelta(upsert, remove)
      notifySync({ count: upsert.length, removeCount: remove.length, type: 'delta' })
      reply(otpProtocol.ackMessage(id, upsert.length + remove.length))
      return
    }
    reply(otpProtocol.errMessage(id, otpProtocol.ERRORS.BAD_TYPE))
    return
  }

  // 未知类型：忽略（不回 err，避免与未来版本互扰）
}

/**
 * 处理一条原始文本：严格 parse 且 app 必须是 bandbox-otp。
 */
function handle(raw) {
  const parsed = otpProtocol.parse(raw)
  if (!parsed.ok) return
  handleMessage(parsed.msg)
}

/**
 * 初始化：认领 pushInbox 缓冲 + 注册连接状态监听。
 *
 * 调用时机：用户进入 OTP 相关页时（由页面 onShow 触发），不再由
 * app.ux onCreate 调用 —— 协议栈不进启动路径。
 *
 * 认领只做一次（st.inited 全 app 共享，缓冲被第一个进 OTP 页的 bundle
 * 取走）；但连接状态监听**每个 bundle 各注册各的** —— 各 bundle 的
 * interconnect 是独立副本，只有本 bundle 订阅的那份才知道自己的连接状态。
 * 重复进入页面时先退订旧的，避免监听器累积。
 */
function init() {
  if (!st.inited) {
    st.inited = true
    // 认领启动期间缓冲的 OTP 推送，原样回放（落库 + 回执照旧）
    pushInbox.claim('otp', handle)
  }

  if (statusUnsub) {
    try {
      statusUnsub()
    } catch (e) {}
    statusUnsub = null
  }
  statusUnsub = interconnectUtil.onStatus((status) => {
    // 连接打开时广播就绪（10s 节流），手机插件据此显示在线
    if (status === 1) announceReady()
  })

  // 连接在认领前就已建立 → 补一次就绪广播（插件侧据此显示在线）
  if (pushInbox.latestStatus() === 1) {
    announceReady()
  }
}

/** 最近一次 hello 携带的手机时间（Unix 秒；0 = 从未收到）。 */
function getLastHelloTime() {
  return st.lastHelloTime
}

export default { init, handle, announceReady, getLastHelloTime, onSync }
