/**
 * 屏幕高亮工具：需要“最亮 + 常亮”的页面（荧光棒/红光手电）统一走这里。
 * enter(opts) 可用 { bright, keepOn } 两个开关单独控制：
 *   bright（默认 true）= 保存原亮度/模式 → 切手动模式拉满 255（400ms 后补设一次，
 *     防止自动亮度回压）；keepOn（默认 true）= 阻止自动熄屏。
 * 离开时恢复原状态：
 *   若进入前为系统自动亮度（mode === 1），退出时只恢复自动模式，切勿调用 setValue，
 *   避免因自动模式下读到的伪 0 值导致屏幕瞬间骤降至最暗再拉回；
 *   若进入前为手动模式，退出时恢复保存的手动亮度值。
 * 各步骤全部静默降级，失败不阻塞页面。
 */
import brightness from '@system.brightness'

let saved = -1
let savedMode = -1
let active = false
let brightOn = false
let keepOnOn = false
let retryTimer = null
let modePending = false

function setMax() {
  try {
    brightness.setValue({ value: 255, success: () => {}, fail: () => {} })
  } catch (e) {}
}

function normalizeMode(m) {
  if (m === 1 || m === '1' || m === true || m === 'auto') return 1
  if (m === 0 || m === '0' || m === false || m === 'manual') return 0
  return -1
}

function restoreBright(mode, val) {
  try {
    if (mode === 1 && typeof brightness.setMode === 'function') {
      // 原来是系统自动亮度：恢复自动亮度模式即可，绝不调 setValue(val)。
      // 避免自动模式下 val 为 0/极低值时导致屏幕瞬间跌落最暗再拉回。
      brightness.setMode({ mode: 1, success: () => {}, fail: () => {} })
    } else {
      // 原来是手动亮度（或不支持/未获取到 mode）：恢复原手动亮度值
      if (val >= 0) {
        brightness.setValue({ value: val, success: () => {}, fail: () => {} })
      }
      if (mode === 0 && typeof brightness.setMode === 'function') {
        brightness.setMode({ mode: 0, success: () => {}, fail: () => {} })
      }
    }
  } catch (e) {}
}

export function enter(opts) {
  const o = opts || {}
  if (active) return
  active = true
  brightOn = o.bright !== false
  keepOnOn = o.keepOn !== false

  if (brightOn) {
    saved = -1
    savedMode = -1

    try {
      brightness.getValue({
        success: (res) => {
          if (typeof res.value === 'number') {
            saved = res.value
          }
        },
        fail: () => {}
      })
    } catch (e) {}

    // 自动亮度会把 setValue 压回去：先查原模式。
    // 注意：绝不能在 getMode 返回前同步调 setMode(0)，否则会污染 getMode 读出的原模式，
    // 也会导致退出时无法判断原系统是自动亮度。
    if (typeof brightness.getMode === 'function') {
      modePending = true
      try {
        brightness.getMode({
          success: (res) => {
            modePending = false
            const m = normalizeMode(res.mode)
            savedMode = m
            if (active) {
              // 仍处于高亮页：原先是自动模式时切手动模式防回压
              if (m === 1 && typeof brightness.setMode === 'function') {
                brightness.setMode({
                  mode: 0,
                  success: () => {
                    if (active && brightOn) setMax()
                  },
                  fail: () => {}
                })
              }
            } else {
              // 在 getMode 返回前页面已退出：在此处补执行恢复
              restoreBright(savedMode, saved)
              saved = -1
              savedMode = -1
            }
          },
          fail: () => {
            modePending = false
            if (!active) {
              restoreBright(-1, saved)
              saved = -1
              savedMode = -1
            } else if (typeof brightness.setMode === 'function') {
              brightness.setMode({ mode: 0, success: () => {}, fail: () => {} })
            }
          }
        })
      } catch (e) {
        modePending = false
      }
    } else if (typeof brightness.setMode === 'function') {
      try {
        brightness.setMode({ mode: 0, success: () => {}, fail: () => {} })
      } catch (e) {}
    }

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
    if (keepOnOn) {
      brightness.setKeepScreenOn({ keepScreenOn: false, success: () => {}, fail: () => {} })
    }
  } catch (e) {}

  if (brightOn) {
    if (!modePending) {
      restoreBright(savedMode, saved)
      saved = -1
      savedMode = -1
    }
  }

  brightOn = false
  keepOnOn = false
}

export default { enter, leave }
