/**
 * 单位换算跨页会话态：单位选择页写入，换算页同步读取。
 *
 * 本工具链每个页面打成独立 bundle，模块级变量不跨页共享；
 * 因此值挂到全局对象上（globalThis 在各页面 bundle 间是同一个对象），
 * 照 src/utils/marqueeState.js / src/pages/otp/otpSession.js 的形态。
 * 跨页传值不走 KV（异步读写会拿到旧值）；KV 只用于「记住上次选择」。
 */

const g =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof global !== 'undefined'
      ? global
      : {}

const KEY = '__bandboxUnitSession'

export default {
  get pending() {
    return g[KEY] || null
  },
  set pending(v) {
    g[KEY] = v || null
  },
  take() {
    const v = g[KEY] || null
    g[KEY] = null
    return v
  }
}
