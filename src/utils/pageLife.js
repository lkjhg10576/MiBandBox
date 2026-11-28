/**
 * 页面小睡（Nap）：离场前卸下当前页的已渲染 UI 树，返回时重建。
 *
 * Vela 的页面栈会保留每一个被覆盖页面的原生 UI 子树（节点、图片、组件实例），
 * 这是页面栈占 RAM 的主要部分。根节点内部的 .napWrap 绑定 if="{{ awake }}" 后，
 * 把 awake 置 false 会销毁整棵子树，但 ViewModel（data/private、定时器句柄、
 * 表单草稿）仍留在内存里；重新显示时置 true 即可重建，不必重建页面 bundle。
 *
 * 约定：
 *   - 页面用 life({...}) 包装导出，自动注入 awake 字段并接管 onShow/onDestroy；
 *   - router.push 在原生 push 前调用 preNap(len)（此时页面仍可见，awake 更新会生效；
 *     栈深 <3 不睡——首页与一级页保持 UI 树，返回免整树重建，真机不再黑屏一瞬）；
 *   - router.js 每次导航后调用 rebalance()，back() 前调用 markBack()；
 *   - App 退后台/息屏不走 preNap，当前页 UI 保持。
 */

const globalRoot =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof global !== 'undefined'
      ? global
      : {}

const store = globalRoot.__bbPageLife || {
  stack: [],
  lastBackAt: 0
}
globalRoot.__bbPageLife = store

function enabled() {
  try {
    const bb = globalRoot.__bb
    if (bb && bb.kv && typeof bb.kv.get === 'function') {
      const v = bb.kv.get('memNap', 1)
      return v !== 0 && v !== false && v !== '0'
    }
  } catch (e) {}
  return true
}

function find(page) {
  for (let i = 0; i < store.stack.length; i++) {
    if (store.stack[i].page === page) return store.stack[i]
  }
  return null
}

function wake(page) {
  if (!page || page.awake === true) return
  try {
    page.awake = true
  } catch (e) {}
}

function sleep(page) {
  if (!page || page.awake === false) return
  try {
    page.awake = false
  } catch (e) {}
}

function rebalance() {
  const e = store.stack.length ? store.stack[store.stack.length - 1] : null
  if (!e) return
  if (!enabled()) {
    wake(e.page)
    return
  }
  if (e.preNapped) sleep(e.page)
  else wake(e.page)
}

function preNap(len) {
  if (!enabled()) return
  // 浅栈不睡（2026-11-28 真机修复）：栈深 <3 时当前页保持 UI 树，返回免整树重建——
  // 真机整树重建比返回转场慢，表现为先黑屏一下再亮起。首页与一级页（栈深 1/2）
  // 因此常驻 UI 树、返回秒显；栈深 ≥3 才卸当前页，常驻 UI 上限收敛在 3 棵。
  // len 缺省按旧语义必睡（单测与未知栈深兜底走保守路径）。
  if (typeof len === 'number' && len < 3) return
  const e = store.stack.length ? store.stack[store.stack.length - 1] : null
  if (!e) return
  e.preNapped = true
  sleep(e.page)
  if (e.wakeTimer) clearTimeout(e.wakeTimer)
  e.wakeTimer = setTimeout(() => {
    e.wakeTimer = null
    if (store.stack[store.stack.length - 1] === e) {
      e.preNapped = false
      wake(e.page)
    }
  }, 1500)
}

function wakePrevious() {
  const e = store.stack.length ? store.stack[store.stack.length - 1] : null
  if (!e) return
  if (e.wakeTimer) {
    clearTimeout(e.wakeTimer)
    e.wakeTimer = null
  }
  e.preNapped = false
  wake(e.page)
}

function routeOf(page) {
  try {
    if (page && page.$page && page.$page.path) return String(page.$page.path)
  } catch (e) {}
  return ''
}

function paramsOf(page) {
  const out = {}
  const keys = (page && page.__bbParamKeys) || []
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    const v = page[k]
    if (v === undefined || typeof v === 'function') continue
    out[k] = v
  }
  return out
}

function snapshot(page) {
  if (!page) return null
  try {
    if (typeof page.snapshot === 'function') {
      const s = page.snapshot()
      return s && typeof s === 'object' ? s : null
    }
  } catch (e) {}
  const out = {}
  const keys = (page && page.__bbStateKeys) || []
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (k === 'awake' || k.charAt(0) === '_' || /timer/i.test(k)) continue
    const v = page[k]
    if (v === undefined || v === null || typeof v === 'function') continue
    try {
      const text = JSON.stringify(v)
      if (!text || text.length > 1024) continue
      out[k] = v
    } catch (e) {}
  }
  return out
}

function restore(page, state) {
  if (!page || !state || typeof state !== 'object') return
  try {
    if (typeof page.restore === 'function') {
      page.restore(state)
      return
    }
  } catch (e) {}
  const keys = Object.keys(state)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (k === 'awake' || k.charAt(0) === '_' || /timer/i.test(k)) continue
    try {
      if (page[k] !== undefined) page[k] = state[k]
    } catch (e) {}
  }
}

function show(page) {
  // 页面栈只保留「当前可见页」一个引用：
  // 旧页在 push 前已被 preNap 卸下 UI；这里立即释放对它的引用，
  // 避免 onDestroy 漏调时 registry 越积越大（Vela 的隐藏页 awake 更新也不处理）。
  for (let i = 0; i < store.stack.length; i++) {
    const old = store.stack[i]
    if (!old) continue
    if (old.wakeTimer) clearTimeout(old.wakeTimer)
  }
  const entry = {
    page: page,
    wakeTimer: null,
    preNapped: false,
    route: routeOf(page),
    params: paramsOf(page)
  }
  store.stack = [entry]
  wake(page)
  try {
    const ns = globalRoot.__bbNav
    if (ns && typeof ns.reconcile === 'function') ns.reconcile(entry.route)
  } catch (err) {}
}

function markBack() {
  store.lastBackAt = Date.now()
}

function destroy(page) {
  const e = find(page)
  if (!e) return
  if (e.wakeTimer) clearTimeout(e.wakeTimer)
  const i = store.stack.indexOf(e)
  if (i >= 0) store.stack.splice(i, 1)
  rebalance()
}

export default function life(options) {
  const opts = options || {}
  const stateHolder = opts.data && typeof opts.data === 'object' && !Array.isArray(opts.data)
    ? opts.data
    : opts.private && typeof opts.private === 'object' && !Array.isArray(opts.private)
      ? opts.private
      : null
  if (stateHolder) {
    if (stateHolder.awake === undefined) stateHolder.awake = true
  } else {
    opts.private = { awake: true }
  }
  const paramKeys = Object.keys(opts.protected || {})
  const stateKeys = stateHolder ? Object.keys(stateHolder) : ['awake']

  const origShow = opts.onShow
  const origDestroy = opts.onDestroy

  opts.onShow = function () {
    this.__bbParamKeys = paramKeys
    this.__bbStateKeys = stateKeys
    show(this)
    if (origShow) origShow.call(this)
    try {
      const ns = globalRoot.__bbNav
      const st = ns && typeof ns.takePending === 'function' ? ns.takePending(routeOf(this)) : null
      if (st !== null && st !== undefined) restore(this, st)
    } catch (e) {}
    rebalance()
  }
  opts.onDestroy = function () {
    if (origDestroy) origDestroy.call(this)
    destroy(this)
  }

  if (!opts.onBackPress) {
    opts.onBackPress = function () {
      try {
        const path = routeOf(this)
        if (path === '/pages/home') return false
        const bb = globalRoot.__bb
        if (!bb || !bb.router || typeof bb.router.back !== 'function') return false
        const lenBefore = typeof bb.router.length === 'function' ? bb.router.length() : 0
        if (lenBefore <= 1) return false
        if (bb.kv && typeof bb.kv.get === 'function' && bb.kv.get('navBackPress', 1) === 0) return false
        const now = Date.now()
        if (now - store.lastBackAt < 400) return true
        store.lastBackAt = now
        const page = this
        // 返回 true 后系统不应再执行默认返回；但不同 Vela 版本对返回值语义不完全一致。
        // 延后一拍再真正 back：若系统仍把页面弹掉了（$valid=false / 栈深变小），就跳过，
        // 避免「自定义 back + 系统默认 back」双弹。
        setTimeout(() => {
          try {
            if (!page.$valid) return
            if (typeof bb.router.length === 'function' && bb.router.length() < lenBefore) return
            bb.router.back()
          } catch (e) {}
        }, 0)
        return true
      } catch (e) {
        return false
      }
    }
  }
  return opts
}

function currentFrame() {
  const e = store.stack.length ? store.stack[store.stack.length - 1] : null
  if (!e) return null
  return { page: e.page, route: e.route, params: e.params || {} }
}

function snapshotCurrent() {
  const f = currentFrame()
  return f ? snapshot(f.page) : null
}

export { rebalance, markBack, preNap, wakePrevious, currentFrame, snapshotCurrent, snapshot, restore }