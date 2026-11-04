/**
 * 屏幕高亮工具：需要“最亮 + 常亮”的页面（荧光棒/红光手电）统一走这里。
 * enter(opts) 可用 { bright, keepOn } 两个开关单独控制：
 *   bright（默认 true）= 保存原亮度 → 手动模式拉满 255；
 *   keepOn（默认 true）= 阻止自动熄屏。
 * 离开时只恢复实际设置过的项。各步骤全部静默降级，失败不阻塞页面。
 */
import brightness from '@system.brightness'

let saved = -1
let active = false
let brightOn = false
let keepOnOn = false

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
          saved = typeof res.value === 'number' ? res.value : -1
        },
        fail: () => {}
      })
    } catch (e) {}
    try {
      brightness.setValue({ value: 255, success: () => {}, fail: () => {} })
    } catch (e) {}
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
  try {
    if (keepOnOn) brightness.setKeepScreenOn({ keepScreenOn: false, success: () => {}, fail: () => {} })
    if (brightOn && saved >= 0) brightness.setValue({ value: saved, success: () => {}, fail: () => {} })
  } catch (e) {}
  saved = -1
  brightOn = false
  keepOnOn = false
}

export default { enter, leave }
