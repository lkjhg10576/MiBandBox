/**
 * 日历页的纯计算工具：ISO 周数、月网格。
 * 不依赖 @system.*，可在 Node 下单测。
 */

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * 生成固定 6×7 的月网格。
 * @param {number} year 公历年
 * @param {number} month 0-11
 * @param {number} selectedDay 选中日，0 表示无
 * @param {Date} today 今天
 * @returns {Array<{d:number,k:string,cls:string}>} 42 格
 */
function buildMonthCells(year, month, selectedDay, today) {
  const firstWeekday = new Date(year, month, 1).getDay()
  const total = new Date(year, month + 1, 0).getDate()
  const cells = []
  const todayDay = today && today.getFullYear() === year && today.getMonth() === month ? today.getDate() : 0

  for (let i = 0; i < 42; i++) {
    const d = i - firstWeekday + 1
    let cls = ''
    if (d >= 1 && d <= total) {
      if (d === selectedDay) cls = 'sel'
      else if (d === todayDay) cls = 'today'
    }
    cells.push({ d: d >= 1 && d <= total ? d : 0, k: 'c' + i, cls })
  }
  return cells
}

function shiftMonth(year, month, delta) {
  const d = new Date(year, month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

export { isoWeek, isSameDay, buildMonthCells, shiftMonth }
export default { isoWeek, isSameDay, buildMonthCells, shiftMonth }
