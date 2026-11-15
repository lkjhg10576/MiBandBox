/**
 * 体感内核（二）：体感手枪状态机。
 *
 * 纯 JS、零 @system.* 依赖，Node 可直接 import 单测（tools/test-motion-gun.mjs）。
 *
 * 玩法：
 *   - 平直抬手（举起 + 稳住）→ 就绪，长振一次（每次举手只振一次）；
 *   - 扣扳机（抖腕一下）→ 射击成功，长振一次；
 *   - 「需要换弹」开启：弹匣 5 发，第 6 次触发 → 空仓（短振两次），点「换弹」补满；
 *     关闭：无限连发。
 *
 * 就绪是「锁存」的：一旦就绪，只有手臂垂下（raised 变 false）才解除。
 * 否则每开一枪的抖动都会把就绪打断、再抖回来 —— 用户会听到「准备、准备、准备」。
 */

/** 弹匣容量：需要换弹时的发数 */
export const MAG_SIZE = 5

/** 默认参数（真机调手感只改这里） */
export const DEFAULTS = {
  shotMag: 12,       // 触发射击的动态加速度阈值（m/s²）
  refractoryMs: 450  // 两次触发之间的最小间隔
}

/**
 * @param {object} [opts] {reloadOn:boolean, shotMag:number, refractoryMs:number}
 */
export function createGun(opts) {
  const o = Object.assign({ reloadOn: true }, DEFAULTS, opts || {})

  let reloadOn = !!o.reloadOn
  let ammo = reloadOn ? MAG_SIZE : -1   // -1 = 无限
  let ready = false
  let shots = 0
  let lastTrigger = -Infinity

  /**
   * 喂一帧快照，返回事件列表。
   *
   * @param {{raised:boolean, steady:boolean, dynMag:number}} snap motionCore 的输出
   * @param {number} t 毫秒时间戳
   * @returns {Array<{type:string}>} 事件：ready / unready / shot / empty / lastRound
   */
  function feed(snap, t) {
    const events = []
    if (!snap) return events
    const now = typeof t === 'number' ? t : 0

    // 就绪：举起且稳住才进；手臂垂下才出（射击抖动不清就绪）
    if (snap.raised && snap.steady && !ready) {
      ready = true
      events.push({ type: 'ready' })
    } else if (!snap.raised && ready) {
      ready = false
      events.push({ type: 'unready' })
    }

    // 触发：就绪态下的动态加速度尖峰
    if (ready && snap.dynMag >= o.shotMag && now - lastTrigger >= o.refractoryMs) {
      lastTrigger = now
      if (!reloadOn) {
        shots++
        events.push({ type: 'shot', ammoLeft: -1 })
      } else if (ammo > 0) {
        ammo--
        shots++
        events.push({ type: 'shot', ammoLeft: ammo })
        if (ammo === 0) events.push({ type: 'lastRound' })
      } else {
        events.push({ type: 'empty' })
      }
    }

    return events
  }

  /** 换弹：补满弹匣 */
  function reload() {
    if (!reloadOn) return null
    ammo = MAG_SIZE
    return { type: 'reload', ammoLeft: ammo }
  }

  /**
   * 切换「需要换弹」。
   * 打开时立刻补满弹匣（用户刚打开就该能开枪），关闭时转为无限。
   */
  function setReload(on) {
    reloadOn = !!on
    if (reloadOn) ammo = MAG_SIZE
    else ammo = -1
    return reloadOn
  }

  function resetShots() {
    shots = 0
    return shots
  }

  function state() {
    return {
      ready: ready,
      ammo: ammo,          // -1 表示无限
      ammoLeft: reloadOn ? ammo : -1,
      reloadOn: reloadOn,
      shots: shots
    }
  }

  return {
    feed: feed,
    reload: reload,
    setReload: setReload,
    resetShots: resetShots,
    state: state
  }
}

export default { createGun, MAG_SIZE, DEFAULTS }
