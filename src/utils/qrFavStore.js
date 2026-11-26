/**
 * 二维码 / 条形码收藏存储胶水层：qrFavs 的唯一读写点（底座是 kv.js）。
 *
 * 收藏 = 原文本（不存图片），可选别名 label（≤24 字）与码制 kind（'qr' | 'barcode'）。
 * 两个来源共用同一份数据：
 *   - 手环本地：show.ux 收藏按钮 add(text, 'local', opts, cb)
 *   - 手机插件：qrBridge 收到 qr_import 后 add(text, 'plugin', cb)
 * 页面与 qrBridge 只经此模块访问；写后立即 flush() 落盘（防杀进程丢收藏）。
 * notify() 用 slice().forEach + try/catch（照 app.ux 的 layoutState 范式）。
 */
import g from './g'
import qrProtocol from './qrProtocol'

const KEY = 'qrFavs'
const MAX_ITEMS = 50
export const MAX_LABEL_LEN = 24
export const MAX_BARCODE_BYTES = 20

const listeners = []

function notify() {
  listeners.slice().forEach((fn) => {
    try {
      fn()
    } catch (e) {}
  })
}

/**
 * 校验文本是否可编码为 Vela <barcode>（Code128：可打印 ASCII 0x20–0x7E，1..20 字节）。
 */
export function canEncodeBarcode(text) {
  if (typeof text !== 'string') return false
  if (text.length < 1 || text.length > MAX_BARCODE_BYTES) return false
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x20 || code > 0x7e) return false
  }
  return true
}

function normalizeLabel(label) {
  if (typeof label !== 'string') return ''
  return label.replace(/[\r\n]/g, ' ').trim().slice(0, MAX_LABEL_LEN)
}

function normalizeKind(kind, text) {
  return kind === 'barcode' && canEncodeBarcode(text) ? 'barcode' : 'qr'
}

/**
 * 初始化（转发 kv.init，读盘完成后回调一次）。
 */
function init(cb) {
  g.kv.init(cb)
}

/**
 * 归一化单条收藏：字段裁剪/降级照 otpStore 的口径 —— 非法条目直接丢弃；向后兼容老收藏数据。
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
  const label = normalizeLabel(raw.label)
  const kind = normalizeKind(raw.kind, text)
  return { id, text, source, createdAt, label, kind }
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
 * 兼容 add(text, source, cb)、add(text, source, opts, cb) 与 add(text, source, cb, opts)。
 */
function add(text, source, optsOrCb, maybeCb) {
  const opts =
    typeof optsOrCb === 'object' && optsOrCb !== null
      ? optsOrCb
      : typeof maybeCb === 'object' && maybeCb !== null
        ? maybeCb
        : {}
  const cb = typeof optsOrCb === 'function' ? optsOrCb : typeof maybeCb === 'function' ? maybeCb : null
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
      createdAt: Date.now(),
      label: normalizeLabel(opts.label),
      kind: normalizeKind(opts.kind, t)
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
 * 更新指定收藏条目的元数据（label / kind）。
 */
function updateMeta(id, patch, cb) {
  g.kv.init(() => {
    const p = patch && typeof patch === 'object' ? patch : {}
    const all = list()
    let targetItem = null
    const next = []
    for (let i = 0; i < all.length; i++) {
      const it = all[i]
      if (it.id === id) {
        if (p.kind === 'barcode' && !canEncodeBarcode(it.text)) {
          if (cb) cb({ ok: false, reason: 'bad-barcode' })
          return
        }
        targetItem = Object.assign({}, it, {
          label: Object.prototype.hasOwnProperty.call(p, 'label') ? normalizeLabel(p.label) : it.label,
          kind: Object.prototype.hasOwnProperty.call(p, 'kind') ? normalizeKind(p.kind, it.text) : it.kind
        })
        next.push(targetItem)
      } else {
        next.push(it)
      }
    }
    if (!targetItem) {
      if (cb) cb({ ok: false, reason: 'not-found' })
      return
    }
    g.kv.set(KEY, next)
    g.kv.flush()
    notify()
    if (cb) cb({ ok: true, item: targetItem })
  })
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

export default {
  init,
  list,
  getById,
  has,
  add,
  updateMeta,
  remove,
  subscribe,
  canEncodeBarcode,
  MAX_LABEL_LEN,
  MAX_BARCODE_BYTES
}
