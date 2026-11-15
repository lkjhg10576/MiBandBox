/**
 * 体感灵敏度：低 / 中 / 高三档。
 *
 * 灵敏度同时决定两件事：
 *   1) 准备姿势的标准程度 —— 举手角度门槛、驻留时长、平稳度要求；
 *   2) 触发所需的动作幅度 —— 手枪的抖腕阈值、投篮的向上爆发阈值。
 *
 * 方向（关键设计，别弄反）：
 *   高灵敏度 = 触发门槛更低（小幅度动作就能开枪/投篮），但准备姿势要求更严
 *              （手臂要抬得更高、停得更稳）。系统越灵敏越容易误触发，
 *              所以就绪姿势必须更标准，游戏难度才不塌。
 *   低灵敏度 = 触发门槛更高（要大幅动作），但准备姿势宽松（抬得矮一点也行）。
 *   三档的「难度」因此大致相当：灵敏度只是把手环适配到用户能动幅度上——
 *   动作幅度受限的用户选高档，用小动作也能玩；动作幅度大的用户选低档，
 *   靠大动作取胜。
 *
 * 中档（mid）的参数与三个内核模块的 DEFAULTS 完全一致 —— 默认安装的玩家
 * 体感手感与引入灵敏度之前一模一样（tools/test-motion-sensitivity.mjs 会校验）。
 *
 * 纯 JS、零 @system.* 依赖，Node 可直接 import 单测（tools/test-motion-sensitivity.mjs）。
 */

/** 档位顺序（低 → 高），界面按这个顺序摆 */
export const LEVELS = ['low', 'mid', 'high']

/** 档位中文名 */
export const LABELS = { low: '低', mid: '中', high: '高' }

/** 每档一句话说明：动作幅度要求 · 准备姿势严格程度 */
export const DESCS = {
  low: '动作要大 · 姿势宽松',
  mid: '动作适中 · 姿势标准',
  high: '动作要小 · 姿势严格'
}

/** 默认档位 */
export const DEFAULT_LEVEL = 'mid'

/** 存档键（g.kv） */
export const KV_KEY = 'motionSensitivity'

/**
 * 每档的参数覆盖（覆盖 motionCore / motionGun / motionHoop 的 DEFAULTS）。
 *
 * core.raiseEnterDeg / raiseExitDeg —— 举手判定角（相对垂手基线）与退出角（迟滞）
 * core.dwellMs                     —— 姿势越界后需保持的时长
 * core.steadyMag                   —— 动态幅值低于此值算「稳」（越小越要求稳）
 * gun.shotMag                      —— 抖腕触发开枪的动态加速度阈值
 * hoop.upMag                       —— 向上爆发（投篮）阈值
 * hoop.releaseWindowMs             —— 爆发后多久内必须收手（动作越大收得越慢，窗口放宽）
 */
const PARAMS = {
  low: {
    core: { raiseEnterDeg: 30, raiseExitDeg: 18, dwellMs: 120, steadyMag: 3.0 },
    gun: { shotMag: 18 },
    hoop: { upMag: 12, releaseWindowMs: 900 }
  },
  mid: {
    core: { raiseEnterDeg: 45, raiseExitDeg: 30, dwellMs: 250, steadyMag: 2.0 },
    gun: { shotMag: 12 },
    hoop: { upMag: 8, releaseWindowMs: 600 }
  },
  high: {
    core: { raiseEnterDeg: 60, raiseExitDeg: 42, dwellMs: 400, steadyMag: 1.2 },
    gun: { shotMag: 7 },
    hoop: { upMag: 5, releaseWindowMs: 450 }
  }
}

/** 是否是合法档位（hasOwnProperty 挡掉 'constructor' / '__proto__' 这类原型键） */
export function isLevel(level) {
  return typeof level === 'string' && Object.prototype.hasOwnProperty.call(PARAMS, level)
}

/** 非法档位一律回落到默认档 */
export function normalize(level) {
  return isLevel(level) ? level : DEFAULT_LEVEL
}

/** 档位中文名 */
export function label(level) {
  return LABELS[normalize(level)]
}

/** 档位一句话说明 */
export function desc(level) {
  return DESCS[normalize(level)]
}

/** 体感内核（准备姿势）的参数覆盖 */
export function coreOptions(level) {
  const p = PARAMS[normalize(level)].core
  return {
    raiseEnterDeg: p.raiseEnterDeg,
    raiseExitDeg: p.raiseExitDeg,
    dwellMs: p.dwellMs,
    steadyMag: p.steadyMag
  }
}

/** 手枪状态机的参数覆盖（触发动作幅度） */
export function gunOptions(level) {
  const p = PARAMS[normalize(level)].gun
  return { shotMag: p.shotMag }
}

/** 投篮状态机的参数覆盖（触发动作幅度） */
export function hoopOptions(level) {
  const p = PARAMS[normalize(level)].hoop
  return {
    upMag: p.upMag,
    releaseWindowMs: p.releaseWindowMs
  }
}

/** 三个模块的参数一次性取齐 */
export function options(level) {
  return {
    core: coreOptions(level),
    gun: gunOptions(level),
    hoop: hoopOptions(level)
  }
}

export default {
  LEVELS,
  LABELS,
  DESCS,
  DEFAULT_LEVEL,
  KV_KEY,
  isLevel,
  normalize,
  label,
  desc,
  coreOptions,
  gunOptions,
  hoopOptions,
  options
}
