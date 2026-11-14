/**
 * 路由封装：统一错误兜底，避免页面出现死路。
 */
import router from '@system.router'

function push(uri, params) {
  try {
    router.push({ uri, params: params || {} })
  } catch (e) {}
}

function replace(uri, params) {
  try {
    router.replace({ uri, params: params || {} })
  } catch (e) {}
}

function back() {
  // 栈深=1 时（直接落到非首页的入口场景）router.back() 静默无响应，兜底回首页；
  // getLength 探测失败就退回普通 back，不影响原行为
  try {
    if (typeof router.getLength === 'function' && router.getLength() === 1) {
      home()
      return
    }
  } catch (e) {}
  try {
    router.back()
  } catch (e) {}
}

function home() {
  replace('/pages/home')
}

export default { push, replace, back, home }
