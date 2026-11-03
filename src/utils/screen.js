/**
 * 屏幕高亮工具：需要“最亮 + 常亮”的页面（荧光棒/红光手电）统一走这里。
 * 进入时保存原亮度 → 手动模式拉满 255 → 常亮；离开时恢复原亮度与自动模式。
 * 各步骤全部静默降级，失败不阻塞页面。
 */
import brightness from '@system.brightness'

let saved = -1
let active = false

export function enter() {
  if (active) return
  active = true
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
    brightness.setKeepScreenOn({ keepScreenOn: true, success: () => {}, fail: () => {} })
  } catch (e) {}
}

export function leave() {
  if (!active) return
  active = false
  try {
    brightness.setKeepScreenOn({ keepScreenOn: false, success: () => {}, fail: () => {} })
    if (saved >= 0) brightness.setValue({ value: saved, success: () => {}, fail: () => {} })
  } catch (e) {}
  saved = -1
}

export default { enter, leave }
