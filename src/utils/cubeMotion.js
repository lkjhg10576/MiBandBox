/**
 * 魔方计时触发内核：两种起止模式。
 *
 * 纯 JS、零 @system.* 依赖，Node 可直接 import 单测（tools/test-cube-motion.mjs）。
 *
 * 模式一（默认，Stackmat 体感）：平放待命 → 翻腕起表 → 再平放收表。
 *   - 手平放（屏幕朝上）= 待命，不触发；
 *   - 手不再平放（随佩戴手腕不同，屏幕朝左或朝右）= 起表；
 *   - 手重新恢复平放 = 收表。
 *
 * 模式二（mode: 'countdown'，倒计时）：点屏幕 → 3 秒倒计时 → GO 起表 → 抬腕收表。
 *   - 点一下开始倒计时（COUNTDOWN 相位，起表点 = goAt 精确时刻，免疫定时器抖动）；
 *   - GO 与手部姿态无关（拿着魔方、任意姿势都起表）；
 *   - 解拧全程手腕怎么转都不触发；
 *   - 解完转腕「屏幕朝上」（抬腕看表）= 收表。绝对姿态判定（重力沿屏幕法轴），
 *     没有待命环节、不采基线。
 *
 * 共同的三个关键设计：
 *   1) 夹角判定 + 迟滞：起/收两侧各用一个角度阈值（enterDeg/exitDeg），
 *      倒计时模式的「屏幕朝上」用同一对阈值对 +z 轴比（45° 离开 / 25° 进入）。
 *   2) 倒计时模式的转换门：GO 这一刻手若还朝上（盯倒计时的自然姿势），
 *      必须先离开（≥ enterDeg）再次进入才允许收表 —— 否则起表即停；
 *      GO 时已明显不在朝上姿态则视为门已开，抬腕直接可停。
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
  enterDeg: 45,        // 起表角 / 倒计时「离开屏幕朝上」角：超过算「手已不在该姿态」
  exitDeg: 25,         // 收表角（迟滞，防抖）：回到这个角度内算「屏幕朝上了」
  startDwellMs: 100,   // 起表驻留：越限后需保持这么久才确认
  stopDwellMs: 280,    // 收表驻留：解拧时手腕会扫过收表姿态，驻留用来防误停
  countdownMs: 3000,   // 倒计时时长（点开始到 GO）
  steadyTauMs: 160,    // 平稳度 EMA 时间常数
  steadyMag: 2.0,      // 动态幅值低于此值算「稳」
  gMinMag: 4.0         // 重力估算低于此值时方向不可信，保持上一次可靠方向
}

/** 相位 */
export const PHASE = {
  IDLE: 'idle',        // 空闲：等用户点「准备」（倒计时模式为点屏幕）
  COUNTDOWN: 'countdown', // 倒计时中：数到 GO 自动起表（仅倒计时模式）
  SETTLING: 'settling',// 采基线中：等手平放且静止（仅体感模式）
  ARMED: 'armed',      // 待命：基线已就绪，等翻腕起表（仅体感模式）
  RUNNING: 'running',  // 计时中
  DONE: 'done'         // 本次已结束
}

/** 「屏幕朝上」参考方向（单位向量）：倒计时模式的收表姿态基准 */
const UP = { x: 0, y: 0, z: 1 }

function normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  if (len < 1e-6) return null
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

/**
 * 创建一个魔方计时触发内核。
 *
 * @param {object} [opts] 覆盖 DEFAULTS 的参数；`mode: 'countdown'` 启用倒计时模式
 * @returns {{
 *   feed: function(number, number, number, number=): object,
 *   arm: function(): boolean,
 *   startCountdown: function(number=): object|null,
 *   abort: function(): void,
 *   manualStop: function(number=): object|null,
 *   state: function(): object
 * }}
 */
export function createCubeMotion(opts) {
  const o = Object.assign({}, DEFAULTS, opts || {})
  const cd = !!(opts && opts.mode === 'countdown')   // 倒计时模式

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
  let upAngle = 90                   // 当前重力方向与「屏幕朝上」的夹角（度）
  let startSince = null              // 首次越 enterDeg 的时间戳
  let stopSince = null               // 首次回到 exitDeg 内的时间戳
  let startT = null                  // 起表时刻（回溯后）
  let stopT = null                   // 收表时刻（回溯后）
  let elapsedMs = null               // 本次用时

  let goAt = null                    // 倒计时 GO 时刻（起表点，精确）
  let gateOpen = false               // 倒计时转换门：GO 后是否已离开屏幕朝上姿态

  function resetBaseWindow() {
    baseSumX = 0; baseSumY = 0; baseSumZ = 0
    baseCount = 0
    baseStartT = null
  }

  /** 进入待命：开始采平放基线（仅 idle / done 可进入；倒计时模式不可用） */
  function arm() {
    if (cd) return false
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

  /**
   * 倒计时模式：开始 3 秒倒计时（仅 idle / done 可进入；体感模式不可用）。
   *
   * @param {number} [t0] 点按时刻（毫秒时间戳），GO = t0 + countdownMs
   * @returns {?object} 成功返回 {type:'countdown', goAt}，否则 null
   */
  function startCountdown(t0) {
    if (!cd) return null
    if (phase !== PHASE.IDLE && phase !== PHASE.DONE) return null
    const tapT = (typeof t0 === 'number' && isFinite(t0)) ? t0 : (lastT === null ? 0 : lastT)
    phase = PHASE.COUNTDOWN
    goAt = tapT + o.countdownMs
    gateOpen = false
    startSince = null
    stopSince = null
    startT = null
    stopT = null
    elapsedMs = null
    return { type: 'countdown', goAt: goAt }
  }

  /** 放弃本次（取消 / 离页）：不产生成绩 */
  function abort() {
    phase = PHASE.IDLE
    base = null
    resetBaseWindow()
    goAt = null
    gateOpen = false
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
   * @returns {{phase:string, t:number, angle:number, upAngle:number, steady:boolean,
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

    // ---- 3) 姿态角：与平放基线的夹角（体感）/ 与屏幕朝上的夹角（倒计时） ----
    angle = base ? angleBetween({ x: gDirX, y: gDirY, z: gDirZ }, base) : 0
    upAngle = angleBetween({ x: gDirX, y: gDirY, z: gDirZ }, UP)

    const events = []

    // ---- 4) 相位机 ----
    if (phase === PHASE.COUNTDOWN) {
      // 数到 GO：起表点用 goAt 精确时刻（本帧可能晚到几十毫秒，不吃进成绩）
      if (goAt !== null && now >= goAt) {
        phase = PHASE.RUNNING
        startT = goAt
        startSince = null
        stopSince = null
        // 转换门：GO 这一刻手若已明显不在屏幕朝上姿态（拿着魔方），
        // 视为「已离开」，抬腕即可收表；还朝上（盯倒计时的自然姿势）
        // 则必须先离开再进入，防止起表即停。
        gateOpen = upAngle >= o.enterDeg
        events.push({ type: 'start', t: startT })
      }
    } else if (phase === PHASE.SETTLING) {
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
      if (cd) {
        // 倒计时收表：绝对姿态（屏幕朝上）+ 转换门 + 驻留，不依赖基线
        if (!gateOpen) {
          // 门未开：GO 时手还朝上，等它先离开（≥ enterDeg）才允许后续收表
          if (upAngle >= o.enterDeg) gateOpen = true
        } else if (upAngle <= o.exitDeg) {
          if (stopSince === null) {
            stopSince = now
          } else if (now - stopSince >= o.stopDwellMs) {
            phase = PHASE.DONE
            stopT = stopSince      // 回溯到首次进入屏幕朝上姿态的时刻
            stopSince = null
            elapsedMs = stopT - startT
            events.push({ type: 'stop', t: stopT, elapsed: elapsedMs })
          }
        } else {
          stopSince = null
        }
      } else if (angle <= o.exitDeg) {
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
      upAngle: upAngle,
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
      upAngle: upAngle,
      steady: steady,
      baselineReady: !!base,
      countdownLeft: (phase === PHASE.COUNTDOWN && goAt !== null && lastT !== null)
        ? Math.max(0, goAt - lastT)
        : 0,
      gateOpen: gateOpen,
      startT: startT,
      stopT: stopT,
      elapsed: elapsedMs
    }
  }

  return {
    feed: feed,
    arm: arm,
    startCountdown: startCountdown,
    abort: abort,
    manualStop: manualStop,
    state: state
  }
}

export default { createCubeMotion, DEFAULTS, PHASE }
