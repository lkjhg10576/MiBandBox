/**
 * 屏幕高亮工具：需要「调亮度 + 常亮」的页面（荧光棒 / 红光手电 / 快捷色卡 / 桌面伴侣）统一走这里。
 *
 * enter(opts) 可用 { bright, keepOn, value } 三个开关：
 *   bright（默认 true）= 保存原亮度/模式 → 切手动模式并设到 value，
 *     400ms 后补设一次，防止自动亮度回压；
 *   keepOn（默认 true）= 阻止自动熄屏；
 *   value（默认 255，范围 0..255）= 目标亮度。旧调用方不传 → 行为与改动前逐字一致。
 * 离开时恢复原状态：
 *   若进入前为系统自动亮度（mode === 1），退出时只恢复自动模式，切勿调用 setValue，
 *   避免因自动模式下读到的伪 0 值导致屏幕瞬间骤降至最暗再拉回；
 *   若进入前为手动模式，退出时恢复保存的手动亮度值。
 *
 * 跨页会话归属（2026-11-19 起，桌面伴侣用）：
 *   hold(opts, who)     —— 进入/续期高亮会话并登记归属。已在高亮会话内时只改目标值与常亮标志，
 *                          不重新保存「原亮度」（否则会把上一页的亮值当成原状态存下来）。
 *   releaseSoon(who)    —— 只有当前归属者才有资格延迟释放；500ms 后再核一次归属才 leave()。
 *   为什么需要归属令牌 + 延迟：Vela 不保证旧页 onHide 早于新页 onShow。旧页先隐藏时若立刻
 *   leave()，新页 onShow 再 enter() 会经历「退出→恢复原亮度→再拉满」的可见骤降，且 getMode
 *   的异步回调会在 setMode(0) 之后才返回，把原自动亮度误存成手动（见 enter 里的历史注释）。
 *   归属令牌让两种时序都正确：后到的 hold 抢走归属并取消待执行的释放。
 *
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
// 当前高亮会话的目标亮度（0..255）。旧调用方不传 value，默认 255，行为不变；
// 桌面伴侣按档位传入，且同一会话内可以改（所以 400ms 补设必须读实时值，不能捕旧值）。
let target = 255
// 会话归属令牌：null = 无归属（普通 enter/leave 调用方）
let owner = null
let releaseTimer = null

function normalizeValue(v) {
  const n = Number(v)
  if (!(n >= 0 && n <= 255)) return 255
  return Math.round(n)
}

/** 设到当前 target：enter / hold / 400ms 补设都走这里，永远用实时值 */
function applyValue() {
  try {
    brightness.setValue({ value: target, success: () => {}, fail: () => {} })
  } catch (e) {}
}

/** 系统亮度调度的回压有延迟，400ms 后再按实时目标补设一次 */
function rearmRetry() {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    retryTimer = null
    if (active && brightOn) applyValue()
  }, 400)
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
  target = normalizeValue(o.value)
  // 新会话开始：清掉可能残留的延迟释放与归属（旧页 onHide 排的队不应影响新会话）
  if (releaseTimer) {
    clearTimeout(releaseTimer)
    releaseTimer = null
  }
  owner = null

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
                    if (active && brightOn) applyValue()
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

    applyValue()
    rearmRetry()
  }

  if (keepOnOn) {
    try {
      brightness.setKeepScreenOn({ keepScreenOn: true, success: () => {}, fail: () => {} })
    } catch (e) {}
  }
}

export function leave() {
  // 释放相关的簿记先清：即便当前不在会话内，残留的定时器/归属也不该跨页存活
  if (releaseTimer) {
    clearTimeout(releaseTimer)
    releaseTimer = null
  }
  owner = null
  // 目标亮度必须复位：否则 Companion 的暗值会泄漏进红光手电（手电不再最亮）
  target = 255
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

/**
 * 进入 / 续期高亮会话，并把归属登记为 who。
 * @param {{value?:number, keepOn?:boolean}} opts 目标亮度与常亮；bright 恒为 true
 * @param {string} who 归属令牌（页面自己约定的字符串）
 */
export function hold(opts, who) {
  const o = opts || {}
  if (releaseTimer) {
    clearTimeout(releaseTimer)
    releaseTimer = null
  }
  owner = who || null

  const value = normalizeValue(o.value)
  const keep = o.keepOn !== false

  // 冷路径：还没开高亮会话 —— 走完整 enter（保存原亮度/模式、切手动防回压、武装补设）
  if (!active) {
    enter({ bright: true, keepOn: keep, value })
    // enter 会清空归属，这里补回（冷路径的调用方才是当前会话主人）
    owner = who || null
    return
  }

  // 热路径：同一会话内换页 / 换档位。不重新保存原亮度（saved/savedMode 保持首次进入时的值），
  // 只改目标值并立即应用；常亮变化时同步开关与标志（leave() 靠 keepOnOn 决定是否关常亮，
  // 漏更新会导致退出后常亮永久开着）。
  brightOn = true
  target = value
  applyValue()
  rearmRetry()
  if (keep !== keepOnOn) {
    keepOnOn = keep
    try {
      brightness.setKeepScreenOn({ keepScreenOn: keep, success: () => {}, fail: () => {} })
    } catch (e) {}
  }
}

/**
 * 延迟释放高亮会话：只有当前归属者调用才生效，500ms 后再核一次归属才真正 leave()。
 * 新页在这 500ms 内 hold() 会抢走归属并取消释放。
 */
export function releaseSoon(who) {
  if (who !== owner) return
  if (releaseTimer) clearTimeout(releaseTimer)
  releaseTimer = setTimeout(() => {
    releaseTimer = null
    if (who !== owner) return
    leave()
  }, 500)
}

export default { enter, leave, hold, releaseSoon }