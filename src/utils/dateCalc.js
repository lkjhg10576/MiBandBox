/**
 * 日期计算的纯逻辑内核（纯 JS，零 @system.* 依赖，可在 Node 下直接单测）。
 *
 * 两个能力：
 *   1. intervalDays —— 两个日期之间相差多少天（带符号）
 *   2. ageAt        —— 生日算年龄：周岁 + 剩余天数 + 四位小数近似年龄
 *
 * 口径：
 *   - 周年当天（剩余天数为 0）强制输出 N.0000，避免「26岁0天 / ≈25.9992岁」的误会；
 *     其余日子按格里高利平均年长 365.2425 天折算。
 *   - 2/29 生日在平年的周年日夹紧到 2/28（与日期滚轮的夹紧逻辑一致）。
 *   - 所有「天」都是本地日历日之差，按 UTC 日界计算，无夏令时误差。
 */
import time from './time.js'

/** 格里高利平均年长（天） */
const YEAR_LEN = 365.2425

/**
 * 间隔天数 = 结束 - 开始（带符号的整天差）。
 * 非法日期返回 null。
 */
function intervalDays(startStr, endStr) {
  const a = time.parseDate(startStr)
  const b = time.parseDate(endStr)
  if (!a || !b) return null
  return time.daysBetween(a, b)
}

/**
 * 年龄。birth / today 均为 'YYYY-MM-DD'。
 * 非法日期、或生日晚于今天时返回 null。
 * 返回 { years, days, approx, totalDays }：
 *   years    周岁（整年）
 *   days     过了上一个周年后的剩余天数
 *   approx   四位小数的近似年龄（字符串）
 *   totalDays 生日到今天共经过的天数
 */
function ageAt(birthStr, todayStr) {
  const b = time.parseDate(birthStr)
  const t = time.parseDate(todayStr)
  if (!b || !t || time.daysBetween(b, t) < 0) return null
  const by = b.getFullYear()
  const bm = b.getMonth() + 1
  const bd = b.getDate()
  const ty = t.getFullYear()
  // 2/29 生日在平年夹紧到 2/28
  const clampDay = (y) => Math.min(bd, time.daysInMonth(y, bm))
  let anniv = new Date(ty, bm - 1, clampDay(ty))
  if (time.daysBetween(anniv, t) < 0) {
    anniv = new Date(ty - 1, bm - 1, clampDay(ty - 1))
  }
  const years = anniv.getFullYear() - by
  const days = time.daysBetween(anniv, t)
  const totalDays = time.daysBetween(b, t)
  // 周年当天强制 N.0000（用户口径），其余按平均年长折算
  const approx = days === 0 ? years.toFixed(4) : (totalDays / YEAR_LEN).toFixed(4)
  return { years, days, approx, totalDays }
}

export default { YEAR_LEN, intervalDays, ageAt }
