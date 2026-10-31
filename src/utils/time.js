/**
 * 时间工具：统一按「本地日期」计算，避免时区/夏令时误差。
 */
function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

function dateOnly(d) {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
}

function parseDate(str) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(str || ''))
  if (!m) return null
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  const da = parseInt(m[3], 10)
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null
  const d = new Date(y, mo - 1, da)
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null
  return d
}

function formatDate(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

function formatClock(d) {
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

function formatClockSec(d) {
  return formatClock(d) + ':' + pad2(d.getSeconds())
}

function todayKey() {
  return formatDate(new Date())
}

function daysBetween(a, b) {
  return Math.round((dateOnly(b) - dateOnly(a)) / 86400000)
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function humanDelta(dateStr) {
  const d = parseDate(dateStr)
  if (!d) return { status: 'invalid', days: 0, text: '日期无效' }
  const diff = daysBetween(new Date(), d)
  if (diff === 0) return { status: 'today', days: 0, text: '就是今天' }
  if (diff > 0) return { status: 'future', days: diff, text: '还有 ' + diff + ' 天' }
  return { status: 'past', days: -diff, text: '已经 ' + -diff + ' 天' }
}

function countdownToEndOfDay(now) {
  const d = now || new Date()
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59)
  return Math.max(0, Math.floor((end.getTime() - d.getTime()) / 1000) + 1)
}

function countdownToEndOfYear(now) {
  const d = now || new Date()
  const end = new Date(d.getFullYear(), 11, 31, 23, 59, 59)
  return Math.max(0, Math.floor((end.getTime() - d.getTime()) / 1000) + 1)
}

function splitDuration(sec) {
  const s = Math.max(0, Math.floor(sec))
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  return { days, hours, minutes, seconds }
}

function weekdayName(d) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
}

export default {
  pad2,
  parseDate,
  formatDate,
  formatClock,
  formatClockSec,
  todayKey,
  daysBetween,
  daysInMonth,
  isLeap,
  humanDelta,
  countdownToEndOfDay,
  countdownToEndOfYear,
  splitDuration,
  weekdayName,
  dateOnly
}
