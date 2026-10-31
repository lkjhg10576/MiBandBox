/**
 * 触觉反馈：短振/长振/节奏。设备不支持时静默降级。
 */
import vibrator from '@system.vibrator'

let timers = []

function clearTimers() {
  timers.forEach((t) => clearTimeout(t))
  timers = []
}

function short() {
  try {
    vibrator.vibrate({ mode: 'short' })
  } catch (e) {}
}

function long() {
  try {
    vibrator.vibrate({ mode: 'long' })
  } catch (e) {}
}

function pattern(count, gap, mode) {
  clearTimers()
  const n = Math.max(1, Math.min(12, count || 1))
  for (let i = 0; i < n; i++) {
    const t = setTimeout(() => {
      if (mode === 'long') long()
      else short()
    }, i * (gap || 250))
    timers.push(t)
  }
}

function stop() {
  clearTimers()
}

export default { short, long, pattern, stop }
