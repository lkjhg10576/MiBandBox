/**
 * 日期选择回传的临时状态：inputdate 确认后写入，edit 页 onShow 读取。
 *
 * 注意：本工具链把每个页面打成独立 bundle、各自带一份模块缓存，
 * 模块级变量并不跨页共享；因此值挂到全局对象上（globalThis/global
 * 在各页面 bundle 间是同一个对象），对外仍以 pickState.date 读写。
 * 不走 KV，避免 kv.init() 异步覆盖造成丢值。
 */
const g =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof global !== 'undefined'
      ? global
      : {}

const KEY = '__bandboxPickDate'

export default {
  get date() {
    return g[KEY] || ''
  },
  set date(v) {
    g[KEY] = v || ''
  }
}
