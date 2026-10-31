/**
 * 应用级布局接口兼容层。
 * 不同 Vela 版本可能把 app.ux 暴露的方法挂在 $app，也可能只挂在 $app.$def。
 */
function api(page) {
  const app = page && page.$app
  if (!app) return null
  if (typeof app.getHomeLayout === 'function') return app
  if (app.$def && typeof app.$def.getHomeLayout === 'function') return app.$def
  return null
}

export default { api }
