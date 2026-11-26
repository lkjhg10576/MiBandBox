/**
 * 节拍器拍号与强弱拍重音映射（纯 JS，无 @system.* 依赖）。
 *
 * 拍号配置：
 *   - 'none'：0 拍（沿用用户选择的均匀强/弱档位）
 *   - '2/4'：2 拍（首拍强振橙点、次拍弱振蓝点）
 *   - '3/4'：3 拍
 *   - '4/4'：4 拍
 *   - '6/8'：6 拍
 */

export const METERS = [
  { id: 'none', label: '无', beats: 0 },
  { id: '2/4', label: '2/4', beats: 2 },
  { id: '3/4', label: '3/4', beats: 3 },
  { id: '4/4', label: '4/4', beats: 4 },
  { id: '6/8', label: '6/8', beats: 6 }
]

export function getMeter(id) {
  for (let i = 0; i < METERS.length; i++) {
    if (METERS[i].id === id) return METERS[i]
  }
  return METERS[0]
}

/**
 * 计算第 beatIndex 拍（0-based：0 为小节第 1 拍）的重音与指示灯状态。
 *
 * @param {string|{id:string,beats:number}} meter 拍号 id 或对象
 * @param {number} beatIndex 0-based 拍序
 * @param {'weak'|'strong'} [baseLevel] 无拍号时的均匀力度
 * @returns {{isAccent:boolean, level:'weak'|'strong', dotIndex:number, totalBeats:number}}
 */
export function beatMeta(meter, beatIndex, baseLevel) {
  const m =
    meter && typeof meter === 'object' && typeof meter.beats === 'number'
      ? meter
      : getMeter(meter)
  const base = baseLevel === 'weak' ? 'weak' : 'strong'
  const idx = Math.max(0, Math.floor(Number(beatIndex) || 0))
  if (!m || m.beats <= 0) {
    return {
      isAccent: false,
      level: base,
      dotIndex: -1,
      totalBeats: 0
    }
  }
  const dotIndex = idx % m.beats
  const isAccent = dotIndex === 0
  return {
    isAccent: isAccent,
    level: isAccent ? 'strong' : 'weak',
    dotIndex: dotIndex,
    totalBeats: m.beats
  }
}

export default {
  METERS,
  getMeter,
  beatMeta
}
