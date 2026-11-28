/**
 * 路由封装：统一错误兜底，避免页面出现死路；限制页面栈最大深度，防止深链残留。
 *
 * 深栈（>= MAX_STACK）不再直接丢掉父页：pageLife 抓一份状态胶囊进 navStore，
 * 父页从物理栈销毁但保留在虚拟帧栈里；back() 时用 replace 重建并还原。
 * 正常栈深仍走 router.push/back，返回语义与改造前一致。
 */
import router from '@system.router'
import { rebalance, markBack, preNap, wakePrevious, currentFrame, snapshotCurrent } from './pageLife'
import navStore from './navStore'

const MAX_STACK = 5

if (typeof globalThis !== 'undefined') globalThis.__bbNav = navStore

function rawReplace(uri, params) {
  try {
    router.replace({ uri, params: params || {} })
  } catch (e) {}
}

function push(uri, params) {
  let len = 1
  try {
    if (typeof router.getLength === 'function') len = router.getLength()
  } catch (e) {}

  if (len >= MAX_STACK) {
    const frame = currentFrame()
    const state = frame ? snapshotCurrent() : null
    try {
      navStore.freezeCurrent(state)
    } catch (e) {}
    try {
      navStore.pushFrame(uri, params)
      rawReplace(uri, params)
    } catch (e) {
      navStore.popFrame()
    }
    rebalance()
    return
  }

  navStore.pushFrame(uri, params)
  // 传原生栈深：栈深 <3 不睡，首页/一级页保持 UI 树，返回免整树重建
  //（真机重建比返回转场慢，会先黑屏一瞬再亮起——2026-11-28 报障）
  preNap(len)
  try {
    router.push({ uri, params: params || {} })
  } catch (e) {
    navStore.popFrame()
    wakePrevious()
  }
  rebalance()
}

function replace(uri, params) {
  navStore.replaceFrame(uri, params)
  rawReplace(uri, params)
  rebalance()
}

function back() {
  markBack()
  // 栈深=1 时（直接落到非首页的入口场景）router.back() 静默无响应，兜底回首页；
  // getLength 探测失败就退回普通 back，不影响原行为
  let len = 0
  try {
    if (typeof router.getLength === 'function') len = router.getLength()
  } catch (e) {}
  if (len === 1) {
    home()
    return
  }

  const parent = navStore.previous()
  if (parent && parent.frozen) {
    navStore.setPending(parent)
    navStore.popFrame()
    navStore.thaw(parent)
    rawReplace(parent.route, parent.params)
    rebalance()
    return
  }

  navStore.popFrame()
  try {
    router.back()
  } catch (e) {}
  rebalance()
}

function home() {
  navStore.reset('/pages/home')
  rawReplace('/pages/home')
  rebalance()
}

function length() {
  try {
    if (typeof router.getLength === 'function') return router.getLength()
  } catch (e) {}
  return 1
}

export default { push, replace, back, home, length }