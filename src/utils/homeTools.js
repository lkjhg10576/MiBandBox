/**
 * 首页工具管理（置顶 / 收藏 / 隐藏）数据层。
 *
 * KV 键约定：
 *   'pinApps'  - 置顶工具 id 列表（上限 4 个，顺序 = 置顶操作先后）
 *   'favApps'  - 收藏工具 id 列表（无上限）
 *   'hideApps' - 隐藏工具 id 列表
 *
 * 隐藏动作包含侧动作：把 id 同步移出 pinApps 与 favApps（数据层统一收口）。
 *
 * 注意：不使用 .find( 与 .includes(，保持全仓引擎兼容性约束。
 */
import g from './g.js'

const PIN_KEY = 'pinApps'
const FAV_KEY = 'favApps'
const HIDE_KEY = 'hideApps'
const MAX_PIN = 4

const SETTINGS_TILE = {
  id: '__settings__',
  name: '设置',
  desc: '首页样式 · 关于',
  route: '/pages/set',
  icon: '/common/icons/settings.png'
}

/**
 * 构造收藏入口格伪条目
 * @param {number} favCount 收藏数量
 */
function buildFavTile(favCount) {
  return {
    id: '__favtools__',
    name: '收藏功能',
    desc: (favCount || 0) + ' 个收藏',
    route: '/pages/toolfav',
    icon: '/common/icons/fav.png'
  }
}

/**
 * 构建首页主要布局（grid / grid2 / list）的数据列表
 * @param {Array} appsList 基础工具列表
 * @param {Object} prefs { pin, fav, hide }
 * @param {Object} [favTile] 可选的自定义收藏格
 * @returns {Array} [置顶工具] + [收藏格(有收藏时)] + [其余工具(去置顶去隐藏)] + [设置行]
 */
function buildMain(appsList, prefs, favTile) {
  const pin = (prefs && prefs.pin) || []
  const fav = (prefs && prefs.fav) || []
  const hide = (prefs && prefs.hide) || []

  const hideMap = {}
  for (let i = 0; i < hide.length; i++) {
    hideMap[hide[i]] = true
  }

  const pinMap = {}
  for (let i = 0; i < pin.length; i++) {
    pinMap[pin[i]] = true
  }

  const appMap = {}
  const tools = []
  let settingsTile = null

  const list = appsList || []
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    if (!a) continue
    if (a.id === '__settings__') {
      settingsTile = a
    } else if (a.id && a.id.indexOf('__') === 0) {
      // 忽略内部占位格
    } else {
      appMap[a.id] = a
      tools.push(a)
    }
  }

  if (!settingsTile) {
    settingsTile = SETTINGS_TILE
  }

  // 1. 置顶工具（按 pin 数组顺序）
  const pinned = []
  for (let i = 0; i < pin.length; i++) {
    const id = pin[i]
    if (appMap[id] && !hideMap[id]) {
      pinned.push(appMap[id])
    }
  }

  // 2. 收藏入口格（有收藏时出现）
  const favRows = []
  if (fav.length > 0) {
    favRows.push(favTile || buildFavTile(fav.length))
  }

  // 3. 其余工具（原 apps 序，去置顶去隐藏）
  const rest = []
  for (let i = 0; i < tools.length; i++) {
    const a = tools[i]
    if (!pinMap[a.id] && !hideMap[a.id]) {
      rest.push(a)
    }
  }

  return pinned.concat(favRows).concat(rest).concat([settingsTile])
}

/**
 * 构建首页分类单栏（cat）布局的数据列表
 * @param {Array} catsList 分类列表（cats.CATS）
 * @param {Array} appsList 基础工具列表
 * @param {Object} prefs { pin, fav, hide }
 * @param {Object} [favTile] 可选的自定义收藏格
 * @returns {Array} [置顶工具行(单栏)] + [收藏格(有收藏时)] + [9 个分类行] + [设置行]
 */
function buildCatRows(catsList, appsList, prefs, favTile) {
  const pin = (prefs && prefs.pin) || []
  const fav = (prefs && prefs.fav) || []
  const hide = (prefs && prefs.hide) || []

  const hideMap = {}
  for (let i = 0; i < hide.length; i++) {
    hideMap[hide[i]] = true
  }

  const appMap = {}
  const apps = appsList || []
  for (let i = 0; i < apps.length; i++) {
    const a = apps[i]
    if (a && a.id && a.id.indexOf('__') !== 0) {
      appMap[a.id] = a
    }
  }

  // 1. 置顶工具行（分类模式下置顶工具以单栏条目直接显示在顶部）
  const pinnedRows = []
  for (let i = 0; i < pin.length; i++) {
    const id = pin[i]
    if (appMap[id] && !hideMap[id]) {
      pinnedRows.push(appMap[id])
    }
  }

  // 2. 收藏入口格
  const favRows = []
  if (fav.length > 0) {
    favRows.push(favTile || buildFavTile(fav.length))
  }

  // 3. 分类行（按可见工具数重算 desc，全隐藏分类保留显示「0 个工具」）
  const catRows = []
  const cats = catsList || []
  for (let i = 0; i < cats.length; i++) {
    const c = cats[i]
    let visibleCount = 0
    if (c.tools) {
      for (let j = 0; j < c.tools.length; j++) {
        const tid = c.tools[j]
        if (appMap[tid] && !hideMap[tid]) {
          visibleCount++
        }
      }
    }
    catRows.push({
      id: c.id,
      cat: c.id,
      name: c.name,
      icon: c.icon,
      desc: visibleCount + ' 个工具'
    })
  }

  return pinnedRows.concat(favRows).concat(catRows).concat([SETTINGS_TILE])
}

/**
 * 读三组偏好设置
 * @param {Function} cb 回调参数为 { pin, fav, hide }
 */
function read(cb) {
  if (typeof cb !== 'function') return
  g.kv.init(() => {
    const rawPin = g.kv.get(PIN_KEY, [])
    const rawFav = g.kv.get(FAV_KEY, [])
    const rawHide = g.kv.get(HIDE_KEY, [])

    const pin = []
    if (Array.isArray(rawPin)) {
      for (let i = 0; i < rawPin.length; i++) {
        if (typeof rawPin[i] === 'string') {
          pin.push(rawPin[i])
          if (pin.length >= MAX_PIN) break
        }
      }
    }

    const fav = []
    if (Array.isArray(rawFav)) {
      for (let i = 0; i < rawFav.length; i++) {
        if (typeof rawFav[i] === 'string') fav.push(rawFav[i])
      }
    }

    const hide = []
    if (Array.isArray(rawHide)) {
      for (let i = 0; i < rawHide.length; i++) {
        if (typeof rawHide[i] === 'string') hide.push(rawHide[i])
      }
    }

    cb({ pin, fav, hide })
  })
}

/**
 * 切换置顶状态
 * @param {string} id 工具 id
 * @param {Function} cb 回调参数 { ok, active, reason, pin }
 */
function togglePin(id, cb) {
  if (!id || typeof id !== 'string') return
  g.kv.init(() => {
    const rawPin = g.kv.get(PIN_KEY, [])
    const pin = []
    if (Array.isArray(rawPin)) {
      for (let i = 0; i < rawPin.length; i++) {
        if (typeof rawPin[i] === 'string') pin.push(rawPin[i])
      }
    }

    const idx = pin.indexOf(id)
    if (idx !== -1) {
      pin.splice(idx, 1)
      g.kv.set(PIN_KEY, pin)
      g.kv.flush()
      if (typeof cb === 'function') cb({ ok: true, active: false, pin })
    } else {
      if (pin.length >= MAX_PIN) {
        if (typeof cb === 'function') cb({ ok: false, reason: 'max', pin })
        return
      }
      pin.push(id)
      g.kv.set(PIN_KEY, pin)
      g.kv.flush()
      if (typeof cb === 'function') cb({ ok: true, active: true, pin })
    }
  })
}

/**
 * 切换收藏状态
 * @param {string} id 工具 id
 * @param {Function} cb 回调参数 { ok, active, fav }
 */
function toggleFav(id, cb) {
  if (!id || typeof id !== 'string') return
  g.kv.init(() => {
    const rawFav = g.kv.get(FAV_KEY, [])
    const fav = []
    if (Array.isArray(rawFav)) {
      for (let i = 0; i < rawFav.length; i++) {
        if (typeof rawFav[i] === 'string') fav.push(rawFav[i])
      }
    }

    const idx = fav.indexOf(id)
    let active = false
    if (idx !== -1) {
      fav.splice(idx, 1)
      active = false
    } else {
      fav.push(id)
      active = true
    }
    g.kv.set(FAV_KEY, fav)
    g.kv.flush()
    if (typeof cb === 'function') cb({ ok: true, active, fav })
  })
}

/**
 * 切换隐藏状态（隐藏时自动将 id 移出 pinApps 与 favApps）
 * @param {string} id 工具 id
 * @param {Function} cb 回调参数 { ok, hidden, hide, pin, fav }
 */
function toggleHide(id, cb) {
  if (!id || typeof id !== 'string') return
  g.kv.init(() => {
    const rawHide = g.kv.get(HIDE_KEY, [])
    const hide = []
    if (Array.isArray(rawHide)) {
      for (let i = 0; i < rawHide.length; i++) {
        if (typeof rawHide[i] === 'string') hide.push(rawHide[i])
      }
    }

    const idx = hide.indexOf(id)
    if (idx !== -1) {
      hide.splice(idx, 1)
      g.kv.set(HIDE_KEY, hide)
      g.kv.flush()
      if (typeof cb === 'function') cb({ ok: true, hidden: false, hide })
    } else {
      hide.push(id)

      const rawPin = g.kv.get(PIN_KEY, [])
      let pinChanged = false
      const pin = []
      if (Array.isArray(rawPin)) {
        for (let i = 0; i < rawPin.length; i++) {
          if (rawPin[i] === id) {
            pinChanged = true
          } else if (typeof rawPin[i] === 'string') {
            pin.push(rawPin[i])
          }
        }
      }

      const rawFav = g.kv.get(FAV_KEY, [])
      let favChanged = false
      const fav = []
      if (Array.isArray(rawFav)) {
        for (let i = 0; i < rawFav.length; i++) {
          if (rawFav[i] === id) {
            favChanged = true
          } else if (typeof rawFav[i] === 'string') {
            fav.push(rawFav[i])
          }
        }
      }

      if (pinChanged) g.kv.set(PIN_KEY, pin)
      if (favChanged) g.kv.set(FAV_KEY, fav)
      g.kv.set(HIDE_KEY, hide)
      g.kv.flush()
      if (typeof cb === 'function') cb({ ok: true, hidden: true, hide, pin, fav })
    }
  })
}

export {
  read,
  togglePin,
  toggleFav,
  toggleHide,
  buildMain,
  buildCatRows,
  buildFavTile,
  PIN_KEY,
  FAV_KEY,
  HIDE_KEY,
  MAX_PIN,
  SETTINGS_TILE
}

export default {
  read,
  togglePin,
  toggleFav,
  toggleHide,
  buildMain,
  buildCatRows,
  buildFavTile,
  PIN_KEY,
  FAV_KEY,
  HIDE_KEY,
  MAX_PIN,
  SETTINGS_TILE
}
