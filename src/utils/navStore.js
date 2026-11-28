/**
 * 导航状态存储：
 *   - 深栈溢出时，把被替换页的状态胶囊存进 RAM 热环 + ROM；
 *   - 维护虚拟帧栈，返回时重建冻结帧；
 *   - 导航边界写双槽会话日志，异常重启后由首页恢复。
 *
 * 所有状态挂 global（页面 bundle 独立，模块级变量不跨 bundle 共享）。
 * ROM 读写统一走 utils/fs，不直接碰 @system.file（门禁 R20）。
 */
import fs from './fs'

const DIR = 'internal://files/bandbox/nav'
const PTR = DIR + '/p.txt'
const SLOT0 = DIR + '/j0.json'
const SLOT1 = DIR + '/j1.json'
const CAP_LIMIT = 4096
const JOURNAL_LIMIT = 8192
const RESUME_AGE = 10 * 60 * 1000
const MAX_FRAMES = 8

const globalRoot =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof global !== 'undefined'
      ? global
      : {}

const store = globalRoot.__bbNavStore || {
  frames: [],
  capsules: {},
  seq: 1,
  pending: null,
  pendingTimer: null,
  journalTimer: null,
  journalWriting: false,
  journalPending: false,
  nextSlot: 0,
  backgrounded: false,
  resume: null,
  booted: false,
  bootCallbacks: [],
  dirReady: false,
  dirWaiters: []
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

function schedule() {
  if (store.journalTimer) return
  // 会话日志是「停顿检查点」，不是逐次导航日志：
  // 连续操作时不断重置，只有停在某页 2.5s 才落盘，避免 Vela 文件接口写放大。
  store.journalTimer = setTimeout(() => {
    store.journalTimer = null
    writeJournal()
  }, 2500)
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
  schedule()
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
  schedule()
}

function popFrame() {
  ensureHome()
  if (store.frames.length <= 1) return store.frames[0] || null
  const old = store.frames.pop()
  if (old && old.id) dropCapsule(old.id)
  schedule()
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
  const capsule = { id: f.id, route: f.route, params: f.params, state: out }
  store.capsules[f.id] = capsule
  writeCapsule(capsule)
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
  schedule()
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
  schedule()
}

// ---------- 胶囊 ROM ----------

function safeRead(uri, cb) {
  try {
    fs.readText(uri, cb)
  } catch (e) {
    if (cb) cb(null)
  }
}

function safeWrite(uri, text, cb) {
  try {
    fs.writeText(uri, text, cb)
  } catch (e) {
    if (cb) cb(false)
  }
}

function safeRemove(uri) {
  try {
    fs.remove(uri)
  } catch (e) {}
}

function dropCapsule(id) {
  if (!id) return
  delete store.capsules[id]
  safeRemove(capPath(id))
}

function ensureDir(cb) {
  if (store.dirReady) {
    if (cb) cb(true)
    return
  }
  if (cb) store.dirWaiters.push(cb)
  if (store.dirWaiters.length > 1) return
  try {
    fs.ensureDir(DIR, (ok) => {
      store.dirReady = !!ok
      const list = store.dirWaiters
      store.dirWaiters = []
      for (let i = 0; i < list.length; i++) {
        try { list[i](ok) } catch (e) {}
      }
    })
  } catch (e) {
    store.dirReady = false
    const list = store.dirWaiters
    store.dirWaiters = []
    for (let i = 0; i < list.length; i++) {
      try { list[i](false) } catch (err) {}
    }
  }
}

function capPath(id) {
  return DIR + '/c' + id + '.json'
}

function writeCapsule(capsule) {
  if (!capsule || !capsule.id) return
  ensureDir((ok) => {
    if (!ok) return
    let text = ''
    try {
      text = JSON.stringify(capsule)
    } catch (e) {
      return
    }
    safeWrite(capPath(capsule.id), text)
  })
}

function loadCapsule(id, cb) {
  if (!id) {
    if (cb) cb(null)
    return
  }
  const mem = store.capsules[id]
  if (mem) {
    if (cb) cb(mem)
    return
  }
  safeRead(capPath(id), (text) => {
    let cap = null
    try {
      cap = text ? JSON.parse(text) : null
    } catch (e) {}
    if (cap && cap.id === id) {
      store.capsules[id] = cap
      if (cb) cb(cap)
    } else if (cb) {
      cb(null)
    }
  })
}

// ---------- 会话日志 ----------

function buildJournal() {
  const frames = []
  for (let i = 0; i < store.frames.length; i++) {
    const f = store.frames[i]
    frames.push({
      id: f.id,
      route: f.route,
      params: f.params,
      frozen: !!f.frozen,
      hasCapsule: !!(f.frozen && store.capsules[f.id])
    })
  }
  return { v: 1, ts: Date.now(), bg: store.backgrounded, frames: frames }
}

function writeJournal() {
  try {
    const bb = globalRoot.__bb
    if (bb && bb.kv && typeof bb.kv.get === 'function' && bb.kv.get('navJournal', 1) === 0) return
  } catch (e) {}
  if (!store.frames.length) return
  if (store.journalWriting) {
    store.journalPending = true
    return
  }
  store.journalWriting = true
  ensureDir((ok) => {
    if (!ok) {
      store.journalWriting = false
      return
    }
    let text = ''
    try {
      text = JSON.stringify(buildJournal())
      if (text.length > JOURNAL_LIMIT) {
        // 超限：只保留路由与 id，参数可能缺失，恢复时页面按默认值重建
        const slim = buildJournal()
        for (let i = 0; i < slim.frames.length; i++) slim.frames[i].params = {}
        text = JSON.stringify(slim)
      }
    } catch (e) {
      store.journalWriting = false
      return
    }
    const slot = store.nextSlot === 0 ? SLOT0 : SLOT1
    const next = store.nextSlot === 0 ? 1 : 0
    safeWrite(slot, text, (ok2) => {
      if (!ok2) {
        store.journalWriting = false
        return
      }
      safeWrite(PTR, String(store.nextSlot), () => {
        store.nextSlot = next
        store.journalWriting = false
        if (store.journalPending) {
          store.journalPending = false
          writeJournal()
        }
      })
    })
  })
}

function parseJournal(text) {
  try {
    const j = JSON.parse(text)
    if (!j || j.v !== 1 || !j.frames || !j.frames.length) return null
    if (Date.now() - j.ts > RESUME_AGE) return null
    if (j.bg) return null
    const top = j.frames[j.frames.length - 1]
    if (!top || top.route === '/pages/home') return null
    return j
  } catch (e) {
    return null
  }
}

function boot() {
  if (store.booted) return
  store.booted = true
  ensureDir((ok) => {
    if (!ok) return flushBoot()
    safeRead(PTR, (ptr) => {
      store.nextSlot = ptr === '0' ? 1 : 0
      const first = ptr === '0' ? SLOT0 : SLOT1
      const second = ptr === '0' ? SLOT1 : SLOT0
      safeRead(first, (t1) => {
        let j = parseJournal(t1)
        if (j) {
          store.resume = j
          cleanupCapsules(j)
          return flushBoot()
        }
        safeRead(second, (t2) => {
          j = parseJournal(t2)
          if (j) store.resume = j
          cleanupCapsules(j)
          flushBoot()
        })
      })
    })
  })
}

function cleanupCapsules(journal) {
  const keep = {}
  if (journal && journal.frames) {
    for (let i = 0; i < journal.frames.length; i++) {
      if (journal.frames[i].hasCapsule) keep['c' + journal.frames[i].id + '.json'] = true
    }
  }
  try {
    fs.list(DIR, (list) => {
      for (let i = 0; i < (list || []).length; i++) {
        const name = list[i]
        if (/^c.*\.json$/.test(name) && !keep[name]) safeRemove(DIR + '/' + name)
      }
    })
  } catch (e) {}
}

function flushBoot() {
  const list = store.bootCallbacks
  store.bootCallbacks = []
  for (let i = 0; i < list.length; i++) {
    try { list[i](store.resume) } catch (e) {}
  }
}

function consumeResume() {
  const r = store.resume
  store.resume = null
  if (!r) return null
  // 恢复时把虚拟栈重置为 home，后续 push 会重建
  store.frames = [{ id: 'f' + store.seq++, route: '/pages/home', params: {}, frozen: false }]
  store.capsules = {}
  return r
}

function markBackgrounded(v) {
  store.backgrounded = !!v
  if (!store.frames.length) return
  if (store.journalTimer) {
    clearTimeout(store.journalTimer)
    store.journalTimer = null
  }
  writeJournal()
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
  reconcile,
  loadCapsule,
  consumeResume,
  markBackgrounded,
  boot,
  schedule
}