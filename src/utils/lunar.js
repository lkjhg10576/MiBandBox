/**
 * 农历换算（1900-2100），纯 JS，无 @system.* 依赖。
 *
 * 数据表来自 solarlunar（ISC License, Copyright (c) 2015 yize），
 * 该表在公有历法数据基础上整理，本项目只使用数据与自行实现换算逻辑。
 * 表结构：低 4 位 = 闰月月份，bit16 = 闰月是否 30 天，
 * bit15..bit4 = 正月到十二月是否 30 天。
 */

const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a4d0, 0x0d150, 0x0f252,
  0x0d520
]

const BASE_UTC = Date.UTC(1900, 0, 31)
const MIN_YEAR = 1900
const MAX_YEAR = 2100

const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']
const MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊']
const DAY_NAMES = ['十', '一', '二', '三', '四', '五', '六', '七', '八', '九']

function infoOf(year) {
  return LUNAR_INFO[year - MIN_YEAR]
}

function leapMonth(year) {
  return infoOf(year) & 0xf
}

function leapDays(year) {
  if (!leapMonth(year)) return 0
  return infoOf(year) & 0x10000 ? 30 : 29
}

function monthDays(year, month) {
  return infoOf(year) & (0x10000 >> month) ? 30 : 29
}

function yearDays(year) {
  let sum = 348
  for (let bit = 0x8000; bit > 0x8; bit >>= 1) {
    if (infoOf(year) & bit) sum++
  }
  return sum + leapDays(year)
}

function dayName(day) {
  if (day === 10) return '初十'
  if (day === 20) return '二十'
  if (day === 30) return '三十'
  if (day < 10) return '初' + DAY_NAMES[day]
  if (day < 20) return '十' + DAY_NAMES[day - 10]
  return '廿' + DAY_NAMES[day - 20]
}

function ganZhiOf(year) {
  const offset = ((year - 4) % 60 + 60) % 60
  return GAN[offset % 10] + ZHI[offset % 12]
}

function validSolar(y, m, d) {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

/**
 * 公历转农历。
 * @returns {null|{year,month,day,isLeap,monthName,dayName,ganZhi,text}}
 */
function solarToLunar(y, m, d) {
  if (!validSolar(y, m, d)) return null
  let offset = Math.floor((Date.UTC(y, m - 1, d) - BASE_UTC) / 86400000)
  if (offset < 0) return null

  let year = MIN_YEAR
  while (year <= MAX_YEAR) {
    const days = yearDays(year)
    if (offset < days) break
    offset -= days
    year++
  }
  if (year > MAX_YEAR) return null

  const leap = leapMonth(year)
  let month = 1
  let isLeap = false
  while (month <= 12) {
    const normalDays = monthDays(year, month)
    if (offset < normalDays) break
    offset -= normalDays

    if (leap === month) {
      const extraDays = leapDays(year)
      if (offset < extraDays) {
        isLeap = true
        break
      }
      offset -= extraDays
    }
    month++
  }
  if (month > 12) return null

  const day = offset + 1
  const monthName = MONTH_NAMES[month - 1]
  return {
    year,
    month,
    day,
    isLeap,
    monthName,
    dayName: dayName(day),
    ganZhi: ganZhiOf(year),
    text: ganZhiOf(year) + '年 ' + (isLeap ? '闰' : '') + monthName + '月 ' + dayName(day)
  }
}

/**
 * 农历转公历，主要供单测做往返校验。
 * @returns {null|{year,month,day}}
 */
function lunarToSolar(year, month, day, isLeap) {
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1 || day > 30) {
    return null
  }
  const leap = leapMonth(year)
  if (isLeap && leap !== month) return null

  let offset = 0
  for (let y = MIN_YEAR; y < year; y++) offset += yearDays(y)
  for (let m = 1; m < month; m++) {
    offset += monthDays(year, m)
    if (leap === m) offset += leapDays(year)
  }
  if (isLeap) offset += monthDays(year, month)
  offset += day - 1

  const dt = new Date(BASE_UTC + offset * 86400000)
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() }
}

export { LUNAR_INFO, MONTH_NAMES, GAN, ZHI }
export default { solarToLunar, lunarToSolar, leapMonth, leapDays, monthDays, yearDays, dayName, ganZhiOf }
