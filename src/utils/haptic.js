/**
 * 触觉反馈：短振/长振/节奏，以及节拍类工具用的两档力度（弱/强）。设备不支持时静默降级。
 *
 * 平台限制（小米 Vela JS 快应用 @system.vibrator）：
 *   - 没有「振幅 / 强度」参数，vibrate 只认 mode: 'short' | 'long'；
 *   - start({duration, interval, count})、stop(id)、getSystemDefaultMode() 只有 Xiaomi Watch S5 支持；
 *   - 其余机型（手环 8/9/10、Redmi Watch 4/5/6、Watch S3/S4 等）只有短振与长振两种波形。
 * 所以「力度」只能靠脉冲波形/时长表达：短振轻、长振重。
 *
 * 两档定义（不加中间档：弱强两档与设备能力一一对应，够用且不会做不出中间手感）：
 *   弱   一次短振
 *   强   一次长振
 */
import vibrator from '@system.vibrator'

/** 两档力度：label 中文名；mode 通用机型波形；duration/count 是 S5 定长脉冲参数 */
export const LEVELS = {
  weak: { label: '弱', mode: 'short', duration: 45, count: 1 },
  strong: { label: '强', mode: 'long', duration: 300, count: 1 }
}

/** 力度档位顺序（弱 → 强），界面按这个顺序摆 */
export const LEVEL_ORDER = ['weak', 'strong']

/** 强弱以外的取值一律按强档处理（与节拍器默认档位一致） */
const DEFAULT_LEVEL = 'strong'

let timers = []

function clearTimers() {
  timers.forEach((t) => clearTimeout(t))
  timers = []
}

/** 延时执行：句柄登记在 timers 里，stop() 时一并取消；触发后自己出队，不让数组无限增长 */
function later(fn, ms) {
  const t = setTimeout(() => {
    const i = timers.indexOf(t)
    if (i >= 0) timers.splice(i, 1)
    fn()
  }, ms)
  timers.push(t)
}

function vibrateMode(mode) {
  try {
    vibrator.vibrate({ mode: mode })
  } catch (e) {}
}

function short() {
  vibrateMode('short')
}

function long() {
  vibrateMode('long')
}

/** S5 专属的定长脉冲任务句柄 */
let taskId = 0

/**
 * 能力探测：start/stop 与 getSystemDefaultMode 在官方支持表里同属 Watch S5 一组，
 * 用后者的存在性做无副作用的探测——不支持的机型不会误调 start 而丢掉这一拍。
 */
function canStart() {
  return !!(
    vibrator &&
    typeof vibrator.start === 'function' &&
    typeof vibrator.getSystemDefaultMode === 'function'
  )
}

/** 停掉上一次还没播完的定长脉冲，避免下一拍被 205「任务已存在」挡掉 */
function cancelTask() {
  if (!taskId) return
  try {
    vibrator.stop(taskId)
  } catch (e) {}
  taskId = 0
}

/** 定长脉冲；抛异常说明这台机器不支持，已由调用方降级 */
function startPulse(duration, count) {
  try {
    vibrator.start({
      duration: duration,
      interval: 90,
      count: count,
      success: function (data) {
        if (data && data.id) taskId = data.id
      },
      fail: function () {
        taskId = 0
      }
    })
    return true
  } catch (e) {
    taskId = 0
    return false
  }
}

/**
 * 节拍 / 打点用的力度脉冲。
 *
 * @param {string} [level] 'weak' | 'strong'，非法值按强档处理
 */
function beat(level) {
  const key = LEVELS[level] ? level : DEFAULT_LEVEL
  const lv = LEVELS[key]

  // S5：定长脉冲，脉冲时长直接对应力度
  if (canStart()) {
    cancelTask()
    if (startPulse(lv.duration, lv.count)) return
  }

  // 通用机型：弱=短振，强=长振
  vibrateMode(lv.mode)
}

/** 档位中文名，界面直接显示 */
function label(level) {
  return LEVELS[level] ? LEVELS[level].label : LEVELS[DEFAULT_LEVEL].label
}

function pattern(count, gap, mode) {
  clearTimers()
  const n = Math.max(1, Math.min(12, count || 1))
  for (let i = 0; i < n; i++) {
    later(function () {
      if (mode === 'long') long()
      else short()
    }, i * (gap || 250))
  }
}

function stop() {
  clearTimers()
  cancelTask()
}

export default { short, long, pattern, stop, beat, label, LEVELS, LEVEL_ORDER }
