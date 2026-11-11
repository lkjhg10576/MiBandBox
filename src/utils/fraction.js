/**
 * 精确有理数内核：Q = { num, den }，恒满足 den > 0、gcd(|num|, den) = 1、0 -> { num:0, den:1 }。
 *
 * 为什么不用浮点：计算器要「全程精确」，1/3+1/3+1/3 必须正好是 1、0.1+0.2 必须正好是 3/10。
 * 只要分母/分子始终是安全整数（<= 2^53-1），有理数四则就是封闭且精确的。
 *
 * 溢出策略：所有可能越界的地方返回 null（safeMul / add / sub / mul / div / pow），
 * 由上层 calc.js 就地降级成浮点结果，绝不返回一个「看起来精确」的错数。
 */

const MAX_SAFE = 9007199254740991

/** 安全整数判定：不依赖 Number.isInteger，Vela 运行时更保守 */
function isInt(n) {
  return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && Math.abs(n) <= MAX_SAFE
}

function fits(n) {
  return isInt(n)
}

/** 欧几里得最大公约数；非整数入参按 1 处理（防御，正常路径不会走到） */
function gcd(a, b) {
  if (!isInt(a) || !isInt(b)) return 1
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) {
    const t = a % b
    a = b
    b = t
  }
  return a || 1
}

/**
 * 构造并约分。符号统一归到分子，0 一律写成 0/1。
 * @throws 分母为 0 / 非整数 / 超出安全整数
 */
function make(num, den) {
  if (!fits(num) || !fits(den)) throw new Error('not integer')
  if (den === 0) throw new Error('divide by zero')
  if (den < 0) {
    num = -num
    den = -den
  }
  const g = gcd(num, den)
  return { num: num / g, den: den / g }
}

/** 安全乘法：任一因子非安全整数或乘积越界返回 null */
function safeMul(a, b) {
  if (!fits(a) || !fits(b)) return null
  if (a === 0 || b === 0) return 0
  if (Math.abs(a) > Math.floor(MAX_SAFE / Math.abs(b))) return null
  return a * b
}

/** 安全加法 */
function safeAdd(a, b) {
  if (!fits(a) || !fits(b)) return null
  const s = a + b
  if (!fits(s)) return null
  return s
}

function add(a, b) {
  const n1 = safeMul(a.num, b.den)
  const n2 = safeMul(b.num, a.den)
  const d = safeMul(a.den, b.den)
  if (n1 === null || n2 === null || d === null) return null
  const n = safeAdd(n1, n2)
  if (n === null) return null
  return make(n, d)
}

function sub(a, b) {
  return add(a, neg(b))
}

function mul(a, b) {
  const n = safeMul(a.num, b.num)
  const d = safeMul(a.den, b.den)
  if (n === null || d === null) return null
  return make(n, d)
}

/** @throws 除数为 0 */
function div(a, b) {
  if (b.num === 0) throw new Error('divide by zero')
  const n = safeMul(a.num, b.den)
  const d = safeMul(a.den, b.num)
  if (n === null || d === null) return null
  return make(n, d)
}

function neg(a) {
  return { num: -a.num, den: a.den }
}

/** @throws 0 没有倒数 */
function inv(a) {
  if (a.num === 0) throw new Error('divide by zero')
  return make(a.den, a.num)
}

function abs(a) {
  return { num: Math.abs(a.num), den: a.den }
}

function one() {
  return { num: 1, den: 1 }
}

function zero() {
  return { num: 0, den: 1 }
}

/** 整数快速幂；负指数先取倒数。溢出返回 null */
function pow(a, n) {
  if (!isInt(n)) throw new Error('int exponent only')
  if (n === 0) return one()
  if (n < 0) {
    if (a.num === 0) throw new Error('divide by zero')
    return pow(inv(a), -n)
  }
  let result = one()
  let base = a
  let e = n
  while (e > 0) {
    if (e % 2 === 1) {
      const t = mul(result, base)
      if (!t) return null
      result = t
    }
    e = Math.floor(e / 2)
    if (e > 0) {
      const t = mul(base, base)
      if (!t) return null
      base = t
    }
  }
  return result
}

function isIntQ(a) {
  return a.den === 1
}

function toNumber(a) {
  return a.num / a.den
}

/** 整数完全平方数判定 */
function isSquare(n) {
  if (!isInt(n) || n < 0) return false
  const r = Math.floor(Math.sqrt(n))
  return r * r === n || (r + 1) * (r + 1) === n
}

/**
 * 有理数开方：分子分母都是完全平方数才精确，否则返回 null 交给浮点。
 * 例：sqrt(4/1) -> 2/1、sqrt(1/4) -> 1/2、sqrt(2) -> null
 */
function sqrt(a) {
  if (a.num < 0) throw new Error('sqrt negative')
  if (!isSquare(a.num) || !isSquare(a.den)) return null
  return { num: Math.sqrt(a.num), den: Math.sqrt(a.den) }
}

export default {
  make,
  add,
  sub,
  mul,
  div,
  pow,
  neg,
  inv,
  abs,
  zero,
  one,
  isInt: isIntQ,
  isSafeInt: isInt,
  toNumber,
  gcd,
  safeMul,
  safeAdd,
  isSquare,
  sqrt,
  MAX_SAFE
}
