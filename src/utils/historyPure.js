/**
 * 史载今日的纯逻辑部分：键格式化、条目归一化、取当天条目、小知识散列。
 *
 * 本文件不得 import 任何 @system.* 或依赖 g（读盘在 historyData.js 里），
 * 以便用 Node 直接跑单测。
 */

/** 标签分类 */
export const tags = [
  '科技', '发明', '航天', '医学', '探索', '建筑', '艺术', '音乐', '影视', '文学',
  '体育', '交通', '能源', '通信', '天文', '地质', '数学', '自然', '历史',
  '物理', '生物', '农业', '生活', '摄影', '印刷', '游戏', '时尚'
]

/** "MM-DD" 键 */
export function keyOf(month, day) {
  const m = Number(month)
  const d = Number(day)
  return (m < 10 ? '0' + m : '' + m) + '-' + (d < 10 ? '0' + d : '' + d)
}

/** 归一化一条史实：旧的字符串写法也转成同样的结构 */
export function normalizeItem(v) {
  if (!v) return null
  if (typeof v === 'string') {
    const y = v.match(/(\d{4})/)
    return { year: y ? Number(y[1]) : 0, title: '', text: v, tag: '' }
  }
  if (typeof v === 'object') {
    return {
      year: Number(v.year) || 0,
      title: String(v.title || ''),
      text: String(v.text || ''),
      tag: String(v.tag || '')
    }
  }
  return null
}

/** 从某个月的对象里取某天的条目数组 */
export function pickFrom(bucket, month, day) {
  const raw = bucket ? bucket[keyOf(month, day)] : null
  if (!raw) return []
  const list = Array.isArray(raw) ? raw : [raw]
  const out = []
  for (let i = 0; i < list.length; i++) {
    const it = normalizeItem(list[i])
    if (it && it.text) out.push(it)
  }
  return out
}

/** 稳定散列：同一 (month, day) 永远得到同一组小知识 */
export function hashOf(month, day) {
  let h = (Number(month) * 73856093) ^ (Number(day) * 19349663)
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995)
  return (h ^ (h >>> 15)) >>> 0
}

export default { tags, keyOf, normalizeItem, pickFrom, hashOf }
