/**
 * 魔方计时成绩存档：最近 30 次（供平均值），界面显示最近 5 次。
 *
 * 纯 JS、零 @system.* 依赖：存档长什么样、怎么清洗、怎么算平均、怎么格式化，
 * 都在这里；KV 的读写由页面自己做（同 motionStats.js 的分工）。
 *
 * 存档形状：[{ms, at}]，**新的在前**，最多留 MAX_KEEP 条。
 * 之所以留 30 条而不是只留 5 条：平均要按最近 30 次算。
 */

/** 存档键（g.kv） */
export const KV_KEY = 'cubeStats'

/** 最多保留多少条（平均按最近 30 次算） */
export const MAX_KEEP = 30

/** 界面显示最近几次 */
export const RECENT_N = 5

/** 非法数值一律丢弃：存档可能被老版本或手改文件污染 */
function cleanMs(v) {
  const n = typeof v === 'number' && isFinite(v) ? Math.round(v) : NaN
  return isFinite(n) && n > 0 ? n : null
}

/**
 * 清洗存档：去掉非法项、截断到 MAX_KEEP 条，保持「新在前」。
 *
 * @param {*} raw 原始存档（可能是数组、null、被污染的对象）
 * @returns {Array<{ms:number, at:number}>}
 */
export function load(raw) {
  const arr = Array.isArray(raw) ? raw : []
  const out = []
  for (let i = 0; i < arr.length && out.length < MAX_KEEP; i++) {
    const it = arr[i]
    if (!it || typeof it !== 'object') continue
    const ms = cleanMs(it.ms)
    if (ms === null) continue
    const at = typeof it.at === 'number' && isFinite(it.at) ? Math.round(it.at) : 0
    out.push({ ms: ms, at: at })
  }
  return out
}

/**
 * 记一次成绩：新记录排在最前，超出 MAX_KEEP 的旧记录丢掉。
 *
 * @param {Array} list 现有存档
 * @param {number} ms 本次用时（毫秒）
 * @param {number} [at] 完成时刻（毫秒时间戳）
 * @returns {Array} 新存档
 */
export function push(list, ms, at) {
  const cur = load(list)
  const m = cleanMs(ms)
  if (m === null) return cur
  const ts = typeof at === 'number' && isFinite(at) ? Math.round(at) : 0
  const out = [{ ms: m, at: ts }]
  for (let i = 0; i < cur.length && out.length < MAX_KEEP; i++) out.push(cur[i])
  return out
}

/**
 * 最近 n 次（新在前）。
 *
 * @param {Array} list
 * @param {number} [n] 默认 RECENT_N
 */
export function recent(list, n) {
  const k = (typeof n === 'number' && isFinite(n) && n > 0) ? Math.floor(n) : RECENT_N
  return load(list).slice(0, k)
}

/**
 * 平均用时（毫秒，四舍五入）。不足 30 次按实际条数平均；没有记录返回 null。
 *
 * @param {Array} list
 * @returns {number|null}
 */
export function avgMs(list) {
  const cur = load(list)
  if (!cur.length) return null
  let sum = 0
  for (let i = 0; i < cur.length; i++) sum += cur[i].ms
  return Math.round(sum / cur.length)
}

/** 两位补零 */
function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

/** 三位补零（毫秒） */
function pad3(n) {
  if (n < 10) return '00' + n
  if (n < 100) return '0' + n
  return String(n)
}

/**
 * 毫秒 → 计时文本。
 *
 *   9234   → "09.234"
 *   62345  → "1:02.345"
 *
 * @param {number} ms
 * @returns {string} 非法值返回 "--"
 */
export function formatMs(ms) {
  const total = (typeof ms === 'number' && isFinite(ms) && ms >= 0) ? Math.round(ms) : null
  if (total === null) return '--'
  const m = Math.floor(total / 60000)
  const s = Math.floor((total % 60000) / 1000)
  const rest = total % 1000
  if (m > 0) return m + ':' + pad2(s) + '.' + pad3(rest)
  return pad2(s) + '.' + pad3(rest)
}

/** 清空 */
export function clear() {
  return []
}

export default {
  KV_KEY,
  MAX_KEEP,
  RECENT_N,
  load,
  push,
  recent,
  avgMs,
  formatMs,
  clear
}
