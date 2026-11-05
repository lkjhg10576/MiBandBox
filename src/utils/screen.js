/**
 * 屏幕高亮工具：需要“最亮 + 常亮”的页面（荧光棒/红光手电）统一走这里。
 * enter(opts) 可用 { bright, keepOn } 两个开关单独控制：
 *   bright（默认 true）= 保存原亮度/模式 → 切手动模式拉满 255（400ms 后补设一次，
 *     防止自动亮度回压）；keepOn（默认 true）= 阻止自动熄屏。
 * 离开时只恢复实际设置过的项。各步骤全部静默降级，失败不阻塞页面。
 */
import brightness from '@system.brightness'

let saved = -1
let savedMode = -1
let active = false
let brightOn = false
let keepOnOn = false
let retryTimer = null

function setMax() {
  try {
    brightness.setValue({ value: 255, success: () => {}, fail: () => {} })
  } catch (e) {}
}

export function enter(opts) {
  const o = opts || {}
  if (active) return
  active = true
  brightOn = o.bright !== false
  keepOnOn = o.keepOn !== false
  if (brightOn) {
    try {
      brightness.getValue({
        success: (res) => {
          if (active) saved = typeof res.value === 'number' ? res.value : -1
        },
        fail: () => {}
      })
    } catch (e) {}
    // 自动亮度会把 setValue 压回去：先记原模式并切手动模式（API 缺失/失败则静默跳过）
    try {
      if (typeof brightness.getMode === 'function') {
        brightness.getMode({
          success: (res) => {
            if (active) savedMode = typeof res.mode === 'number' ? res.mode : -1
          },
          fail: () => {}
        })
      }
    } catch (e) {}
    try {
      if (typeof brightness.setMode === 'function') {
        brightness.setMode({ mode: 0, success: () => {}, fail: () => {} })
      }
    } catch (e) {}
    setMax()
    // 系统亮度调度的回压有延迟，稍后补一次
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (active && brightOn) setMax()
    }, 400)
  }
  if (keepOnOn) {
    try {
      brightness.setKeepScreenOn({ keepScreenOn: true, success: () => {}, fail: () => {} })
    } catch (e) {}
  }
}

export function leave() {
  if (!active) return
  active = false
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  try {
    if (keepOnOn) brightness.setKeepScreenOn({ keepScreenOn: false, success: () => {}, fail: () => {} })
    if (brightOn && saved >= 0) brightness.setValue({ value: saved, success: () => {}, fail: () => {} })
    if (brightOn && savedMode > 0 && typeof brightness.setMode === 'function') {
      brightness.setMode({ mode: savedMode, success: () => {}, fail: () => {} })
    }
  } catch (e) {}
  saved = -1
  savedMode = -1
  brightOn = false
  keepOnOn = false
}

export default { enter, leave }
