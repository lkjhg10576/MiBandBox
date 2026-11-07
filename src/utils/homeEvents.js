/**
 * 首页「目标日」卡片的数据读取：带 60 秒缓存。
 *
 * 原来每次首页 onShow 都要 readText + JSON.parse + 全表 forEach 算 humanDelta；
 * 现在同一进程内 60 秒内复用上次结果（目标日增删改后调用 invalidate() 立即失效）。
 */
import g from './g'
import time from './time'

const EVENTS_PATH = 'internal://files/bandbox/events.json'
const TTL = 60000

let cache = null

function parse(text) {
  if (!text) return []
  try {
    const list = JSON.parse(text)
    return Array.isArray(list) ? list : []
  } catch (e) {
    return []
  }
}

/** 找出距离今天最近的一条目标日 */
function pickNearest(list) {
  let best = null
  let bestAbs = 1e9
  list.forEach((item) => {
    if (!item || !item.date) return
    const d = time.humanDelta(item.date)
    if (d.status === 'invalid') return
    const abs = Math.abs(d.days)
    if (abs < bestAbs) {
      bestAbs = abs
      best = { item, d }
    }
  })
  return best
}

/**
 * 读取目标日数据
 * @param {Function} cb 回调参数 { at, list, best }
 */
export function load(cb) {
  if (cache && Date.now() - cache.at < TTL) {
    cb(cache)
    return
  }
  g.fs.readText(EVENTS_PATH, (text) => {
    const list = parse(text)
    cache = { at: Date.now(), list: list, best: pickNearest(list) }
    cb(cache)
  })
}

/** 目标日增删改后调用：下次读取重新读盘 */
export function invalidate() {
  cache = null
}

export default { load, invalidate, EVENTS_PATH }
