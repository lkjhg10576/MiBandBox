/**
 * 二维码导入接收层：bandbox-qr 协议的唯一入口。
 *
 * 与互联层的关系（照 otpBridge.js 的既有范式，与歌词/OTP 共存）：
 *   ① dispatch() 会把同一文本分发给所有 listener，歌词/OTP 订阅与本模块同时收到，
 *      三方都靠 app 字段过滤（本协议 parse 对其它协议消息返回 bad-app 静默忽略）。
 *   ② interconnect 有 80ms 同文本去重 → 每条消息 id 必须唯一（协议已保证）。
 *   ③ 消息接收改为「认领 pushInbox 缓冲」：启动路径只留 pushInbox 这一份
 *      薄缓冲层（见 pushInbox.js 的背景说明），本模块的协议栈不进 app.jsc。
 *      init() 时把缓冲原样回放给 handle()，落库与回执照旧 —— 数据不丢。
 *   ④ 认领后消息直达本模块，不重复订阅 interconnect。
 *
 * 回执不当强依赖：手表→手机方向在部分固件不可用，reply() 失败静默。
 */
import interconnectUtil from './interconnect'
import qrProtocol from './qrProtocol'
import qrFavStore from './qrFavStore'
import pushInbox from './pushInbox'

/**
 * 状态挂在 global 上：工具链把每个页面打成独立 bundle、模块级变量不跨
 * bundle 共享 —— 认领标记必须全 app 只有一份，否则每个页面都会重复认领。
 * 挂法照 global.js / perf.js 的先例。
 */
const g =
  typeof global !== 'undefined'
    ? global
    : typeof globalThis !== 'undefined'
      ? globalThis
      : {}

const KEY = '__bbQrBridge'
if (!g[KEY]) g[KEY] = { inited: false }
const st = g[KEY]

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
 * 初始化（幂等）：认领 pushInbox 缓冲。
 *
 * 调用时机：用户进入二维码相关页时（由页面 onInit 触发），不再由
 * app.ux onCreate 调用 —— 协议栈不进启动路径。
 */
function init() {
  if (st.inited) return
  st.inited = true

  // 认领启动期间缓冲的二维码推送，原样回放（落库 + 回执照旧）
  pushInbox.claim('qr', handle)
}

export default { init, handle }
