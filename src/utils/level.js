/**
 * 水平仪分级内核：把双轴倾角映射成绿 / 蓝 / 橙 / 红四档。
 *
 * 纯 JS、零 @system.* 依赖，Node 可直接 import 单测（tools/test-level.mjs）。
 *
 * 分档只看两轴里更陡的那一根 max(|roll|, |pitch|)：
 *   < 1.5°   已水平   绿
 *   < 8°     微倾     蓝
 *   <= 30°   倾斜     橙
 *   > 30°    严重倾斜 红
 * 与页面原先的判定完全一致（绿/蓝要求两轴同时够平，橙/红只要有一根够陡）。
 *
 * 四档各有唯一的 index 与颜色，页面按 index 是否变化决定重绘 ——
 * 颜色与文案必然同步刷新，不会出现「文案变了颜色没变」。
 */

/** 四档，从最平到最陡。index 唯一且与数组下标一致，页面按它判断要不要重绘 */
export const LEVELS = [
  { index: 0, id: 'level', state: '已水平', color: '#00C853' },
  { index: 1, id: 'slight', state: '微倾', color: '#0D6EFF' },
  { index: 2, id: 'tilt', state: '倾斜', color: '#FF9500' },
  { index: 3, id: 'severe', state: '严重倾斜', color: '#FF3B30' }
]

/**
 * 各档的分界角（度），与原页面的阈值一一对应：
 *   green  < 1.5
 *   slight < 8
 *   tilt   <= 30
 *   severe > 30
 */
const BOUNDARY = [1.5, 8, 30]

/**
 * 迟滞带（度）：只作用于最陡的一档（橙 ↔ 红）。
 *
 * 红色是这次才真正接上的档位，转场处若不留余量，手环停在 30° 附近会橙红频闪；
 * 降到 29.5° 以下才落回橙色。其余三档的分界与历史判定逐值一致，不动手感。
 */
const HYSTERESIS = 0.5

/** 两轴取绝对值后的较大者 = 实际倾斜程度 */
export function maxTilt(roll, pitch) {
  const r = Math.abs(Number(roll) || 0)
  const p = Math.abs(Number(pitch) || 0)
  return r > p ? r : p
}

/** 不带迟滞的定档：与历史判定逐值一致 */
export function rawIndex(angle) {
  if (angle < BOUNDARY[0]) return 0
  if (angle < BOUNDARY[1]) return 1
  if (angle <= BOUNDARY[2]) return 2
  return 3
}

/**
 * 定档。
 *
 * @param {number} angle 倾斜程度（度），建议用 maxTilt() 算好
 * @param {number} [prevIndex] 上一帧的档位下标；null/undefined 表示首次判定
 * @returns {{index:number, id:string, state:string, color:string}}
 *
 * 迟滞只有一个方向：从红色降回橙色要多退 0.5°，升上去则一碰就到。
 * 单向迟滞不会出现「正好卡在阈值上两边都成立」的歧义，也不会来回抖。
 */
export function classify(angle, prevIndex) {
  const v = Number(angle)
  const a = isFinite(v) && v > 0 ? v : 0

  const last = LEVELS.length - 1
  const target = rawIndex(a)

  // 已经在红色：退到 29.5° 及以下才落回橙色
  if (prevIndex === last && target < last && a > BOUNDARY[last - 1] - HYSTERESIS) {
    return LEVELS[last]
  }

  return LEVELS[target]
}

export default { LEVELS, maxTilt, rawIndex, classify }
