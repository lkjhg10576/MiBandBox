/**
 * 性能埋点（L0 起使用，埋点日志用于分析冷启动 FMP）
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
 * 发布前把 ENABLED 改成 false 即可完全关闭（单行开关，埋点开销归零）。
 */
const ENABLED = true
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
