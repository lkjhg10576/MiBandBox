/**
 * 导航状态存储：纯内存的虚拟帧栈 + 状态胶囊，服务于 MAX_STACK 溢出的 freeze/thaw 路径。
 *
 * 历史版本还有「双槽会话日志 + 崩溃续页」（冷启动恢复到最后页面），2026-11-28 整体移除：
 * 手环上正常退出（表冠/划掉后台）经常不触发 onHide、或进程在异步落盘前被杀，
 * 「已进后台」标记赢不了系统杀进程 → 正常退出被误判成崩溃，重开直接跳回最后页面，
 * 误报远多于真崩溃；且自动续页与「重开恒回首页」的直觉相悖（用户反馈）。
 * 勿再引入基于磁盘日志的续页。胶囊同理只留 RAM 热环：进程死后虚拟帧栈即重置，
 * ROM 胶囊没有任何读者，只制造写放大。
 *
 * 所有状态挂 global（页面 bundle 独立，模块级变量不跨 bundle 共享）。
 */

const globalRoot =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof global !== 'undefined'
      ? global
      : {}

const MAX_FRAMES = 8
const CAP_LIMIT = 4096

const store = globalRoot.__bbNavStore || {
  frames: [],
  capsules: {},
  seq: 1,
  pending: null,
  pendingTimer: null
}

globalRoot.__bbNavStore = store

function cloneParams(params) {
  const out = {}
  if (!params || typeof params !== 'object') return out
  for (const k in params) {
    const v = params[k]
    if (v === undefined || typeof v === 'function') continue
    out[k] = typeof v === 'object' ? String(v) : v
  }
  return out
}

function ensureHome() {
  if (!store.frames.length) {
    store.frames.push({ id: 'f0', route: '/pages/home', params: {}, frozen: false })
  }
}

function trim() {
  while (store.frames.length > MAX_FRAMES) {
    const idx = store.frames.length > 1 ? 1 : 0
    const f = store.frames.splice(idx, 1)[0]
    if (f && f.id) dropCapsule(f.id)
  }
}

function pushFrame(route, params, frozen) {
  ensureHome()
  store.frames.push({
    id: 'f' + store.seq++,
    route: route || '',
    params: cloneParams(params),
    frozen: !!frozen
  })
  trim()
}

function replaceFrame(route, params) {
  ensureHome()
  const old = store.frames[store.frames.length - 1]
  if (old && old.id) dropCapsule(old.id)
  store.frames[store.frames.length - 1] = {
    id: 'f' + store.seq++,
    route: route || '',
    params: cloneParams(params),
    frozen: false
  }
}

function popFrame() {
  ensureHome()
  if (store.frames.length <= 1) return store.frames[0] || null
  const old = store.frames.pop()
  if (old && old.id) dropCapsule(old.id)
  return store.frames[store.frames.length - 1] || null
}

function current() {
  ensureHome()
  return store.frames[store.frames.length - 1]
}

function previous() {
  ensureHome()
  return store.frames.length > 1 ? store.frames[store.frames.length - 2] : null
}

function freezeCurrent(state) {
  ensureHome()
  const f = store.frames[store.frames.length - 1]
  if (!f) return null
  f.frozen = true
  let out = state
  try {
    const text = JSON.stringify(state || null)
    if (!text || text.length > CAP_LIMIT) out = null
  } catch (e) {
    out = null
  }
  store.capsules[f.id] = { id: f.id, route: f.route, params: f.params, state: out }
  return f
}

function thaw(frame) {
  if (!frame) return
  frame.frozen = false
  if (frame.id) dropCapsule(frame.id)
}

function setPending(frame) {
  if (!frame) return
  const cap = store.capsules[frame.id] || null
  store.pending = {
    id: frame.id,
    route: frame.route,
    state: cap && cap.state !== undefined ? cap.state : null
  }
  if (store.pendingTimer) clearTimeout(store.pendingTimer)
  store.pendingTimer = setTimeout(() => {
    store.pending = null
    store.pendingTimer = null
  }, 4000)
}

function takePending(route) {
  const p = store.pending
  if (!p) return null
  if (route && p.route && route !== p.route) return null
  store.pending = null
  if (store.pendingTimer) clearTimeout(store.pendingTimer)
  store.pendingTimer = null
  return p.state
}

function reset(route) {
  store.frames = [{ id: 'f' + store.seq++, route: route || '/pages/home', params: {}, frozen: false }]
  store.capsules = {}
  store.pending = null
  if (store.pendingTimer) clearTimeout(store.pendingTimer)
  store.pendingTimer = null
}

function reconcile(route) {
  if (!route) return
  ensureHome()
  let top = current()
  if (top && top.route === route) {
    if (top.frozen) {
      top.frozen = false
      if (top.id) dropCapsule(top.id)
    }
    return
  }
  let guard = MAX_FRAMES + 2
  while (guard-- > 0) {
    top = current()
    if (!top || top.route === route) break
    popFrame()
  }
  if (route === '/pages/home') {
    store.frames = [{ id: 'f' + store.seq++, route: '/pages/home', params: {}, frozen: false }]
  }
}

function dropCapsule(id) {
  if (!id) return
  delete store.capsules[id]
}

export default {
  ensureHome,
  pushFrame,
  replaceFrame,
  popFrame,
  current,
  previous,
  freezeCurrent,
  thaw,
  setPending,
  takePending,
  reset,
  reconcile
}
