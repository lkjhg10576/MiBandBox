/**
 * 史载今日数据：按月拆分的包内 .txt 资源 + 小知识池。
 *
 * 外置原因（计划 L4-5）：原来 366 天的史实整份内联在 JS 里，
 * 页面首开会把整份数据物化进内存，bundle 也因此很大。
 * 现在按月读取（一次只读当月，约 8 KB），进程内缓存已读月份。
 *
 * 注意：包内资源必须用 .txt（老版本 Vela file API 会拒绝打包的 .json）。
 */
import g from './g'
import { tags, keyOf, normalizeItem, pickFrom, hashOf } from './historyPure'

const DIR = '/common/data/history/'
const TIPS_PATH = DIR + 'tips.txt'

// 已加载的月份缓存：{ '01': { '01-01': [...] } }
const months = {}
let tips = null
let tipsLoading = false

function parseMonth(text) {
  if (!text) return {}
  try {
    const obj = JSON.parse(text)
    return obj && typeof obj === 'object' ? obj : {}
  } catch (e) {
    return {}
  }
}

function loadTips(cb) {
  if (tips) {
    cb(tips)
    return
  }
  if (tipsLoading) {
    // 并发调用：等下一轮再看
    setTimeout(() => loadTips(cb), 30)
    return
  }
  tipsLoading = true
  g.fs.readText(TIPS_PATH, (text) => {
    tipsLoading = false
    try {
      const arr = JSON.parse(text || '[]')
      tips = Array.isArray(arr) ? arr : []
    } catch (e) {
      tips = []
    }
    cb(tips)
  })
}

/**
 * 取某天的史实条目（异步：按月读盘）
 * @param {Number} month 1..12
 * @param {Number} day 1..31
 * @param {Function} cb 回调参数为条目数组
 */
export function getByDate(month, day, cb) {
  const m = Number(month)
  const name = (m < 10 ? '0' + m : '' + m) + '.txt'
  if (months[name]) {
    cb(pickFrom(months[name], m, day))
    return
  }
  g.fs.readText(DIR + name, (text) => {
    months[name] = parseMonth(text)
    cb(pickFrom(months[name], m, day))
  })
}

/**
 * 当天的两条小知识（互不相同）
 * @param {Number} month
 * @param {Number} day
 * @param {Function} cb 回调参数为字符串数组
 */
export function tipOfDay(month, day, cb) {
  loadTips((pool) => {
    const n = pool.length
    if (!n) {
      cb([])
      return
    }
    const h = hashOf(month, day)
    const i1 = h % n
    let i2 = Math.floor(h / n) % n
    if (i2 === i1) i2 = (i2 + 1) % n
    cb([pool[i1], pool[i2]])
  })
}

export { tags, keyOf, normalizeItem, pickFrom, hashOf }
export default { getByDate, tipOfDay, keyOf, tags, normalizeItem, pickFrom, hashOf }
