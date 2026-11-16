/**
 * 体感内核（三）：空气投篮状态机。
 *
 * 纯 JS、零 @system.* 依赖，Node 可直接 import 单测（tools/test-motion-hoop.mjs）。
 *
 * 玩法：
 *   - 摆好投篮姿态 → 就绪，长振一次（每次就绪只振一次）；
 *   - 双手做出投篮动作（腕部向上爆发 + 出手释放）→ 进球，长振一次并计分 +1。
 *
 * 为什么是「两相」而不是「一次峰值」：
 *   一次峰值分不清「准备」和「投篮」—— 准备姿态本身就是很大的向上加速度。
 *   投篮的完整波形是：向上爆发（起跳）→ 动作收住（出手/放松）。
 *   所以必须在爆发后再看到回落才判进球。
 *
 * 为什么「准备」不会误判成进球：
 *   进球要求 ready 为真，而 ready 只在准备姿态稳住之后才成立
 *   （准备动作本身发生在就绪之前，被直接挡掉）。
 *
 * 静默窗口（muteFor）：就绪提示振会驱动马达，马达自身的振动被同一颗加速度计采到 ——
 * 不挡掉的话，就绪振期间的那记尖峰会被当成「向上爆发」，紧接着的回落就判成进球。
 *
 * 单腕加速度计无法区分单手 / 双手，这里识别的是用户双手投篮时腕部的实际波形。
 */

/**
 * 就绪姿态：投篮 = 翻腕手心朝上，重力落在 +x 轴（只认正 Roll）。
 *
 * 轴 / 符号的对应关系以真机水平仪实测为准（docs/tough-spring-raven.md 步骤 0）：
 * 预期「投篮准备」Roll ≈ +90（重力进 x 轴）、「手平放屏幕朝上」Roll ≈ 0 且 Pitch ≈ 0。
 * 实测与预期不符时只改这里的两个常量，判定数学不动。
 */
export const POSE = { poseAxis: 'x', poseSign: 1 }

export const DEFAULTS = {
  upMag: 8,            // 向上爆发阈值（m/s²）
  releaseMag: 2,       // 收手回落阈值（m/s²）
  rawLow: 6.5,         // 原始加速度回到这个区间 → 动作已停（手收住了）
  rawHigh: 13.5,
  releaseWindowMs: 600, // 爆发后多久内必须回落，超时算「挥不动」作废
  cooldownMs: 800      // 两次进球之间的最小间隔
}

/**
 * @param {object} [opts] 覆盖 DEFAULTS
 */
export function createHoop(opts) {
  const o = Object.assign({}, DEFAULTS, opts || {})

  let ready = false
  let score = 0
  let thrustAt = null   // 最近一次向上爆发的时刻
  let armed = true      // 动作收住后才允许下一次爆发（防抖）
  let lastScoreAt = -Infinity
  let mutedUntil = -Infinity   // 静默窗口结束时刻
  let lastT = 0                // 最近一次 feed 的时间戳

  /**
   * 静默：从最近一帧开始 ms 毫秒内不计分。
   * 页面在收到 ready 事件后调用（就绪振 + 收尾余量）。
   */
  function muteFor(ms) {
    const dur = typeof ms === 'number' && isFinite(ms) ? ms : 0
    const until = lastT + dur
    if (until > mutedUntil) mutedUntil = until
  }

  /**
   * 喂一帧快照，返回事件列表。
   *
   * @param {{raised:boolean, upMag:number, rawMag:number}} snap motionCore 的输出
   * @param {number} t 毫秒时间戳
   * @returns {Array<{type:string}>} 事件：ready / unready / score
   */
  function feed(snap, t) {
    const events = []
    if (!snap) return events
    const now = typeof t === 'number' ? t : 0
    lastT = now

    // 就绪：摆好姿态即就绪（锁存，离开姿态才解除）
    let justReadied = false
    if (snap.raised && !ready) {
      ready = true
      justReadied = true
      events.push({ type: 'ready' })
    } else if (!snap.raised && ready) {
      ready = false
      events.push({ type: 'unready' })
    }

    if (!ready) {
      thrustAt = null
      armed = true
      return events
    }

    // 冷却期内不再判定（一次投篮动作的尾巴不算第二球）
    if (now - lastScoreAt < o.cooldownMs) {
      thrustAt = null
      return events
    }

    // 就绪锁存的那一帧不判定（页面在 feed 返回后才设静默窗口，同帧判定跑在设置之前）；
    // 静默窗口内同样不计分，并把半截手势清掉，避免被带过窗口。
    if (justReadied || now < mutedUntil) {
      thrustAt = null
      return events
    }

    // 动作收住 → 重新武装
    //
    // 「收住」用原始加速度模长判：手停住时设备只剩重力，|a| 立刻回到 9.8 附近。
    // 不能只看「动态分量回落」—— 持续加速时动态分量也会被滤波器追平，
    // 那是「一直没停」，不是「停了」。
    const settled =
      snap.rawMag <= o.rawHigh &&
      (snap.rawMag >= o.rawLow || snap.upMag < o.releaseMag)
    if (settled) {
      armed = true
    }

    if (thrustAt !== null) {
      if (settled) {
        // 爆发后收住 → 出手，判定进球
        thrustAt = null
        lastScoreAt = now
        score++
        events.push({ type: 'score', score: score })
      } else if (now - thrustAt > o.releaseWindowMs) {
        // 一直不收住：这不是投篮动作，是抬着手挥 —— 作废重来
        thrustAt = null
      }
    } else if (armed && snap.upMag >= o.upMag) {
      thrustAt = now
      armed = false
    }

    return events
  }

  function resetScore() {
    score = 0
    return score
  }

  function state() {
    return {
      ready: ready,
      score: score,
      thrusting: thrustAt !== null
    }
  }

  return { feed: feed, muteFor: muteFor, resetScore: resetScore, state: state }
}

export default { createHoop, POSE, DEFAULTS }
