/**
 * 加速度计全局订阅中枢（跨页面共享，状态挂 globalThis）。
 *
 * Vela 的 @system.sensor 实测语义（band10 模拟器 E2E 判决，2026-11-22）：
 *   - 全局只有一个订阅槽：槽被占时后续 subscribeAccelerometer 被**静默忽略**
 *     （不回调 fail、也不抛错），新页面从此收不到帧；
 *   - unsubscribeAccelerometer() 是全局退订且异步落定，紧跟着的新订阅会被一起杀掉；
 *   - 已注册的回调持续收帧，与注册页是否可见无关（栈底页被覆盖时照常投递）。
 *
 * 所以页面各自订阅/退订会在转场时互相误杀（答案之书 E2E 连续复现：封面摇一摇灵、
 * 答案页必聋）。约定：订阅只做一次、由栈底传感器页（封面）持有，帧经这里的
 * 「消费者槽」转发给当前可见页；页面在 onShow 挂自己的处理器、onHide 摘（只摘自己的）。
 */
import sensor from '@system.sensor'

const CONSUMER = '__bbAccelConsumer'
const SUBBED = '__bbAccelSubbed'

/** 唯一的注册回调：纯转发，不捕获任何页面引用 */
function dispatch(ret) {
  const consume = globalThis[CONSUMER]
  if (consume) consume(ret)
}

/**
 * 确保订阅存在（幂等）。只有持有订阅的页面（栈底传感器页）应在 onShow 调用。
 * 'game'（20ms）失败自动降级 'ui'（60ms）；全失败返回 false（调用方自行静默降级）。
 */
export function ensureSubscribed() {
  const g = globalThis
  if (g[SUBBED]) return true
  let ok = false
  let triedUi = false
  const onFail = () => {
    if (triedUi) return
    triedUi = true
    try {
      sensor.subscribeAccelerometer({ interval: 'ui', callback: dispatch, fail: () => {} })
      ok = true
    } catch (e) {
      ok = false
    }
  }
  try {
    sensor.subscribeAccelerometer({ interval: 'game', callback: dispatch, fail: onFail })
    ok = true
  } catch (e) {
    onFail()
  }
  g[SUBBED] = ok
  return ok
}

/** 全局退订（只在持有订阅的页面 onDestroy 里调用） */
export function unsubscribe() {
  try {
    sensor.unsubscribeAccelerometer()
  } catch (e) {}
  globalThis[SUBBED] = false
}

/**
 * 设置当前帧消费者：页面在 onShow 里调用。
 * 传包装闭包时请把引用存模块级变量，摘除时传同一个引用（clearConsumer 靠引用比较防误摘）。
 */
export function setConsumer(fn) {
  globalThis[CONSUMER] = fn || null
}

/** 摘除消费者：只摘自己的（引用比较）——转场两个页面的 onShow/onHide 任何顺序都安全 */
export function clearConsumer(fn) {
  if (fn && globalThis[CONSUMER] === fn) globalThis[CONSUMER] = null
}

export default { ensureSubscribed, unsubscribe, setConsumer, clearConsumer }
