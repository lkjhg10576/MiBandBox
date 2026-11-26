/**
 * 日常打卡存储层：KV 键 'habitList'（上限 12 项）。
 *
 * 条目结构：
 *   { id, name, target, todayCount, totalDays, streak, lastDate, lastDoneDate }
 *
 * 跨天结转纯函数（rolloverItem / rolloverList）：
 *   比对 todayKey 与 lastDate；跨天时若 lastDoneDate !== yesterdayKey 则将 streak 归零，
 *   清零 todayCount 并更新 lastDate。
 *   当 todayCount 首次达到 target 时递增 totalDays 与 streak 并写 lastDoneDate = todayKey。
 *
 * 零 @system.* 依赖，纯 JS 逻辑可直接 Node 单测。
 */
import g from './g.js'
import time from './time.js'

export const KEY = 'habitList'
export const MAX_ITEMS = 12
export const MAX_NAME_LEN = 20
export const MIN_TARGET = 1
export const MAX_TARGET = 99

const listeners = []

function notify() {
  listeners.slice().forEach((fn) => {
    try {
      fn()
    } catch (e) {}
  })
}

export function makeId() {
  return 'hb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

/** 计算 dateKey（YYYY-MM-DD）的前一天日期键（本地日历，不依赖 UTC 偏移）。 */
export function yesterdayKey(dateKey) {
  const d = time.parseDate(dateKey) || new Date()
  const prev = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)
  return time.formatDate(prev)
}

export function clampTarget(v) {
  const n = Math.floor(Number(v))
  if (!isFinite(n) || n < MIN_TARGET) return MIN_TARGET
  if (n > MAX_TARGET) return MAX_TARGET
  return n
}

export function cleanName(name) {
  return String(name == null ? '' : name)
    .replace(/[\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LEN)
}

/** 归一化单条打卡项：脏数据清洗与默认值补齐；无有效名称返回 null。 */
export function normalizeItem(raw, today) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const name = cleanName(raw.name)
  if (!name) return null
  const td = typeof today === 'string' && time.parseDate(today) ? today : time.todayKey()
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : makeId()
  const target = clampTarget(raw.target)
  const rawCount = Math.floor(Number(raw.todayCount))
  const todayCount = isFinite(rawCount) && rawCount > 0 ? Math.min(9999, rawCount) : 0
  const rawTotal = Math.floor(Number(raw.totalDays))
  const totalDays = isFinite(rawTotal) && rawTotal > 0 ? rawTotal : 0
  const rawStreak = Math.floor(Number(raw.streak))
  const streak = isFinite(rawStreak) && rawStreak > 0 ? rawStreak : 0
  const lastDate = typeof raw.lastDate === 'string' && time.parseDate(raw.lastDate) ? raw.lastDate : td
  const lastDoneDate =
    typeof raw.lastDoneDate === 'string' && time.parseDate(raw.lastDoneDate) ? raw.lastDoneDate : ''
  return { id, name, target, todayCount, totalDays, streak, lastDate, lastDoneDate }
}

/**
 * 跨天结转纯函数：
 *   - 若 item.lastDate === todayKey：保持原状；
 *   - 若跨天（item.lastDate !== todayKey）：
 *     若 lastDoneDate !== yesterdayKey，则将 streak 归零；
 *     清零 todayCount，并更新 lastDate = todayKey。
 */
export function rolloverItem(item, todayKey) {
  const td = typeof todayKey === 'string' && time.parseDate(todayKey) ? todayKey : time.todayKey()
  if (!item) return null
  if (item.lastDate === td) return Object.assign({}, item)
  const yest = yesterdayKey(td)
  const keepStreak = item.lastDoneDate === yest || item.lastDoneDate === td
  return Object.assign({}, item, {
    todayCount: 0,
    streak: keepStreak ? item.streak : 0,
    lastDate: td
  })
}

/** 批量归一化 + 跨天结转（返回 { list, changed }）。 */
export function rolloverList(rawList, todayKey) {
  const td = typeof todayKey === 'string' && time.parseDate(todayKey) ? todayKey : time.todayKey()
  if (!Array.isArray(rawList)) return { list: [], changed: false }
  const out = []
  let changed = false
  const seen = {}
  for (let i = 0; i < rawList.length; i++) {
    const norm = normalizeItem(rawList[i], td)
    if (!norm || seen[norm.id]) {
      changed = true
      continue
    }
    seen[norm.id] = true
    const rolled = rolloverItem(norm, td)
    if (
      rolled.lastDate !== rawList[i].lastDate ||
      rolled.todayCount !== rawList[i].todayCount ||
      rolled.streak !== rawList[i].streak ||
      rolled.target !== rawList[i].target ||
      rolled.name !== rawList[i].name
    ) {
      changed = true
    }
    out.push(rolled)
    if (out.length >= MAX_ITEMS) {
      if (rawList.length > MAX_ITEMS) changed = true
      break
    }
  }
  return { list: out, changed }
}

/** 首次初始化预置 3 条常用习惯。 */
export function defaultPresets(todayKey) {
  const td = typeof todayKey === 'string' && time.parseDate(todayKey) ? todayKey : time.todayKey()
  return [
    { id: 'hb_water', name: '喝水', target: 8, todayCount: 0, totalDays: 0, streak: 0, lastDate: td, lastDoneDate: '' },
    { id: 'hb_move', name: '起身活动', target: 4, todayCount: 0, totalDays: 0, streak: 0, lastDate: td, lastDoneDate: '' },
    { id: 'hb_read', name: '每日阅读', target: 1, todayCount: 0, totalDays: 0, streak: 0, lastDate: td, lastDoneDate: '' }
  ]
}

/** 对单条执行 +1（纯函数，含首次达标判断）。 */
export function applyTapInc(item, todayKey) {
  const td = typeof todayKey === 'string' && time.parseDate(todayKey) ? todayKey : time.todayKey()
  const base = rolloverItem(item, td)
  const nextCount = Math.min(9999, base.todayCount + 1)
  const reachedNow = nextCount >= base.target && base.lastDoneDate !== td
  const next = Object.assign({}, base, {
    todayCount: nextCount,
    totalDays: reachedNow ? base.totalDays + 1 : base.totalDays,
    streak: reachedNow ? base.streak + 1 : base.streak,
    lastDate: td,
    lastDoneDate: reachedNow ? td : base.lastDoneDate
  })
  return { item: next, reachedNow }
}

/** 对单条执行今日 -1 撤销（纯函数；若跌破达标线则回退今日达标增量）。 */
export function applyTapDec(item, todayKey) {
  const td = typeof todayKey === 'string' && time.parseDate(todayKey) ? todayKey : time.todayKey()
  const base = rolloverItem(item, td)
  if (base.todayCount <= 0) return { item: base, changed: false }
  const nextCount = base.todayCount - 1
  const lostTodayDone = nextCount < base.target && base.lastDoneDate === td
  const nextStreak = lostTodayDone ? Math.max(0, base.streak - 1) : base.streak
  const nextTotal = lostTodayDone ? Math.max(0, base.totalDays - 1) : base.totalDays
  const nextDoneDate = lostTodayDone ? (nextStreak > 0 ? yesterdayKey(td) : '') : base.lastDoneDate
  const next = Object.assign({}, base, {
    todayCount: nextCount,
    totalDays: nextTotal,
    streak: nextStreak,
    lastDate: td,
    lastDoneDate: nextDoneDate
  })
  return { item: next, changed: true }
}

function readAndNormalizeSync(todayKey) {
  const td = typeof todayKey === 'string' && time.parseDate(todayKey) ? todayKey : time.todayKey()
  const raw = g.kv.get(KEY, null)
  if (raw === null || raw === undefined) {
    const presets = defaultPresets(td)
    g.kv.set(KEY, presets)
    g.kv.flush()
    return presets
  }
  const res = rolloverList(raw, td)
  if (res.changed) {
    g.kv.set(KEY, res.list)
    g.kv.flush()
  }
  return res.list
}

function load(cb, todayKey) {
  g.kv.init(() => {
    const list = readAndNormalizeSync(todayKey)
    if (cb) cb(list)
  })
}

function getById(id, cb, todayKey) {
  load((list) => {
    let found = null
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        found = list[i]
        break
      }
    }
    if (cb) cb(found)
  }, todayKey)
}

function tapInc(id, cb, todayKey) {
  const td = typeof todayKey === 'string' && time.parseDate(todayKey) ? todayKey : time.todayKey()
  g.kv.init(() => {
    const list = readAndNormalizeSync(td)
    const nextList = []
    let updated = null
    let reachedNow = false
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        const res = applyTapInc(list[i], td)
        updated = res.item
        reachedNow = res.reachedNow
        nextList.push(updated)
      } else {
        nextList.push(list[i])
      }
    }
    if (!updated) {
      if (cb) cb({ ok: false, reason: 'not-found', list })
      return
    }
    g.kv.set(KEY, nextList)
    g.kv.flush()
    notify()
    if (cb) cb({ ok: true, item: updated, reachedNow, list: nextList })
  })
}

function tapDec(id, cb, todayKey) {
  const td = typeof todayKey === 'string' && time.parseDate(todayKey) ? todayKey : time.todayKey()
  g.kv.init(() => {
    const list = readAndNormalizeSync(td)
    const nextList = []
    let updated = null
    let changed = false
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        const res = applyTapDec(list[i], td)
        updated = res.item
        changed = res.changed
        nextList.push(updated)
      } else {
        nextList.push(list[i])
      }
    }
    if (!updated) {
      if (cb) cb({ ok: false, reason: 'not-found', list })
      return
    }
    if (changed) {
      g.kv.set(KEY, nextList)
      g.kv.flush()
      notify()
    }
    if (cb) cb({ ok: true, changed, item: updated, list: nextList })
  })
}

function upsert(entry, cb, todayKey) {
  const td = typeof todayKey === 'string' && time.parseDate(todayKey) ? todayKey : time.todayKey()
  const name = cleanName(entry && entry.name)
  if (!name) {
    if (cb) cb({ ok: false, reason: 'empty-name' })
    return
  }
  const target = clampTarget(entry && entry.target)
  const id = entry && typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : ''

  g.kv.init(() => {
    const list = readAndNormalizeSync(td)
    const nextList = []
    let saved = null
    if (id) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          const cur = list[i]
          let totalDays = cur.totalDays
          let streak = cur.streak
          let lastDoneDate = cur.lastDoneDate
          if (cur.todayCount >= target && lastDoneDate !== td) {
            totalDays += 1
            streak += 1
            lastDoneDate = td
          } else if (cur.todayCount < target && lastDoneDate === td) {
            totalDays = Math.max(0, totalDays - 1)
            streak = Math.max(0, streak - 1)
            lastDoneDate = streak > 0 ? yesterdayKey(td) : ''
          }
          saved = Object.assign({}, cur, { name, target, totalDays, streak, lastDoneDate })
          nextList.push(saved)
        } else {
          nextList.push(list[i])
        }
      }
    }
    if (!saved) {
      if (list.length >= MAX_ITEMS) {
        if (cb) cb({ ok: false, reason: 'max', list })
        return
      }
      saved = {
        id: id || makeId(),
        name,
        target,
        todayCount: 0,
        totalDays: 0,
        streak: 0,
        lastDate: td,
        lastDoneDate: ''
      }
      nextList.push(saved)
    }
    g.kv.set(KEY, nextList)
    g.kv.flush()
    notify()
    if (cb) cb({ ok: true, item: saved, list: nextList })
  })
}

function remove(id, cb, todayKey) {
  const td = typeof todayKey === 'string' && time.parseDate(todayKey) ? todayKey : time.todayKey()
  g.kv.init(() => {
    const list = readAndNormalizeSync(td)
    const nextList = []
    let found = false
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        found = true
      } else {
        nextList.push(list[i])
      }
    }
    if (found) {
      g.kv.set(KEY, nextList)
      g.kv.flush()
      notify()
    }
    if (cb) cb({ ok: found, list: nextList })
  })
}

function subscribe(fn) {
  if (typeof fn !== 'function') return () => {}
  if (listeners.indexOf(fn) < 0) listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i >= 0) listeners.splice(i, 1)
  }
}

export default {
  KEY,
  MAX_ITEMS,
  MAX_NAME_LEN,
  MIN_TARGET,
  MAX_TARGET,
  yesterdayKey,
  clampTarget,
  cleanName,
  normalizeItem,
  rolloverItem,
  rolloverList,
  defaultPresets,
  applyTapInc,
  applyTapDec,
  load,
  getById,
  tapInc,
  tapDec,
  upsert,
  remove,
  subscribe
}
