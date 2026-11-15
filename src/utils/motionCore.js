/**
 * 体感内核（一）：重力估计 + 动态加速度 + 举手 / 平稳判定。
 *
 * 纯 JS、零 @system.* 依赖，Node 可直接 import 单测（tools/test-motion-core.mjs）。
 *
 * 三块能力：
 *   1) 低通重力：g = EMA(raw)，时间常数按 dt 计算，20ms（game）/ 60ms（ui）采样都准。
 *   2) 动态加速度：dyn = raw − g，扣掉重力后的「动作」分量。
 *   3) 举手判定：以进入页面时的垂手姿态为基线，当前重力方向相对基线转过的夹角
 *      （raiseAngle）超过阈值并保持一段时间 → 举手（raised）。
 *
 * 为什么用「相对基线的夹角」而不是绝对姿态：
 *   同一块手环戴左手还是右手、屏幕朝内还是朝外，垂手时重力在设备坐标系里的方向
 *   都不一样，写死角度阈值必然有一半人用不了。基线在进入页面时自动采集，
 *   佩戴朝向自适应；进游戏前手臂自然下垂即可（页面有提示）。
 *
 * 所有时间窗口都按时间戳算（不是采样点数），所以订阅 interval 换成 ui 也一样准。
 */

const RAD2DEG = 180 / Math.PI

/** 默认参数：阈值初值，真机上手感不对时只改这里（页面不改） */
export const DEFAULTS = {
  gravityTauMs: 120,   // 重力低通时间常数：越大越稳、越迟钝
  baselineMs: 500,     // 垂手基线采集窗口
  raiseEnterDeg: 45,   // 举手判定进入角（相对垂手基线）
  raiseExitDeg: 30,    // 举手判定退出角（迟滞，防抖）
  dwellMs: 250,        // 角度越界后需保持的时长
  steadyTauMs: 160,    // 平稳度 EMA 时间常数
  steadyMag: 2.0,      // 动态幅值低于此值算「稳」
  baselineTauMs: 1500, // 未举手时基线跟随当前姿态的时间常数
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

/**
 * 创建一个体感内核实例。
 *
 * @param {object} [opts] 覆盖 DEFAULTS 的参数
 * @returns {{
 *   feed: function(number, number, number, number=): object,
 *   resetBaseline: function(): void,
 *   state: function(): object
 * }}
 */
export function createMotionCore(opts) {
  const o = Object.assign({}, DEFAULTS, opts || {})

  let inited = false
  let gx = 0, gy = 0, gz = 0        // 重力低通结果
  let lastT = null
  let autoT = 0                     // 无时间戳时的自增时钟

  let baseSumX = 0, baseSumY = 0, baseSumZ = 0
  let baseCount = 0
  let baseStartT = null
  let base = null                   // 垂手基线单位向量

  let raised = false
  let raiseSince = null
  let lowerSince = null
  let dynEma = 0

  // 重力方向：只在 |g| 足够大时更新。急加速（扣扳机 / 起跳）会把滞后的重力估算
  // 拖到接近 0，此时方向不可信，保持上一次可靠方向 —— 否则向上分量会翻符号。
  let gDirX = 0, gDirY = 1, gDirZ = 0

  /** 重新采集垂手基线（手臂回到自然下垂后再调一次即可） */
  function resetBaseline() {
    baseSumX = 0; baseSumY = 0; baseSumZ = 0
    baseCount = 0
    baseStartT = null
    base = null
    raised = false
    raiseSince = null
    lowerSince = null
  }

  /**
   * 喂入一个加速度采样（单位 m/s²，含重力）。
   *
   * @param {number} x @param {number} y @param {number} z
   * @param {number} [t] 毫秒时间戳（同一单调时钟）
   * @returns {{raiseAngle:number, dynMag:number, upMag:number, rawMag:number,
   *            steady:boolean, raised:boolean, baselineReady:boolean, gravity:number}}
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
    const steady = dynEma < o.steadyMag

    // ---- 3) 垂手基线 ----
    if (!base) {
      if (baseStartT === null) baseStartT = now
      baseSumX += rawX; baseSumY += rawY; baseSumZ += rawZ
      baseCount++
      if (now - baseStartT >= o.baselineMs) {
        base = normalize({ x: baseSumX / baseCount, y: baseSumY / baseCount, z: baseSumZ / baseCount })
      }
    }

    let raiseAngle = 0
    if (base) {
      raiseAngle = angleBetween({ x: gDirX, y: gDirY, z: gDirZ }, base)
    }

    // ---- 3.5) 基线自适应 ----
    // 还没举手、且设备安静时，基线缓慢跟着当前姿态走：
    // 用户进游戏时手举着也没关系 —— 放下手、稳住，基线就落回垂手姿态，之后抬手能认出来。
    // 抬手动作本身是「大幅运动」，dynEma 远大于阈值，所以抬手期间基线不会跟着跑。
    if (base && !raised && dynEma < o.steadyMag) {
      const ba = 1 - Math.exp(-dt / o.baselineTauMs)
      const nx = base.x + (gDirX - base.x) * ba
      const ny = base.y + (gDirY - base.y) * ba
      const nz = base.z + (gDirZ - base.z) * ba
      const nb = normalize({ x: nx, y: ny, z: nz })
      if (nb) base = nb
    }

    // ---- 4) 举手判定（带迟滞与驻留） ----
    if (!base) {
      // 基线还没采完，不做判定
      raised = false
    } else if (!raised) {
      if (raiseAngle >= o.raiseEnterDeg) {
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
      if (raiseAngle <= o.raiseExitDeg) {
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
      raiseAngle: raiseAngle,
      dynMag: dynMag,
      upMag: upMag,
      rawMag: rawMag,
      steady: steady,
      raised: raised,
      baselineReady: !!base,
      gravity: gLen
    }
  }

  function state() {
    return {
      raised: raised,
      steady: steady,
      baselineReady: !!base,
      dynEma: dynEma,
      gravity: Math.sqrt(gx * gx + gy * gy + gz * gz),
      clock: autoT
    }
  }

  return { feed: feed, resetBaseline: resetBaseline, state: state }
}

export default { createMotionCore, angleBetween, DEFAULTS }
