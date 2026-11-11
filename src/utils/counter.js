/**
 * 计数器内核：±1 步进与大数字字号。
 */

/** 步进一次：delta 取 +1 / -1，允许负数计数 */
export function step(count, delta) {
  return count + delta
}

/** 中心大数字的字号：位数越多字号越小，避免超宽被截断 */
export function fontSizeOf(value) {
  const n = String(value).length
  if (n <= 4) return 76
  if (n <= 6) return 56
  return 40
}

export default { step, fontSizeOf }