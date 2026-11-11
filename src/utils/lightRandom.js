/**
 * 轻量随机的取值映射（纯 JS、零 @system.* 依赖）。
 * 本质是 Math.random() 生成随机数再映射成趣味结果：
 *   骰子 1..6（单骰一个数、双骰两个数）、硬币 正/反、字母 A-Z 大写。
 * rand 可注入，便于单测做确定性断言（Math.random 本身不进模块依赖）。
 */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function rng(rand) {
  return typeof rand === 'function' ? rand : Math.random
}

function dice(r) {
  // clamp 到 1..6：注入的 rand 可能取到 1，Math.random 不会
  return 1 + Math.min(5, Math.floor(r() * 6))
}

/** 一次抽取的最终结果：{ text, sub }。双骰只给两个点数，不算合计。 */
export function draw(mode, count, rand) {
  const r = rng(rand)
  if (mode === 'coin') {
    return { text: r() < 0.5 ? '正面' : '反面', sub: '' }
  }
  if (mode === 'letter') {
    const i = Math.min(LETTERS.length - 1, Math.floor(r() * LETTERS.length))
    return { text: LETTERS[i], sub: 'A-Z 第 ' + (i + 1) + ' 个' }
  }
  const a = dice(r)
  // 只有 dice 模式才看骰子个数；非法 mode 一律兜底为单骰
  if (mode === 'dice' && count === 2) {
    const b = dice(r)
    return { text: a + ' + ' + b, sub: '' }
  }
  return { text: String(a), sub: '' }
}

/** 动画帧候选：与 draw 同分布、同形态，但不带副行。 */
export function tickText(mode, count, rand) {
  const r = rng(rand)
  if (mode === 'coin') return r() < 0.5 ? '正面' : '反面'
  if (mode === 'letter') return LETTERS[Math.min(LETTERS.length - 1, Math.floor(r() * LETTERS.length))]
  const a = dice(r)
  return mode === 'dice' && count === 2 ? a + ' + ' + dice(r) : String(a)
}

export default { draw, tickText }
