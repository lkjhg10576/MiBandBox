/**
 * 荧光棒配置的跨页传递：设置页 start() 写入，play 页 onShow 同步读取。
 *
 * 注意：本工具链把每个页面打成独立 bundle、各自带一份模块缓存，
 * 模块级变量并不跨页共享；因此值挂到全局对象上（globalThis/global
 * 在各页面 bundle 间是同一个对象），对外仍以 fluoroState.cfg 读写。
 * 不走 KV 传值是因为 KV 读写均为异步，play 页可能读到落盘前的旧配置
 * （“高亮屏幕”开关因此失灵过）；KV 仅用于“记住上次选择”的持久化。
 */
const g =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof global !== 'undefined'
      ? global
      : {}

const KEY = '__bandboxFluoroCfg'

export default {
  get cfg() { return g[KEY] || null },
  set cfg(v) { g[KEY] = v || null }
}
