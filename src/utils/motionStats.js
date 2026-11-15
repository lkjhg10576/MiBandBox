/**
 * 体感游戏统计：今日 / 总计的已射击与已投进数，一个键（g.kv）存全部。
 *
 * 「今日」按手环本地日期滚动：读写时发现存档不是今天，就把今日数清零、
 * 总计保留。跨零点继续玩的话，第一下计数会自动开出新的一天，不需要定时器。
 *
 * 纯 JS、零 @system.* 依赖：日期一律由调用方传进来（页面传 today()），
 * Node 可直接单测（tools/test-motion-stats.mjs）。KV 的读写由页面自己做，
 * 这里只管「存档长什么样、怎么滚动、怎么 +1」。
 */

/** 存档键（g.kv） */
export const KV_KEY = 'motionStats'

/** 空存档：日期为空 → 下一次读写必然滚动到今天 */
export function empty() {
  return { day: '', gunToday: 0, gunTotal: 0, hoopToday: 0, hoopTotal: 0 }
}

/** 任意日期 → 本地 YYYY-MM-DD（跨天判断用字符串比较，不涉时区换算） */
export function dayOf(d) {
  const dt = d instanceof Date ? d : new Date()
  const m = dt.getMonth() + 1
  const day = dt.getDate()
  return dt.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day)
}

/** 现在的本地日期串（页面计数时用） */
export function today() {
  return dayOf(new Date())
}

/** 非法数字一律归 0：存档可能被老版本或手改文件污染，别让 NaN 传出去 */
function num(v) {
  return typeof v === 'number' && isFinite(v) && v > 0 ? Math.floor(v) : 0
}

/**
 * 把任意（可能残缺/跨天的）存档滚成「今天」的合法存档。
 * 跨天：今日数清零，总计保留；残缺字段补 0。
 */
export function roll(raw, day) {
  const s = raw && typeof raw === 'object' ? raw : {}
  if (s.day !== day) {
    return { day: day, gunToday: 0, gunTotal: num(s.gunTotal), hoopToday: 0, hoopTotal: num(s.hoopTotal) }
  }
  return {
    day: s.day,
    gunToday: num(s.gunToday),
    gunTotal: num(s.gunTotal),
    hoopToday: num(s.hoopToday),
    hoopTotal: num(s.hoopTotal)
  }
}

/** 读档：滚到今天（页面在 kv.init 里用） */
export function load(raw) {
  return roll(raw, today())
}

/**
 * 计数 +1，返回新存档（不改入参）。which：'gun'（射击）| 'hoop'（投进）。
 * day 缺省按今天 —— 单测传固定日期来模拟跨天。
 */
export function bump(stats, which, day) {
  const s = roll(stats, day || today())
  if (which === 'gun') {
    s.gunToday++
    s.gunTotal++
  } else if (which === 'hoop') {
    s.hoopToday++
    s.hoopTotal++
  }
  return s
}

export default { KV_KEY, empty, dayOf, today, roll, load, bump }
