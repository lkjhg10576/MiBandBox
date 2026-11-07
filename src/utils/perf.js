/**
 * 性能埋点（仅本地 profiling 用，发行版必须保持关闭）
 *
 * 用法：
 *   import perf from '../utils/perf'
 *   perf.mark('home.show')
 *   perf.summary()   // 输出一行汇总，避免逐条日志被设备端 1KB 日志缓冲挤掉
 *
 * 埋点存在 global 上：app.ux 与各页面是独立 bundle，perf.js 各有一份副本，
 * 只有 global 能跨 bundle 共享同一份标记表。
 *
 * 输出格式：
 *   [perf] <name> t=<Date.now()>
 *   [perf] SUMMARY <name>=<ts> <name>=<ts> ...
 *
 * ⚠ 0.4.0 发行版把这个开关留在了 true，且首页 onReady 里还有一段
 * $element().getBoundingClientRect() 的 FMP 打点，两者都在「安装后第一次启动」
 * 的必经路径上；设备日志缓冲只有 1008 B，打点会持续挤占，也是真机上唯一
 * 会随每次启动执行的额外逻辑。0.4.1 起：默认关闭、启动路径不再打点，
 * tools/release-gate.mjs 会拦住误开的发行包。
 */
const ENABLED = false
const KEY = '__bbPerfMarks'

const g = typeof global !== 'undefined' ? global : typeof globalThis !== 'undefined' ? globalThis : {}
if (!g[KEY]) g[KEY] = {}

function mark(name) {
  if (!ENABLED) return
  const t = Date.now()
  g[KEY][name] = t
  try {
    console.log('[perf] ' + name + ' t=' + t)
  } catch (e) {}
}

function summary() {
  if (!ENABLED) return
  const m = g[KEY]
  const parts = []
  for (const k of Object.keys(m)) parts.push(k + '=' + m[k])
  try {
    console.log('[perf] SUMMARY ' + parts.join(' '))
  } catch (e) {}
}

function marks() {
  return g[KEY]
}

export default { mark, summary, marks }
