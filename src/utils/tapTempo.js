/**
 * 节拍测定内核：滚动最近 8 个点击间隔求平均 BPM。纯 JS，零 @system.* 依赖。
 *
 * 口径（勿改）：长间隔照常计入，不停顿清空、不去抖、不滤异常值，每次点击都算一拍。
 * 时长取「第一拍到最后一拍」的跨度，因此页面不需要周期性刷新定时器。
 */

export const WINDOW = 8

export function createState() {
  return { count: 0, firstAt: 0, lastAt: 0, gaps: [] }
}

/** 记一拍，返回新状态；入参不被修改。第一拍只立起点，不产生间隔 */
export function tap(st, now) {
  if (st.count === 0) return { count: 1, firstAt: now, lastAt: now, gaps: [] }
  const gaps = st.gaps.concat(Math.max(0, now - st.lastAt))
  if (gaps.length > WINDOW) gaps.splice(0, gaps.length - WINDOW)
  return { count: st.count + 1, firstAt: st.firstAt, lastAt: now, gaps }
}

export function meanGap(st) {
  if (!st.gaps.length) return null
  let sum = 0
  for (let i = 0; i < st.gaps.length; i++) sum += st.gaps[i]
  return sum / st.gaps.length
}

/** 无间隔、或窗口内全为 0 间隔时返回 null，绝不产出 Infinity */
export function bpmOf(st) {
  const m = meanGap(st)
  if (m === null || m <= 0) return null
  return Math.round(60000 / m)
}

export function spanMs(st) {
  return st.count < 2 ? 0 : Math.max(0, st.lastAt - st.firstAt)
}

/** 页面每拍只调这一个。'--' 留给「还没测到」，'0' 是真实测得的极慢值，两者语义分开 */
export function read(st) {
  const bpm = bpmOf(st)
  return {
    count: st.count,
    bpm: bpm,
    big: bpm === null ? '--' : String(bpm),
    meta: st.count + ' 次 · ' + (spanMs(st) / 1000).toFixed(1) + ' 秒'
  }
}

export default { WINDOW, createState, tap, meanGap, bpmOf, spanMs, read }