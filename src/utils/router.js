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
  try {
    router.back()
  } catch (e) {}
}

function home() {
  replace('/pages/home')
}

export default { push, replace, back, home }
