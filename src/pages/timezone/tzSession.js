/**
 * 时区换算跨页会话态：城市选择页写入，换算页同步读取。
 * 照 src/pages/unitconvert/unitSession.js 挂在 globalThis 上跨 bundle 共享。
 */
const g =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof global !== 'undefined'
      ? global
      : {}

const KEY = '__bandboxTzSession'

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
