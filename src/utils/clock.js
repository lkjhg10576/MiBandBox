/**
 * 全局单例时钟：把 47 个页面各自的 20s 定时器合并成 1 个。
 *
 * 页面订阅（onShow）时立刻拿到当前时间，之后每分钟变化时回调一次；
 * 无人订阅时定时器自动停止 —— 「页面隐藏后时钟还在跑」从结构上不再可能。
 */
const subs = []
let timer = null
let last = ''

function fmt(d) {
  const p = (n) => (n < 10 ? '0' + n : '' + n)
  return p(d.getHours()) + ':' + p(d.getMinutes())
}

function tick() {
  const s = fmt(new Date())
  if (s === last) return
  last = s
  subs.slice().forEach((fn) => {
    try {
      fn(s)
    } catch (e) {}
  })
}

export default {
  /**
   * 订阅时钟（重复订阅同一函数只生效一次）
   * @param {Function} fn 回调参数为 'HH:mm'
   */
  sub(fn) {
    if (typeof fn !== 'function') return
    if (subs.indexOf(fn) < 0) subs.push(fn)
    if (!timer) {
      last = fmt(new Date())
      timer = setInterval(tick, 20000)
    }
    try {
      fn(last)
    } catch (e) {}
  },
  /**
   * 退订（无人订阅时定时器自动停）
   * @param {Function} fn
   */
  unsub(fn) {
    const i = subs.indexOf(fn)
    if (i >= 0) subs.splice(i, 1)
    if (!subs.length && timer) {
      clearInterval(timer)
      timer = null
    }
  },
  /** 当前订阅数（自测用） */
  count() {
    return subs.length
  }
}
