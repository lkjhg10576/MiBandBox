/**
 * 二维码收藏详情页的跨页传值：收藏列表点击「详情」时写入 { id, text }，
 * favdetail 页 onInit 同步读取。
 *
 * 注意：本工具链把每个页面打成独立 bundle、各自带一份模块缓存，
 * 模块级变量并不跨页共享；因此值挂到全局对象上（globalThis/global
 * 在各页面 bundle 间是同一个对象）。路由参数在当前 Vela 上绑定不稳，
 * 长文本（收藏原文可达 512 字节）不适合走路由，沿用 daysmatter/pickState
 * 与 sentence/favState 的 globalThis 方案。
 */
const g =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof global !== 'undefined'
      ? global
      : {}

const KEY = '__bandboxQrFavItem'

export default {
  get item() { return g[KEY] || null },
  set item(v) { g[KEY] = v || null }
}
