/**
 * 时区换算纯 JS 引擎：全球夏令时（DST）判断、24 小时制换算、城市检索与键盘草稿校验。
 *
 * 零 @system.* 依赖，可直接在 Node 单元测试与快应用页面间共用。
 * 遵循全仓 ES 兼容约定：不使用 .find( / .includes( / .startsWith( / .endsWith(。
 */
import data from '../data/timezones.js'

const CITIES = data.CITIES
const HOT_IDS = data.HOT_IDS

const CITY_MAP = {}
for (let i = 0; i < CITIES.length; i++) {
  CITY_MAP[CITIES[i].id] = CITIES[i]
}

const HOT_MAP = {}
for (let i = 0; i < HOT_IDS.length; i++) {
  HOT_MAP[HOT_IDS[i]] = i + 1
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

function cityById(id) {
  if (!id) return null
  return CITY_MAP[id] || null
}

/** 计算某年某月第 n 个星期 dow 的日期（month 为 0..11，dow 为 0=周日..6=周六，n 从 1 起） */
function nthWeekday(year, month, dow, n) {
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay()
  return 1 + ((dow - firstDow + 7) % 7) + (n - 1) * 7
}

/** 计算某年某月最后一个星期 dow 的日期（month 为 0..11，dow 为 0=周日..6=周六） */
function lastWeekday(year, month, dow) {
  const lastDate = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const lastDow = new Date(Date.UTC(year, month, lastDate)).getUTCDay()
  return lastDate - ((lastDow - dow + 7) % 7)
}

/**
 * 判断指定 UTC 毫秒时刻是否处于夏令时。
 * 覆盖规则：us（美加）/ eu（英欧）/ au（澳大利亚）/ nz（新西兰）/ cl（智利）/ il（以色列）/ eg（埃及）/ cu（古巴）。
 */
function isDstActive(rule, stdMin, utcMs) {
  if (!rule) return false
  const y = new Date(utcMs).getUTCFullYear()

  if (rule === 'us') {
    const start = Date.UTC(y, 2, nthWeekday(y, 2, 0, 2), 2, 0, 0) - stdMin * 60000
    const end = Date.UTC(y, 10, nthWeekday(y, 10, 0, 1), 2, 0, 0) - (stdMin + 60) * 60000
    return utcMs >= start && utcMs < end
  }

  if (rule === 'cu') {
    const start = Date.UTC(y, 2, nthWeekday(y, 2, 0, 2), 0, 0, 0) - stdMin * 60000
    const end = Date.UTC(y, 10, nthWeekday(y, 10, 0, 1), 1, 0, 0) - (stdMin + 60) * 60000
    return utcMs >= start && utcMs < end
  }

  if (rule === 'eu') {
    const start = Date.UTC(y, 2, lastWeekday(y, 2, 0), 1, 0, 0)
    const end = Date.UTC(y, 9, lastWeekday(y, 9, 0), 1, 0, 0)
    return utcMs >= start && utcMs < end
  }

  if (rule === 'il') {
    const start = Date.UTC(y, 2, lastWeekday(y, 2, 0) - 2, 2, 0, 0) - stdMin * 60000
    const end = Date.UTC(y, 9, lastWeekday(y, 9, 0), 2, 0, 0) - (stdMin + 60) * 60000
    return utcMs >= start && utcMs < end
  }

  if (rule === 'eg') {
    const start = Date.UTC(y, 3, lastWeekday(y, 3, 5), 0, 0, 0) - stdMin * 60000
    const end = Date.UTC(y, 9, lastWeekday(y, 9, 4) + 1, 0, 0, 0) - (stdMin + 60) * 60000
    return utcMs >= start && utcMs < end
  }

  if (rule === 'au') {
    const end = Date.UTC(y, 3, nthWeekday(y, 3, 0, 1), 3, 0, 0) - (stdMin + 60) * 60000
    const start = Date.UTC(y, 9, nthWeekday(y, 9, 0, 1), 2, 0, 0) - stdMin * 60000
    return utcMs < end || utcMs >= start
  }

  if (rule === 'nz') {
    const end = Date.UTC(y, 3, nthWeekday(y, 3, 0, 1), 3, 0, 0) - (stdMin + 60) * 60000
    const start = Date.UTC(y, 8, lastWeekday(y, 8, 0), 2, 0, 0) - stdMin * 60000
    return utcMs < end || utcMs >= start
  }

  if (rule === 'cl') {
    // 智利大陆及复活节岛均按圣地亚哥标准（-240/-180）统一切换
    const end = Date.UTC(y, 3, nthWeekday(y, 3, 0, 1), 0, 0, 0) + 180 * 60000
    const start = Date.UTC(y, 8, nthWeekday(y, 8, 0, 1), 0, 0, 0) + 240 * 60000
    return utcMs < end || utcMs >= start
  }

  return false
}

function formatUtcOffset(offsetMin) {
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return m ? 'UTC' + sign + h + ':' + pad2(m) : 'UTC' + sign + h
}

function offsetInfo(city, utcMs) {
  if (!city) return { offsetMin: 0, isDst: false, utcLabel: 'UTC+0' }
  const ts = typeof utcMs === 'number' ? utcMs : Date.now()
  const dst = city.dst ? isDstActive(city.dst, city.stdMin, ts) : false
  const offsetMin = city.stdMin + (dst ? 60 : 0)
  return {
    offsetMin: offsetMin,
    isDst: dst,
    utcLabel: formatUtcOffset(offsetMin)
  }
}

/** 按设备当前系统偏移匹配默认起始与目标城市 */
function defaultPair(now) {
  const d = now || new Date()
  const ts = d.getTime()
  const sysMin = -d.getTimezoneOffset()
  let fromId = ''
  if (sysMin === 480) {
    fromId = 'beijing'
  } else {
    for (let i = 0; i < HOT_IDS.length; i++) {
      const c = CITY_MAP[HOT_IDS[i]]
      if (c && offsetInfo(c, ts).offsetMin === sysMin) {
        fromId = c.id
        break
      }
    }
    if (!fromId) {
      for (let i = 0; i < CITIES.length; i++) {
        if (offsetInfo(CITIES[i], ts).offsetMin === sysMin) {
          fromId = CITIES[i].id
          break
        }
      }
    }
    if (!fromId) fromId = 'beijing'
  }
  const toId = fromId === 'new_york' ? 'beijing' : 'new_york'
  return { fromId: fromId, toId: toId }
}

/** 严格解析 24 小时制 H:MM / HH:MM（分钟必须两位 00..59，防止 9:5 歧义） */
function parseTime24(str) {
  const s = String(str || '').trim()
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return { ok: false, reason: 'format' }
  const hour = parseInt(m[1], 10)
  const minute = parseInt(m[2], 10)
  if (hour < 0 || hour > 23) return { ok: false, reason: 'hour' }
  if (minute < 0 || minute > 59) return { ok: false, reason: 'minute' }
  return {
    ok: true,
    hour: hour,
    minute: minute,
    formatted: pad2(hour) + ':' + pad2(minute)
  }
}

/** numinput 时间键盘按键状态机：保留前导零、限制冒号前后各最多两位 */
function pushTimeKey(draft, key) {
  const s = String(draft || '')
  if (key === ':') {
    if (s.indexOf(':') >= 0) return { ok: false, draft: s }
    if (s === '') return { ok: true, draft: '0:' }
    return { ok: true, draft: s + ':' }
  }
  if (/^[0-9]$/.test(key)) {
    if (s.length >= 5) return { ok: false, draft: s, toast: '已达最大长度限制' }
    const ci = s.indexOf(':')
    if (ci < 0) {
      if (s.length >= 2) return { ok: false, draft: s, toast: '请按 : 分隔时分' }
      return { ok: true, draft: s + key }
    }
    const minPart = s.slice(ci + 1)
    if (minPart.length >= 2) return { ok: false, draft: s, toast: '分钟只需两位' }
    return { ok: true, draft: s + key }
  }
  return { ok: false, draft: s }
}

/** numinput 点击确定时的时间校验 */
function validateTimeDraft(draft) {
  const parsed = parseTime24(draft)
  if (parsed.ok) {
    return {
      ok: true,
      value: parsed.formatted,
      hour: parsed.hour,
      minute: parsed.minute
    }
  }
  if (parsed.reason === 'hour') return { ok: false, message: '小时范围 0-23' }
  if (parsed.reason === 'minute') return { ok: false, message: '分钟范围 00-59' }
  return { ok: false, message: '请输入完整时间 (HH:MM)' }
}

function formatDiffDuration(absMin) {
  const h = Math.floor(absMin / 60)
  const m = absMin % 60
  if (h > 0 && m > 0) return h + ' 小时 ' + m + ' 分'
  if (h > 0) return h + ' 小时'
  return m + ' 分'
}

function dayLabelOf(diff) {
  if (diff <= -2) return '前天'
  if (diff === -1) return '昨天'
  if (diff === 1) return '明天'
  if (diff >= 2) return '后天'
  return '今天'
}

/**
 * 换算两城市间时间：
 * - 以 now 确定来源城市当前日历日，并评估来源/目标城市实时 DST 偏移；
 * - 返回目标时间 HH:MM、跨日标注（昨天/今天/明天）、双方 UTC 与 DST 状态及中文时差描述。
 */
function convertTime(fromId, toId, timeStr, now) {
  const fromCity = cityById(fromId)
  const toCity = cityById(toId)
  const parsed = parseTime24(timeStr)
  if (!fromCity || !toCity || !parsed.ok) return null

  const ref = now || new Date()
  const nowMs = ref.getTime()
  const fromNowOff = offsetInfo(fromCity, nowMs)
  const fromNowLocal = new Date(nowMs + fromNowOff.offsetMin * 60000)

  const fromY = fromNowLocal.getUTCFullYear()
  const fromM = fromNowLocal.getUTCMonth()
  const fromD = fromNowLocal.getUTCDate()

  const wallMs = Date.UTC(fromY, fromM, fromD, parsed.hour, parsed.minute, 0, 0)
  let utcMs = wallMs - fromNowOff.offsetMin * 60000
  const fromOff = offsetInfo(fromCity, utcMs)
  utcMs = wallMs - fromOff.offsetMin * 60000

  const toOff = offsetInfo(toCity, utcMs)
  const toLocal = new Date(utcMs + toOff.offsetMin * 60000)
  const toTime = pad2(toLocal.getUTCHours()) + ':' + pad2(toLocal.getUTCMinutes())

  const fromDayNum = Math.floor(Date.UTC(fromY, fromM, fromD) / 86400000)
  const toDayNum = Math.floor(Date.UTC(toLocal.getUTCFullYear(), toLocal.getUTCMonth(), toLocal.getUTCDate()) / 86400000)
  const dayDiff = toDayNum - fromDayNum
  const dayLabel = dayLabelOf(dayDiff)

  const diffMin = toOff.offsetMin - fromOff.offsetMin
  let relDiffText = '无时差'
  let diffText = toCity.city + '与' + fromCity.city + '无时差'
  if (diffMin !== 0) {
    const dir = diffMin > 0 ? '快' : '慢'
    const dur = formatDiffDuration(Math.abs(diffMin))
    relDiffText = '比' + fromCity.city + dir + ' ' + dur
    diffText = toCity.city + relDiffText
  }

  return {
    fromCity: fromCity,
    toCity: toCity,
    fromTime: parsed.formatted,
    toTime: toTime,
    fromOffset: fromOff,
    toOffset: toOff,
    dayDiff: dayDiff,
    dayLabel: dayLabel,
    diffMin: diffMin,
    relDiffText: relDiffText,
    diffText: diffText,
    utcMs: utcMs
  }
}

function formatCityNow(city, utcMs) {
  const ts = typeof utcMs === 'number' ? utcMs : Date.now()
  const info = offsetInfo(city, ts)
  const local = new Date(ts + info.offsetMin * 60000)
  return {
    time: pad2(local.getUTCHours()) + ':' + pad2(local.getUTCMinutes()),
    offset: info
  }
}

function parseUtcQuery(q) {
  const m = /^(?:utc|gmt)?\s*([+-])\s*(\d{1,2})(?::(\d{2}))?$/.exec(q)
  if (m) {
    const h = parseInt(m[2], 10)
    const min = m[3] ? parseInt(m[3], 10) : 0
    if (h <= 14 && min < 60) {
      return (m[1] === '-' ? -1 : 1) * (h * 60 + min)
    }
  }
  const m2 = /^(?:utc|gmt)\s*(\d{1,2})(?::(\d{2}))?$/.exec(q)
  if (m2) {
    const h = parseInt(m2[1], 10)
    const min = m2[2] ? parseInt(m2[2], 10) : 0
    if (h <= 14 && min < 60) return h * 60 + min
  }
  return null
}

/**
 * 城市检索：支持中文城市名/国家名、拼音全拼/首字母、英文名、UTC±X 偏移。
 * 空查询返回置顶热门城市 + 其余全部城市。
 */
function searchCities(query, utcMs) {
  const ts = typeof utcMs === 'number' ? utcMs : Date.now()
  const raw = String(query || '').trim().toLowerCase()

  if (!raw) {
    const hot = []
    const rest = []
    for (let i = 0; i < HOT_IDS.length; i++) {
      const c = CITY_MAP[HOT_IDS[i]]
      if (c) hot.push(c)
    }
    for (let i = 0; i < CITIES.length; i++) {
      if (!HOT_MAP[CITIES[i].id]) rest.push(CITIES[i])
    }
    return hot.concat(rest)
  }

  const utcMinQuery = parseUtcQuery(raw)
  const scored = []

  for (let i = 0; i < CITIES.length; i++) {
    const c = CITIES[i]
    const info = offsetInfo(c, ts)
    const cityLow = c.city.toLowerCase()
    const countryLow = c.country.toLowerCase()
    const keysLow = c.keys.toLowerCase()
    const utcLow = info.utcLabel.toLowerCase()
    const stdLow = formatUtcOffset(c.stdMin).toLowerCase()

    let score = 0
    if (cityLow === raw || countryLow === raw || c.id === raw) {
      score = 100
    } else if (utcMinQuery !== null && info.offsetMin === utcMinQuery) {
      score = 90
    } else if (cityLow.indexOf(raw) === 0 || countryLow.indexOf(raw) === 0) {
      score = 80
    } else {
      const tokens = keysLow.split(' ')
      let tokenExact = false
      let tokenPrefix = false
      for (let j = 0; j < tokens.length; j++) {
        if (tokens[j] === raw) { tokenExact = true; break }
        if (tokens[j].indexOf(raw) === 0) tokenPrefix = true
      }
      if (tokenExact) score = 75
      else if (tokenPrefix) score = 60
      else if (cityLow.indexOf(raw) >= 0 || countryLow.indexOf(raw) >= 0) score = 45
      else if (utcLow.indexOf(raw) >= 0 || stdLow.indexOf(raw) >= 0) score = 35
      else if (keysLow.indexOf(raw) >= 0) score = 20
    }

    if (score > 0) {
      scored.push({
        city: c,
        score: score,
        hot: HOT_MAP[c.id] || 9999,
        idx: i
      })
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.hot !== b.hot) return a.hot - b.hot
    return a.idx - b.idx
  })

  const out = []
  for (let i = 0; i < scored.length; i++) out.push(scored[i].city)
  return out
}

export default {
  CITIES,
  HOT_IDS,
  pad2,
  cityById,
  isDstActive,
  formatUtcOffset,
  offsetInfo,
  defaultPair,
  parseTime24,
  pushTimeKey,
  validateTimeDraft,
  convertTime,
  formatCityNow,
  searchCities
}
