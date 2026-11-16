/**
 * 魔方计时触发内核：平放待命 → 翻腕起表 → 再平放收表。
 *
 * 纯 JS、零 @system.* 依赖，Node 可直接 import 单测（tools/test-cube-motion.mjs）。
 *
 * 交互对标魔方速拧计时带（Stackmat）：
 *   - 手平放（屏幕朝上）= 待命，不触发；
 *   - 手不再平放（随佩戴手腕不同，屏幕朝左或朝右）= 起表；
 *   - 手重新恢复平放 = 收表。
 *
 * 三个关键设计：
 *   1) 基线相对判定：起表/收表都看「当前重力方向 vs 平放基线」的夹角，
 *      不写死「朝左 / 朝右」，左手右手、屏幕朝内朝外都自适应。
 *   2) 基线必须「真的平放」才采：重力需沿屏幕法轴（|z| ≥ flatCos·|g|），
 *      否则一直等 —— 点「准备」时若手正握着魔方（没平放），不会拿错姿态当基准。
 *      基线**固定不跟随**：慢速翻腕时若基线跟着走，就永远触发不了。
 *   3) 起止时刻回溯：夹角越限后还要「驻留」一段时间才确认触发（防抖），
 *      但记成绩用的是**首次越限那一刻**的时间戳 —— 驻留只做确认，
 *      不吃掉用户的反应时间，也不让成绩虚高。
 *
 * 坐标约定与 motionCore 一致：z 轴是屏幕法线（level.ux 已验证：放平时 x≈0、y≈0、|z|≈g）。
 */

// 夹角计算直接复用体感内核的实现，不另写一份
import { angleBetween } from './motionCore.js'

/** 默认参数：真机上手感不对时只改这里（页面不改） */
export const DEFAULTS = {
  gravityTauMs: 120,   // 重力低通时间常数：越大越稳、越迟钝
  baselineMs: 400,     // 平放基线采集窗口（需平稳采样累计满这么久）
  flatCos: 0.75,       // 平放判据：|基线.z| ≥ flatCos（0.75 ≈ 偏离屏幕法轴 41° 内）
  enterDeg: 45,        // 起表角：偏离平放基线超过这个角度算「手不再平放」
  exitDeg: 25,         // 收表角（迟滞，防抖）：回到这个角度内算「手又平放了」
  startDwellMs: 100,   // 起表驻留：越限后需保持这么久才确认
  stopDwellMs: 280,    // 收表驻留：解拧时手腕会扫过平放姿态，驻留用来防误停
  steadyTauMs: 160,    // 平稳度 EMA 时间常数
  steadyMag: 2.0,      // 动态幅值低于此值算「稳」
  gMinMag: 4.0         // 重力估算低于此值时方向不可信，保持上一次可靠方向
}

/** 相位 */
export const PHASE = {
  IDLE: 'idle',        // 空闲：等用户点「准备」
  SETTLING: 'settling',// 采基线中：等手平放且静止
  ARMED: 'armed',      // 待命：基线已就绪，等翻腕起表
  RUNNING: 'running',  // 计时中
  DONE: 'done'         // 本次已结束
}

function normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  if (len < 1e-6) return null
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

/**
 * 创建一个魔方计时触发内核。
 *
 * @param {object} [opts] 覆盖 DEFAULTS 的参数
 * @returns {{
 *   feed: function(number, number, number, number=): object,
 *   arm: function(): boolean,
 *   abort: function(): void,
 *   manualStop: function(number=): object|null,
 *   state: function(): object
 * }}
 */
export function createCubeMotion(opts) {
  const o = Object.assign({}, DEFAULTS, opts || {})

  let phase = PHASE.IDLE

  let inited = false
  let gx = 0, gy = 0, gz = 0        // 重力低通结果
  let gDirX = 0, gDirY = 1, gDirZ = 0 // 可靠的重力方向（单位向量）
  let lastT = null

  let dynEma = 0
  let steady = true

  let base = null                    // 平放基线（单位向量）
  let baseSumX = 0, baseSumY = 0, baseSumZ = 0
  let baseCount = 0
  let baseStartT = null

  let angle = 0                      // 当前重力方向与基线的夹角（度）
  let startSince = null              // 首次越 enterDeg 的时间戳
  let stopSince = null               // 首次回到 exitDeg 内的时间戳
  let startT = null                  // 起表时刻（回溯后）
  let stopT = null                   // 收表时刻（回溯后）
  let elapsedMs = null               // 本次用时

  function resetBaseWindow() {
    baseSumX = 0; baseSumY = 0; baseSumZ = 0
    baseCount = 0
    baseStartT = null
  }

  /** 进入待命：开始采平放基线（仅 idle / done 可进入） */
  function arm() {
    if (phase !== PHASE.IDLE && phase !== PHASE.DONE) return false
    phase = PHASE.SETTLING
    base = null
    resetBaseWindow()
    startSince = null
    stopSince = null
    startT = null
    stopT = null
    elapsedMs = null
    return true
  }

  /** 放弃本次（取消 / 离页）：不产生成绩 */
  function abort() {
    phase = PHASE.IDLE
    base = null
    resetBaseWindow()
    startSince = null
    stopSince = null
    startT = null
    stopT = null
    elapsedMs = null
  }

  /**
   * 手动结束（兜底）：只在计时中有效。
   *
   * @param {number} [t] 毫秒时间戳，缺省由调用方传入当前时间
   */
  function manualStop(t) {
    if (phase !== PHASE.RUNNING) return null
    const now = (typeof t === 'number' && isFinite(t)) ? t : (lastT === null ? 0 : lastT)
    phase = PHASE.DONE
    stopT = now
    stopSince = null
    elapsedMs = stopT - startT
    return { type: 'stop', t: stopT, elapsed: elapsedMs }
  }

  /**
   * 喂入一个加速度采样（单位 m/s²，含重力）。
   *
   * @param {number} x @param {number} y @param {number} z
   * @param {number} [t] 毫秒时间戳（同一单调时钟）
   * @returns {{phase:string, t:number, angle:number, steady:boolean,
   *            baselineReady:boolean, gravity:number, events:Array}}
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

    const rawX = Number(x) || 0
    const rawY = Number(y) || 0
    const rawZ = Number(z) || 0

    // ---- 1) 重力低通 ----
    if (!inited) {
      gx = rawX; gy = rawY; gz = rawZ
      inited = true
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

    // ---- 2) 动态加速度与平稳度 ----
    const dx = rawX - gx
    const dy = rawY - gy
    const dz = rawZ - gz
    const dynMag = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const gLen = Math.sqrt(gx * gx + gy * gy + gz * gz)

    // 可靠的重力方向：|g| 太小时（急加速）方向不可信，保持上一次；
    // 与上次可靠方向夹角超过 90° 的突变是「零点穿越」造成的假翻转，丢弃。
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

    const sa = 1 - Math.exp(-dt / o.steadyTauMs)
    dynEma += (dynMag - dynEma) * sa
    steady = dynEma < o.steadyMag

    // ---- 3) 与平放基线的夹角 ----
    angle = base ? angleBetween({ x: gDirX, y: gDirY, z: gDirZ }, base) : 0

    const events = []

    // ---- 4) 相位机 ----
    if (phase === PHASE.SETTLING) {
      // 只在平稳时累计基线窗口；采样窗口内被扰动就重来
      if (!steady) {
        resetBaseWindow()
      } else {
        if (baseStartT === null) baseStartT = now
        baseSumX += rawX; baseSumY += rawY; baseSumZ += rawZ
        baseCount++
        if (now - baseStartT >= o.baselineMs) {
          const cand = normalize({
            x: baseSumX / baseCount,
            y: baseSumY / baseCount,
            z: baseSumZ / baseCount
          })
          // 平放判据：重力沿屏幕法轴（z 轴）。用 |z|，屏幕朝上/朝下都成立。
          if (cand && Math.abs(cand.z) >= o.flatCos) {
            base = cand
            phase = PHASE.ARMED
            events.push({ type: 'armed' })
          } else {
            // 没平放（比如手正握着魔方）：不当基准，继续等
            resetBaseWindow()
          }
        }
      }
    } else if (phase === PHASE.ARMED) {
      if (angle >= o.enterDeg) {
        if (startSince === null) {
          startSince = now
        } else if (now - startSince >= o.startDwellMs) {
          phase = PHASE.RUNNING
          startT = startSince   // 回溯到首次越限时刻
          startSince = null
          stopSince = null
          events.push({ type: 'start', t: startT })
        }
      } else {
        startSince = null
      }
    } else if (phase === PHASE.RUNNING) {
      if (angle <= o.exitDeg) {
        if (stopSince === null) {
          stopSince = now
        } else if (now - stopSince >= o.stopDwellMs) {
          phase = PHASE.DONE
          stopT = stopSince      // 回溯到首次回到平放的时刻
          stopSince = null
          elapsedMs = stopT - startT
          events.push({ type: 'stop', t: stopT, elapsed: elapsedMs })
        }
      } else {
        stopSince = null
      }
    }

    return {
      phase: phase,
      t: now,
      angle: angle,
      steady: steady,
      baselineReady: !!base,
      gravity: gLen,
      events: events
    }
  }

  function state() {
    return {
      phase: phase,
      angle: angle,
      steady: steady,
      baselineReady: !!base,
      startT: startT,
      stopT: stopT,
      elapsed: elapsedMs
    }
  }

  return { feed: feed, arm: arm, abort: abort, manualStop: manualStop, state: state }
}

export default { createCubeMotion, DEFAULTS, PHASE }
