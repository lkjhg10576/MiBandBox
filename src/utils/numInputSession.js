/**
 * 跨页面同步传递数字键盘输入结果。
 * 基于 globalThis 会话态，零延迟、零异步等待。
 */
const g =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof global !== 'undefined'
      ? global
      : {}

const KEY = '__bandboxNumInputSession'

export default {
  set(field, value) {
    g[KEY] = { field, value: String(value), at: Date.now() }
  },
  take(field) {
    const v = g[KEY]
    if (!v) return null
    if (field && v.field !== field) return null
    g[KEY] = null
    return v
  },
  clear() {
    g[KEY] = null
  }
}
