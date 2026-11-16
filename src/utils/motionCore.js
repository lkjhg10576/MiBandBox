/**
 * 体感内核（一）：重力估计 + 动态加速度 + 就绪姿态判定。
 *
 * 纯 JS、零 @system.* 依赖，Node 可直接 import 单测（tools/test-motion-core.mjs）。
 *
 * 三块能力：
 *   1) 低通重力：g = EMA(raw)，时间常数按 dt 计算，20ms（game）/ 60ms（ui）采样都准。
 *   2) 动态加速度：dyn = raw − g，扣掉重力后的「动作」分量。
 *   3) 就绪姿态判定：重力方向落在目标轴附近（绝对姿态）并保持一段时间 → 就绪（raised）。
 *
 * 为什么用「绝对姿态」而不是「相对垂手基线的夹角」：
 *   相对基线只算夹角、不算转轴 —— 从垂手出发，「举枪」与「手平放屏幕朝上」都是转 90°，
 *   两个都能过阈值（平放误就绪）。而且基线在未就绪时以 1.5s 时间常数跟着当前姿态跑：
 *   投完一球手臂放下 → 基线被拖到「持球/收手」姿态 → 参考系整个变了，原本的就绪姿态
 *   不再越限，反倒是「平放」离新基线 90° 才就绪。
 *   改成绝对姿态后：姿态由「重力落在哪个轴」唯一确定 —— 平放（重力沿屏幕法线 z）
 *   一律不就绪；也没有会漂移的参考系，进页面不用先垂手。
 *
 * 绝对判定的唯一前提是「轴 ↔ 姿态」的映射要对。映射定义在 motionGun / motionHoop 的
 * POSE 常量里（枪 = y 轴、投篮 = +x 轴），真机实测不符时只改那两处，判定数学不动。
 *
 * 所有时间窗口都按时间戳算（不是采样点数），所以订阅 interval 换成 ui 也一样准。
 */

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180

/** 默认参数：阈值初值，真机上手感不对时只改这里（页面不改） */
export const DEFAULTS = {
  gravityTauMs: 120,   // 重力低通时间常数：越大越稳、越迟钝
  poseAxis: 'y',       // 就绪姿态判定轴：'x' 或 'y'（z 是屏幕法线 —— 平放时重力在这轴上）
  poseSign: 0,         // 0 = 正负都认；1 = 只认正；-1 = 只认负
  poseEnterDeg: 45,    // 进入角：重力与目标轴夹角 ≤ (90 − enterDeg)° 才算进入就绪
  poseExitDeg: 30,     // 退出角（迟滞，防抖）：夹角 ≥ (90 − exitDeg)° 才退出
  dwellMs: 250,        // 姿态越界后需保持的时长
  steadyTauMs: 160,    // 平稳度 EMA 时间常数
  steadyMag: 2.0,      // 动态幅值低于此值算「稳」
  gMinMag: 4.0         // 重力估算低于此值时方向不可信，保持上一次可靠方向
}

/** 单位向量夹角（度） */
export function angleBetween(a, b) {
  const la = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
  const lb = Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z)
  if (la < 1e-6 || lb < 1e-6) return 0
  let d = (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb)
  if (d < -1) d = -1
  else if (d > 1) d = 1
  return Math.acos(d) * RAD2DEG
}

function normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  if (len < 1e-6) return null
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

/** 角度夹到 0~90：sin 在这区间单调递增，判定阈值才有意义 */
function clampDeg(d) {
  const v = Number(d)
  if (!isFinite(v)) return 45
  return Math.max(0, Math.min(90, v))
}

/**
 * 创建一个体感内核实例。
 *
 * @param {object} [opts] 覆盖 DEFAULTS 的参数
 * @returns {{
 *   feed: function(number, number, number, number=): object,
 *   state: function(): object
 * }}
 */
export function createMotionCore(opts) {
  const o = Object.assign({}, DEFAULTS, opts || {})

  // 姿态轴与符号：非法值一律回落默认（y 轴、正负都认）
  const poseAxis = o.poseAxis === 'x' ? 'x' : 'y'
  const poseSign = o.poseSign === 1 ? 1 : o.poseSign === -1 ? -1 : 0
  // comp ≥ sin(enterDeg) ⟺ 重力与目标轴夹角 ≤ (90 − enterDeg)°
  // comp ≤ sin(exitDeg)  ⟺ 重力与目标轴夹角 ≥ (90 − exitDeg)°
  const enterComp = Math.sin(clampDeg(o.poseEnterDeg) * DEG2RAD)
  const exitComp = Math.sin(clampDeg(o.poseExitDeg) * DEG2RAD)

  let inited = false
  let gx = 0, gy = 0, gz = 0        // 重力低通结果
  let lastT = null
  let autoT = 0                     // 无时间戳时的自增时钟

  let raised = false
  let raiseSince = null
  let lowerSince = null
  let dynEma = 0
  let steady = true

  // 重力方向：只在 |g| 足够大时更新。急加速（扣扳机 / 起跳）会把滞后的重力估算
  // 拖到接近 0，此时方向不可信，保持上一次可靠方向 —— 否则向上分量会翻符号。
  let gDirX = 0, gDirY = 1, gDirZ = 0

  /**
   * 喂入一个加速度采样（单位 m/s²，含重力）。
   *
   * @param {number} x @param {number} y @param {number} z
   * @param {number} [t] 毫秒时间戳（同一单调时钟）
   * @returns {{dynMag:number, upMag:number, rawMag:number, steady:boolean,
   *            raised:boolean, pitch:number, roll:number, gravity:number}}
   */
  function feed(x, y, z, t) {
    let now
    if (typeof t === 'number' && isFinite(t)) {
      now = t
    } else {
      now = lastT === null ? 0 : lastT + 20
    }
    const dt = lastT === null ? 20 : Math.max(1, Math.min(200, now - lastT))
    lastT = now
    autoT = now

    const rawX = Number(x) || 0
    const rawY = Number(y) || 0
    const rawZ = Number(z) || 0

    // ---- 1) 重力低通 ----
    if (!inited) {
      gx = rawX; gy = rawY; gz = rawZ
      inited = true
      // 首个采样就是最好的姿态估计（此刻通常静止）
      const u0 = normalize({ x: rawX, y: rawY, z: rawZ })
      if (u0) {
        gDirX = u0.x
        gDirY = u0.y
        gDirZ = u0.z
      }
    } else {
      const a = 1 - Math.exp(-dt / o.gravityTauMs)
      gx += (rawX - gx) * a
      gy += (rawY - gy) * a
      gz += (rawZ - gz) * a
    }

    // ---- 2) 动态加速度 ----
    const dx = rawX - gx
    const dy = rawY - gy
    const dz = rawZ - gz
    const dynMag = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const gLen = Math.sqrt(gx * gx + gy * gy + gz * gz)
    // rawMag：原始加速度模长。动作停止时它会立刻回到 9.8 附近（重力），
    // 比「动态分量回落」快得多 —— 投篮收手用它判「手停住了」。
    const rawMag = Math.sqrt(rawX * rawX + rawY * rawY + rawZ * rawZ)

    // 可靠的重力方向：
    //   1) |g| 太小时（急加速把滞后估算拖到接近 0）方向不可信，保持上一次；
    //   2) 候选方向与上次可靠方向夹角超过 90° —— 真实手腕不可能在 20ms 内转过 90°，
    //      这种突变是「零点穿越」造成的假翻转，丢弃。
    if (gLen >= o.gMinMag) {
      const u = normalize({ x: gx, y: gy, z: gz })
      if (u) {
        const dot = u.x * gDirX + u.y * gDirY + u.z * gDirZ
        if (dot > 0) {
          gDirX = u.x
          gDirY = u.y
          gDirZ = u.z
        }
      }
    }
    // upMag：动态加速度在「反重力」方向上的分量（>0 表示在往上加速，单位 m/s²）
    const upMag = -(dx * gDirX + dy * gDirY + dz * gDirZ)

    const sa = 1 - Math.exp(-dt / o.steadyTauMs)
    dynEma += (dynMag - dynEma) * sa
    steady = dynEma < o.steadyMag

    // ---- 3) 就绪姿态判定（绝对姿态，带迟滞与驻留） ----
    // comp = 重力在目标轴上的分量。poseSign=0 取绝对值 → 左右手都认同一个姿态。
    // 用分量而不是直接比 atan2 角度：屏幕朝下时 atan2 会绕到 ±180°，会假越限。
    const axisComp = poseAxis === 'x' ? gDirX : gDirY
    const comp = poseSign === 0 ? Math.abs(axisComp) : poseSign * axisComp
    if (!raised) {
      if (comp >= enterComp) {
        if (raiseSince === null) raiseSince = now
        else if (now - raiseSince >= o.dwellMs) {
          raised = true
          raiseSince = null
          lowerSince = null
        }
      } else {
        raiseSince = null
      }
    } else {
      if (comp <= exitComp) {
        if (lowerSince === null) lowerSince = now
        else if (now - lowerSince >= o.dwellMs) {
          raised = false
          lowerSince = null
          raiseSince = null
        }
      } else {
        lowerSince = null
      }
    }

    return {
      dynMag: dynMag,
      upMag: upMag,
      rawMag: rawMag,
      steady: steady,
      raised: raised,
      // 姿态角（与 level.ux 同一公式），真机排查时对着水平仪看
      pitch: Math.atan2(gDirY, gDirZ) * RAD2DEG,
      roll: Math.atan2(gDirX, gDirZ) * RAD2DEG,
      gravity: gLen
    }
  }

  function state() {
    return {
      raised: raised,
      steady: steady,
      dynEma: dynEma,
      gravity: Math.sqrt(gx * gx + gy * gy + gz * gz),
      clock: autoT
    }
  }

  return { feed: feed, state: state }
}

export default { createMotionCore, angleBetween, DEFAULTS }
