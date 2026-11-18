/**
 * 首页「目标日」卡片的不常驻模式开关。
 *
 *   false（默认）= 常驻：没有目标日时也在首页顶部显示「记录一个目标日」占位卡（现状）
 *   true         = 不常驻：只有设定了目标日才显示卡片；没有时卡片不渲染，
 *                  让出来的空间全部给下方工具列表
 *
 * 存 KV 键 'todayAuto'：首页 onShow 读、设置页开关写，两边都走本模块，
 * 不各写一份 key 字面量。
 */
import g from './g'

const KEY = 'todayAuto'

/**
 * 读开关（KV 首次读盘是异步的，值统一在 init 之后取）
 * @param {Function} cb 回调参数为布尔值
 */
export function read(cb) {
  if (typeof cb !== 'function') return
  g.kv.init(() => {
    cb(g.kv.get(KEY, false) === true)
  })
}

/**
 * 取反并立即落盘（设置页开关用）
 * @param {Function} cb 回调参数为写入后的布尔值
 */
export function toggle(cb) {
  g.kv.init(() => {
    const next = g.kv.get(KEY, false) !== true
    g.kv.set(KEY, next)
    g.kv.flush()
    if (typeof cb === 'function') cb(next)
  })
}

export default { read, toggle, KEY }