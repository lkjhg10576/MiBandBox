/**
 * OTP 常驻接收层：app 生命周期内唯一的 bandbox-otp 协议入口。
 *
 * 四条硬约束（与现有互联层共存，不改 interconnect.js / lyricsTransfer.js）：
 *   ① dispatch() 会把同一文本分发给所有 listener，歌词订阅与本模块同时收到，
 *      双方都靠 app 字段过滤（歌词 parse 对 OTP 消息返回 bad-app 静默忽略）。
 *   ② interconnect 有 80ms 同文本去重 → OTP 每条消息 id 必须唯一（协议已保证）。
 *   ③ 只在 init() 时用 parse 双校验补处理一次 getLastMessage()，
 *      不依赖缓存存在、不调用也不修改 clearLastMessage()（歌词页 onHide 会清它）。
 *   ④ 本模块注册后在整个 app 生命周期内不退订（常驻）。
 *
 * 回执不当强依赖：手表→手机方向在部分固件不可用，reply() 失败静默。
 */
import interconnectUtil from './interconnect'
import otpProtocol from './otpProtocol'
import otpStore from './otpStore'
import otp from './otp'

// 分片会话（模块闭包，跨页面存活）
let session = otpProtocol.createSession()

let inited = false
let lastAnnounceAt = 0
let lastHelloTime = 0
const syncListeners = []

function notifySync(info) {
  syncListeners.slice().forEach((fn) => {
    try {
      fn(info)
    } catch (e) {}
  })
}

function onSync(cb) {
  if (typeof cb === 'function' && syncListeners.indexOf(cb) < 0) {
    syncListeners.push(cb)
  }
  return () => {
    const idx = syncListeners.indexOf(cb)
    if (idx >= 0) syncListeners.splice(idx, 1)
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
 */
function announceReady() {
  const now = otp.epochSeconds()
  if (now - lastAnnounceAt < 10) return
  lastAnnounceAt = now
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
      lastHelloTime = Math.floor(Number(msg.time) || 0)
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
    const res = otpProtocol.acceptChunk(session, msg)
    if (!res.ok) {
      reply(otpProtocol.errMessage(id, res.reason))
      session = otpProtocol.createSession()
      return
    }
    if (!res.done) {
      reply(otpProtocol.progressMessage(id, res.received, res.total))
      return
    }
    const kind = res.kind
    const payload = res.payload
    session = otpProtocol.createSession()
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
 * 初始化（幂等）：注册常驻消息订阅与连接状态监听。
 * 在 app.ux onCreate 的 interconnectUtil.init() 之后调用。
 */
function init() {
  if (inited) return
  inited = true

  interconnectUtil.onMessage((text) => {
    try {
      handle(text)
    } catch (e) {}
  })

  interconnectUtil.onStatus((status) => {
    // 连接打开时广播就绪（10s 节流），手机插件据此显示在线
    if (status === 1 && Date.now() - lastAnnounceAt > 10000) {
      lastAnnounceAt = Date.now()
      announceReady()
    }
  })

  // 兼容「刚 init 就已收到消息」：只补处理一次缓存，
  // 不依赖缓存存在、不动 clearLastMessage()（歌词页 onHide 会清它）
  const cached = interconnectUtil.getLastMessage()
  if (cached) {
    try {
      handle(cached)
    } catch (e) {}
  }
}

/** 最近一次 hello 携带的手机时间（Unix 秒；0 = 从未收到）。 */
function getLastHelloTime() {
  return lastHelloTime
}

export default { init, handle, announceReady, getLastHelloTime, onSync }
