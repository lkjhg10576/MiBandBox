/**
 * 体感内核（三）：空气投篮状态机。
 *
 * 纯 JS、零 @system.* 依赖，Node 可直接 import 单测（tools/test-motion-hoop.mjs）。
 *
 * 玩法：
 *   - 举手 → 就绪，长振一次（每次举手只振一次）；
 *   - 双手做出投篮动作（腕部向上爆发 + 出手释放）→ 进球，长振一次并计分 +1。
 *
 * 为什么是「两相」而不是「一次峰值」：
 *   一次峰值分不清「举手」和「投篮」——举手本身就是很大的向上加速度。
 *   投篮的完整波形是：向上爆发（起跳）→ 动作收住（出手/放松）。
 *   所以必须在爆发后再看到回落才判进球。
 *
 * 为什么「举手」不会误判成进球：
 *   进球要求 ready 为真，而 ready 只在举手完成并稳住之后才成立
 *   （举手动作本身发生在就绪之前，被直接挡掉）。
 *
 * 单腕加速度计无法区分单手 / 双手，这里识别的是用户双手投篮时腕部的实际波形。
 */

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

  /**
   * 喂一帧快照，返回事件列表。
   *
   * @param {{raised:boolean, upMag:number}} snap motionCore 的输出
   * @param {number} t 毫秒时间戳
   * @returns {Array<{type:string}>} 事件：ready / unready / score
   */
  function feed(snap, t) {
    const events = []
    if (!snap) return events
    const now = typeof t === 'number' ? t : 0

    // 就绪：举手即就绪（锁存，手臂垂下才解除）
    if (snap.raised && !ready) {
      ready = true
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

  return { feed: feed, resetScore: resetScore, state: state }
}

export default { createHoop, DEFAULTS }
