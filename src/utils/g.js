/**
 * 页面唯一可用的公共模块入口（shim）。
 *
 * 为什么用 shim 而不是直接解构 global：
 * 若某页 bundle 在 g.__bb 赋值前求值，直接解构会得到 undefined 并抛错白屏，
 * 真机没有 console 极难定位。shim 返回 {} 只会缺功能、不会崩页面。
 */
const g =
  typeof global !== 'undefined'
    ? global
    : typeof globalThis !== 'undefined'
      ? globalThis
      : {}

export default g.__bb || {}
