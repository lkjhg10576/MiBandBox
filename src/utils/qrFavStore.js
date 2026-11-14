/**
 * 二维码收藏存储胶水层：qrFavs 的唯一读写点（底座是 kv.js）。
 *
 * 收藏 = 二维码**原文本**（不存图片）。两个来源共用同一份数据：
 *   - 手环本地：show.ux 收藏按钮 add(text, 'local')
 *   - 手机插件：qrBridge 收到 qr_import 后 add(text, 'plugin')
 * 页面与 qrBridge 只经此模块访问；写后立即 flush() 落盘（防杀进程丢收藏）。
 * notify() 用 slice().forEach + try/catch（照 app.ux 的 layoutState 范式）。
 */
import g from './g'
import qrProtocol from './qrProtocol'

const KEY = 'qrFavs'
const MAX_ITEMS = 50

const listeners = []

function notify() {
  listeners.slice().forEach((fn) => {
    try {
      fn()
    } catch (e) {}
  })
}

/**
 * 初始化（转发 kv.init，读盘完成后回调一次）。
 */
function init(cb) {
  g.kv.init(cb)
}

/**
 * 归一化单条收藏：字段裁剪/降级照 otpStore 的口径 —— 非法条目直接丢弃。
 */
function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const text = typeof raw.text === 'string' ? raw.text : ''
  if (!text) return null
  if (qrProtocol.byteLength(text) > qrProtocol.MAX_TEXT_BYTES) return null
  let id = typeof raw.id === 'string' && raw.id ? raw.id : ''
  if (!id) id = qrProtocol.makeId('qr')
  const source = raw.source === 'plugin' ? 'plugin' : 'local'
  const createdAt = Math.floor(Number(raw.createdAt) || 0)
  return { id, text, source, createdAt }
}

/**
 * 收藏列表（normalized 副本；存储损坏时降级为空列表）。
 */
function list() {
  const raw = g.kv.get(KEY, [])
  if (!Array.isArray(raw)) return []
  const out = []
  for (let i = 0; i < raw.length; i++) {
    const n = normalizeItem(raw[i])
    if (n) out.push(n)
  }
  return out
}

/**
 * 按 id 取单条；不存在返回 null。
 */
function getById(id) {
  const all = list()
  for (let i = 0; i < all.length; i++) {
    if (all[i].id === id) return all[i]
  }
  return null
}

/**
 * 按**原文本**精确判断是否已收藏。
 */
function has(text) {
  const t = String(text == null ? '' : text)
  const all = list()
  for (let i = 0; i < all.length; i++) {
    if (all[i].text === t) return true
  }
  return false
}

/**
 * 新增一条收藏（按 text 精确去重；新条目 unshift 置顶；上限 50）。
 * 内部经 g.kv.init 兜底（防常驻接收早于读盘完成时用空快照覆盖数据），
 * 结果通过 cb 回调：{ ok:true, duplicate, item } 或 { ok:false, reason }。
 */
function add(text, source, cb) {
  const run = () => {
    const t = String(text == null ? '' : text).trim()
    if (!t) {
      if (cb) cb({ ok: false, reason: qrProtocol.ERRORS.EMPTY })
      return
    }
    if (qrProtocol.byteLength(t) > qrProtocol.MAX_TEXT_BYTES) {
      if (cb) cb({ ok: false, reason: qrProtocol.ERRORS.TOO_LARGE })
      return
    }
    const all = list()
    for (let i = 0; i < all.length; i++) {
      if (all[i].text === t) {
        if (cb) cb({ ok: true, duplicate: true, item: all[i] })
        return
      }
    }
    const item = {
      id: qrProtocol.makeId('qr'),
      text: t,
      source: source === 'plugin' ? 'plugin' : 'local',
      createdAt: Date.now()
    }
    const next = [item].concat(all.slice(0, MAX_ITEMS - 1))
    g.kv.set(KEY, next)
    g.kv.flush()
    notify()
    if (cb) cb({ ok: true, duplicate: false, item })
  }
  g.kv.init(run)
}

/**
 * 按 id 删除。结果经 cb 回调是否确有删除。
 */
function remove(id, cb) {
  g.kv.init(() => {
    const all = list()
    let found = false
    const next = all.filter((x) => {
      if (x.id === id) {
        found = true
        return false
      }
      return true
    })
    if (found) {
      g.kv.set(KEY, next)
      g.kv.flush()
      notify()
    }
    if (cb) cb(found)
  })
}

/**
 * 订阅变化。返回退订函数。
 */
function subscribe(fn) {
  if (typeof fn !== 'function') return () => {}
  if (listeners.indexOf(fn) < 0) listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i >= 0) listeners.splice(i, 1)
  }
}

export default { init, list, getById, has, add, remove, subscribe }
