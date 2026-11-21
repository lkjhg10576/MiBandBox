/**
 * 体感内核（三）：摇一摇检测。
 *
 * 纯 JS、零 @system.* 依赖，Node 可直接 import 单测（tools/test-motion-shake.mjs）。
 *
 * 玩法（首位消费者是答案之书）：封面摇一摇 = 翻开，答案页摇一摇 = 再问一次 ——
 * 与 apps.js 里「摇一摇 · 看答案」的描述对齐（此前只有点击，描述是空头支票）。
 *
 * 判定思路：摇一摇是往复摆动，一记甩动 = 一记动态加速度尖峰；
 * 两记尖峰（间隔 ≤ windowMs）才配成一次完整的「摇」——
 * 单记尖峰可能只是抬腕、磕碰，成对的往复才是刻意摇晃。
 *
 * 尖峰用「迟滞边沿」识别：dynMag ≥ shakeMag 进尖峰、回落到 shakeOffMag 以下出尖峰。
 * 一记甩动会连续多帧超阈，按边沿只在其首帧计一次；不按帧数计，
 * 否则一记甩动的第三帧就会和第一帧凑成「两记」（假触发）。
 *
 * 静默窗口（muteFor）：触发后的提示振会驱动马达，马达自身的振动被同一颗加速度计
 * 采到（体感枪/投篮的同款问题）—— 不挡掉的话，振动尖峰会和下一记甩动凑成第二次摇。
 * 页面在反馈震动后必须调用 muteFor(≥350ms)（计划文档 3.5(1) 的硬要求）。
 *
 * 上膛窗口（armMs）：订阅首帧起这么久内不判定 —— 从封面摇进答案页时，用户的摇动
 * 尾巴 + 进页提示振都打在新内核上，不挡的话一进来就自己又翻一页。
 */

/** 默认参数（真机调手感只改这里） */
export const DEFAULTS = {
  shakeMag: 12,        // 进尖峰阈值：动态加速度 ≥ 此值算一记甩动的开始（m/s²，与体感枪 shotMag 同量级）
  shakeOffMag: 6,      // 出尖峰阈值（迟滞）：动态分量回落到此以下，下一记才算新的一记
  windowMs: 500,       // 两记甩动首帧间隔 ≤ 此值算一次完整摇一摇
  refractoryMs: 1200,  // 触发后的冷却期：一次连贯的摇只出一次事件，狂摇也 1.2s 才翻一页
  armMs: 0             // 上膛窗口：订阅首帧起这么久内不判定（进页余波不触发）
}

/** 反馈短振（约 45ms）之后的静默时长：保证振后 ≥350ms 冷却（计划 3.5(1)） */
export const MUTE_AFTER_HAPTIC = 400

/**
 * @param {object} [opts] 覆盖 DEFAULTS 的参数
 * @returns {{
 *   feed: function({dynMag:number}, number=): Array<{type:string}>,
 *   muteFor: function(number): void,
 *   state: function(): object
 * }}
 */
export function createShake(opts) {
  const o = Object.assign({}, DEFAULTS, opts || {})

  let lastT = 0                // 最近一次 feed 的时间戳
  let armedAt = null           // 首帧时间 + armMs
  let inSpike = false          // 迟滞状态：当前正处于一记甩动的尖峰里
  let lastSpike = null         // 上一记甩动首帧的时间戳（null = 没有待配对的尖峰）
  let mutedUntil = -Infinity   // 静默窗口结束时刻
  let refrUntil = -Infinity    // 冷却期结束时刻

  /**
   * 静默：从最近一帧开始 ms 毫秒内不响应。
   * 页面在反馈震动（haptic.short() 等）后调用 —— 马达振动期间不掉事件。
   */
  function muteFor(ms) {
    const dur = typeof ms === 'number' && isFinite(ms) ? ms : 0
    const until = lastT + dur
    if (until > mutedUntil) mutedUntil = until
  }

  /**
   * 喂一帧快照，返回事件列表。
   *
   * @param {{dynMag:number}} snap motionCore 的输出（只需 dynMag）
   * @param {number} [t] 毫秒时间戳（同一单调时钟）
   * @returns {Array<{type:string}>} 事件：shake
   */
  function feed(snap, t) {
    const events = []
    const now = typeof t === 'number' && isFinite(t) ? t : 0
    lastT = now
    if (!snap) return events
    const dyn = Number(snap.dynMag) || 0

    // 上膛：首帧起 armMs 内不判定
    if (armedAt === null) armedAt = now + o.armMs

    // 迟滞边沿任何状态下都照跑（上膛/静默/冷却期间只跟踪不触发）：
    // 马达还在振、甩动还没收尾，出去时才不会冒出一次假的「新的一记」
    let rose = false
    if (!inSpike && dyn >= o.shakeMag) {
      inSpike = true
      rose = true
    } else if (inSpike && dyn < o.shakeOffMag) {
      inSpike = false
    }

    if (now < armedAt || now < mutedUntil || now < refrUntil) {
      // 半截序列一律作废，不许被带过窗口和后面的甩动凑成下一记
      lastSpike = null
      return events
    }

    if (rose) {
      if (lastSpike !== null && now - lastSpike <= o.windowMs) {
        // 两记甩动凑成一次完整摇一摇：出事件 + 进冷却期
        lastSpike = null
        refrUntil = now + o.refractoryMs
        events.push({ type: 'shake' })
        return events
      }
      lastSpike = now
    }

    return events
  }

  function state() {
    return {
      armed: armedAt !== null && lastT >= armedAt,
      inSpike: inSpike,
      muted: lastT < mutedUntil,
      refractory: lastT < refrUntil
    }
  }

  return { feed: feed, muteFor: muteFor, state: state }
}

export default { createShake, DEFAULTS, MUTE_AFTER_HAPTIC }
