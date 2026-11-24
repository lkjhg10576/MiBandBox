/**
 * 首页「目标日」卡片的数据读取：带 60 秒缓存。
 *
 * 原来每次首页 onShow 都要 readText + JSON.parse + 全表 forEach 算 humanDelta；
 * 现在同一进程内 60 秒内复用上次结果（目标日增删改后调用 invalidate() 立即失效）。
 *
 * 事件字段（2026-11-23 起）：
 *   { id, title, date, createdAt, home, companion }
 *   home / companion 为 0|1（缺省 0）：
 *   - home = 1：这条目标日在首页顶部显示（首页只显示开着 home 的那条）；
 *   - companion = 1：这条目标日在桌面伴侣精美样式右栏显示。
 *   两者各自全局至多一条为 1 —— 互斥在 saveEvent() 的数据层统一收口。
 *
 * 旧数据迁移：首次读到「列表非空且全部条目都没有 home 字段」的旧数据时，
 * 按既有 best 口径把距离今天最近的一条双开（home = companion = 1）写回文件。
 */
import g from './g'
import time from './time'

const EVENTS_PATH = 'internal://files/bandbox/events.json'
const DIR = 'internal://files/bandbox/'
const TTL = 60000

// 跨 bundle 的数据版本：工具链把每个页面打成独立 bundle，模块级 cache / invalidate
// 都不跨页共享（同 pushInbox / accelHub 的已知约束）。状态挂 global —— 任一 bundle
// 写盘后版本 +1，其它 bundle 的 load 发现版本变了就重读文件，否则首页 / 桌面伴侣
// 最多会拿旧数据 60 秒（改了开关保存后看不到效果）。
const REV_KEY = '__bbEventsRev'
const root =
  typeof global !== 'undefined'
    ? global
    : typeof globalThis !== 'undefined'
      ? globalThis
      : {}

function currentRev() {
  return root[REV_KEY] || 0
}

function bumpRev() {
  root[REV_KEY] = currentRev() + 1
}

let cache = null
// 旧数据迁移的一次性守卫：同一进程内只写一次文件（写失败等下次启动再试）
let legacyMigrated = false

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
 * 旧数据判据：列表非空且全部条目都没有 home 字段（本功能上线前写入的事件）。
 * 只要有一条带 home，就说明是新格式数据 —— 其余条目缺字段按 0 处理，不再迁移。
 */
function isLegacyList(list) {
  if (!list || list.length === 0) return false
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    if (item && item.home !== undefined) return false
  }
  return true
}

/**
 * 旧数据迁移：把最近的一条（既有 best 口径）双开并写回文件。
 * 只改内存里的那条记录再整体序列化 —— 写盘失败也不影响本次回调拿到的数据。
 */
function migrateLegacy(list, best) {
  if (legacyMigrated || !best || !best.item) return
  legacyMigrated = true
  best.item.home = 1
  best.item.companion = 1
  g.fs.ensureDir(DIR, () => {
    g.fs.writeText(EVENTS_PATH, JSON.stringify(list), () => {})
  })
}

/**
 * 读取目标日数据
 * @param {Function} cb 回调参数 { at, list, best, bestHome, bestCompanion }
 *   best           = 不过滤口径的最近一条（向后兼容：伴侣旧代码仍按它取数）
 *   bestHome       = 开着「在主页显示」的条目里最近的一条
 *   bestCompanion  = 开着「在桌面伴侣中显示」的条目里最近的一条
 */
export function load(cb) {
  // rev 在读盘前取：读盘期间别的 bundle 若改了数据，这里缓存的 rev 就是旧的，
  // 下一次 load 会发现版本不一致而重读 —— 不会把旧列表当成新版本缓存住。
  const rev = currentRev()
  if (cache && cache.rev === rev && Date.now() - cache.at < TTL) {
    cb(cache)
    return
  }
  g.fs.readText(EVENTS_PATH, (text) => {
    const list = parse(text)
    const best = pickNearest(list)
    if (isLegacyList(list)) migrateLegacy(list, best)
    cache = {
      rev: rev,
      at: Date.now(),
      list: list,
      best: best,
      bestHome: pickNearest(list.filter((e) => e && e.home === 1)),
      bestCompanion: pickNearest(list.filter((e) => e && e.companion === 1))
    }
    cb(cache)
  })
}

/**
 * 保存一条目标日（新增或更新）—— 数据层统一收口：
 *   1) 互斥：本条 home = 1 时清掉其它条目的 home（companion 同理），
 *      保证「在主页显示」「在桌面伴侣中显示」各自全局至多一条；
 *   2) 透传 entry 的全部字段（更新时不得重建对象，否则新增字段会丢）；
 *   3) 写盘成功后 invalidate()，首页 / 桌面伴侣下次 load 重新读盘。
 *
 * @param {Object} entry { id, title, date, createdAt, home, companion }
 * @param {Function} cb 回调参数 { ok, list }
 */
export function saveEvent(entry, cb) {
  const done = (ok, list) => {
    if (typeof cb === 'function') cb({ ok: ok, list: list })
  }
  if (!entry || !entry.id) {
    done(false, [])
    return
  }
  g.fs.readText(EVENTS_PATH, (text) => {
    // 读盘失败时退回缓存里的列表：保存不能因为一次瞬时读失败把其它事件写没
    const list = text === null && cache && cache.list ? cache.list.slice() : parse(text)
    const record = Object.assign({}, entry)
    record.home = entry.home ? 1 : 0
    record.companion = entry.companion ? 1 : 0
    if (!record.createdAt) record.createdAt = Date.now()
    const id = String(record.id)

    const next = []
    let found = false
    for (let i = 0; i < list.length; i++) {
      const item = list[i]
      if (!item) continue
      if (String(item.id) === id) {
        found = true
        next.push(record)
        continue
      }
      const copy = Object.assign({}, item)
      if (record.home === 1) copy.home = 0
      if (record.companion === 1) copy.companion = 0
      next.push(copy)
    }
    if (!found) next.push(record)

    g.fs.ensureDir(DIR, () => {
      g.fs.writeText(EVENTS_PATH, JSON.stringify(next), (ok) => {
        if (ok) invalidate()
        done(!!ok, next)
      })
    })
  })
}

/**
 * 目标日增删改后调用：本 bundle 下次读取重新读盘，并 bump 全局版本让其它页面 bundle
 * （首页 / 桌面伴侣）的缓存一起失效。
 */
export function invalidate() {
  cache = null
  bumpRev()
}

export default { load, saveEvent, invalidate, EVENTS_PATH }
