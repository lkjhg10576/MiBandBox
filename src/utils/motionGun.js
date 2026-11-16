/**
 * 体感内核（二）：体感手枪状态机。
 *
 * 纯 JS、零 @system.* 依赖，Node 可直接 import 单测（tools/test-motion-gun.mjs）。
 *
 * 玩法：
 *   - 摆好举枪姿态并稳住 → 就绪，长振一次（每次就绪只振一次）；
 *   - 扣扳机（抖腕一下）→ 射击成功，长振一次；
 *   - 「需要换弹」开启：弹匣 5 发，第 6 次触发 → 空仓（短振两次），点「换弹」补满；
 *     关闭：无限连发。
 *
 * 就绪是「锁存」的：一旦就绪，只有离开就绪姿态（raised 变 false）才解除。
 * 否则每开一枪的抖动都会把就绪打断、再抖回来 —— 用户会听到「准备、准备、准备」。
 *
 * 静默窗口（muteFor）：就绪提示振会驱动马达，马达自身的振动被同一颗加速度计采到 ——
 * 不挡掉的话，就绪振期间的那记尖峰会直接开枪（弹匣凭空少一格）。
 */

/** 弹匣容量：需要换弹时的发数 */
export const MAG_SIZE = 5

/**
 * 就绪姿态：举枪 = 重力落在 y 轴（屏幕朝侧、前臂竖直），左右手都认 → poseSign = 0。
 *
 * 轴 / 符号的对应关系以真机水平仪实测为准（docs/tough-spring-raven.md 步骤 0）：
 * 预期「举枪」Pitch ≈ ±90（重力进 y 轴）、「手平放屏幕朝上」Pitch ≈ 0 且 Roll ≈ 0。
 * 实测与预期不符时只改这里的两个常量，判定数学不动。
 */
export const POSE = { poseAxis: 'y', poseSign: 0 }

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
  let mutedUntil = -Infinity   // 静默窗口结束时刻
  let lastT = 0                // 最近一次 feed 的时间戳

  /**
   * 静默：从最近一帧开始 ms 毫秒内不响应触发。
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
   * @param {{raised:boolean, steady:boolean, dynMag:number}} snap motionCore 的输出
   * @param {number} t 毫秒时间戳
   * @returns {Array<{type:string}>} 事件：ready / unready / shot / empty / lastRound
   */
  function feed(snap, t) {
    const events = []
    if (!snap) return events
    const now = typeof t === 'number' ? t : 0
    lastT = now

    // 就绪：摆好姿态且稳住才进；离开姿态才出（射击抖动不清就绪）
    let justReadied = false
    if (snap.raised && snap.steady && !ready) {
      ready = true
      justReadied = true
      events.push({ type: 'ready' })
    } else if (!snap.raised && ready) {
      ready = false
      events.push({ type: 'unready' })
    }

    // 触发：就绪态下的动态加速度尖峰
    //   - 静默窗口内不响应（就绪振期间马达在振）
    //   - 就绪锁存的那一帧不响应：页面是在 feed 返回后才设静默窗口，
    //     同帧的触发判定跑在静默窗口设置之前
    if (ready && !justReadied && now >= mutedUntil &&
        snap.dynMag >= o.shotMag && now - lastTrigger >= o.refractoryMs) {
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
    muteFor: muteFor,
    reload: reload,
    setReload: setReload,
    resetShots: resetShots,
    state: state
  }
}

export default { createGun, MAG_SIZE, POSE, DEFAULTS }
