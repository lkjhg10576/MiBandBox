/**
 * 二维码导入常驻接收层：app 生命周期内唯一的 bandbox-qr 协议入口。
 *
 * 四条硬约束（照 otpBridge.js 的既有范式，与歌词/OTP 共存）：
 *   ① dispatch() 会把同一文本分发给所有 listener，歌词/OTP 订阅与本模块同时收到，
 *      三方都靠 app 字段过滤（本协议 parse 对其它协议消息返回 bad-app 静默忽略）。
 *   ② interconnect 有 80ms 同文本去重 → 每条消息 id 必须唯一（协议已保证）。
 *   ③ 只在 init() 时用 parse 双校验补处理一次 getLastMessage()，
 *      不依赖缓存存在、不调用也不修改 clearLastMessage()（歌词页 onHide 会清它）。
 *   ④ 本模块注册后在整个 app 生命周期内不退订（常驻）。
 *
 * 回执不当强依赖：手表→手机方向在部分固件不可用，reply() 失败静默。
 */
import interconnectUtil from './interconnect'
import qrProtocol from './qrProtocol'
import qrFavStore from './qrFavStore'

let inited = false

/**
 * 发送一条编码消息给手机（失败静默）。
 */
function send(json) {
  if (!interconnectUtil.isReady()) interconnectUtil.init()
  if (!interconnectUtil.isReady()) return
  interconnectUtil.send(json, () => {}, () => {})
}

/**
 * 处理一条已 parse 通过的 bandbox-qr 消息。
 * qrFavStore.add 内部经 g.kv.init 兜底，读盘完成后才会改数据并回执；
 * 插件侧 20s 超时兜底未收到确认的提示。
 */
function handleMessage(msg) {
  if (msg.type !== 'qr_import') return
  const id = typeof msg.id === 'string' && msg.id ? msg.id : qrProtocol.makeId('qi')
  const text = typeof msg.text === 'string' ? msg.text : ''
  qrFavStore.add(text, 'plugin', (r) => {
    if (r && r.ok) {
      send(qrProtocol.qrAckMessage(id, r.duplicate))
    } else {
      send(qrProtocol.qrErrMessage(id, (r && r.reason) || qrProtocol.ERRORS.WRITE_FAILED))
    }
  })
}

/**
 * 处理一条原始文本：严格 parse 且 app 必须是 bandbox-qr。
 */
function handle(raw) {
  const parsed = qrProtocol.parse(raw)
  if (!parsed.ok) return
  handleMessage(parsed.msg)
}

/**
 * 初始化（幂等）：注册常驻消息订阅与缓存补处理。
 * 在 app.ux onCreate 的 interconnectUtil.init() / otpBridge.init() 之后调用。
 */
function init() {
  if (inited) return
  inited = true

  interconnectUtil.onMessage((text) => {
    try {
      handle(text)
    } catch (e) {}
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

export default { init, handle }
