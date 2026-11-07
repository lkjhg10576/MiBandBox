/**
 * 可复现随机：mulberry32 伪随机数发生器 + 种子洗牌。
 *
 * 用途（计划 L4-4c）：每日一言原本把 1000 个索引的洗牌队列整个存进 KV
 * （单次写入约 4.5 KB）。改成只存「种子 + 位置」两个数（约 30 字节），
 * 队列由种子现场重建 —— 行为等价（一轮内不重复、抽完再洗）。
 */

/** mulberry32：32 位种子 → [0,1) 均匀分布 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 用种子生成 Fisher-Yates 洗牌结果（0..n-1 的一个排列）
 * @param {Number} n 元素个数
 * @param {Number} seed 随机种子
 * @returns {Array}
 */
export function shuffledDeck(n, seed) {
  const rnd = mulberry32(seed)
  const deck = []
  for (let i = 0; i < n; i++) deck.push(i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const t = deck[i]
    deck[i] = deck[j]
    deck[j] = t
  }
  return deck
}

export default { mulberry32, shuffledDeck }
