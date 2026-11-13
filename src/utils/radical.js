/**
 * 功能与按键语义借鉴 Open_Modular_Boardgame_Companion（MIT, Copyright (c) 2025 MinimumBubble11）；求值引擎为本项目自研，未复制其源码。
 *
 * 根式三元组内核：{ num, den, rad }，表示 (num/den) * √rad。
 * 恒满足：den > 0、gcd(|num|, den) = 1、rad >= 1 且为无平方因子正整数。
 * 当 num === 0 时归一为 { num: 0, den: 1, rad: 1 }。
 * 当 rad === 1 时退化为纯有理数。
 *
 * 性能护栏与取舍：
 * simplify 试除上限 min(10000, √rad)，剩余部分以 isSquare 兜底。
 * 超大根号若含有大于 10000 的大素数平方因子，可能无法完全化简，此时降级浮点。
 * 所有可能越界或无法精确表示为单根式的操作返回 null，由上层 calc.js 降级为浮点。
 */

import F from './fraction.js'

/**
 * 提取正整数 rad 的最大平方因子：rad = sq^2 * rem
 * @param {number} rad
 * @returns {{ sq: number, rad: number } | null}
 */
function simplify(rad) {
  if (!F.isSafeInt(rad) || rad <= 0) return null
  let sq = 1
  let rem = rad
  const limit = Math.min(10000, Math.floor(Math.sqrt(rem)))
  for (let i = 2; i <= limit; i++) {
    const i2 = i * i
    if (i2 > rem) break
    while (rem % i2 === 0) {
      sq *= i
      rem = Math.floor(rem / i2)
    }
  }
  if (rem > 1 && F.isSquare(rem)) {
    const s = Math.round(Math.sqrt(rem))
    const nsq = F.safeMul(sq, s)
    if (nsq === null) return null
    sq = nsq
    rem = 1
  }
  return { sq, rad: rem }
}

/**
 * 构造根式三元组并约分化简。
 * @returns {{ num: number, den: number, rad: number } | null}
 */
function make(num, den, rad) {
  let q
  try {
    q = F.make(num, den)
  } catch (e) {
    return null
  }
  if (q.num === 0) {
    return { num: 0, den: 1, rad: 1 }
  }
  const sim = simplify(rad)
  if (!sim) return null
  const newNum = F.safeMul(q.num, sim.sq)
  if (newNum === null) return null
  try {
    const finalQ = F.make(newNum, q.den)
    return {
      num: finalQ.num,
      den: finalQ.den,
      rad: finalQ.num === 0 ? 1 : sim.rad
    }
  } catch (e) {
    return null
  }
}

/**
 * 有理数开方：√(num/den)
 * @param {{ num: number, den: number }} q
 * @returns {{ num: number, den: number, rad: number } | null}
 */
function sqrtQ(q) {
  if (!q || !F.isSafeInt(q.num) || !F.isSafeInt(q.den) || q.den <= 0) return null
  if (q.num < 0) throw new Error('sqrt negative')
  if (q.num === 0) return { num: 0, den: 1, rad: 1 }

  const sn = simplify(q.num)
  const sd = simplify(q.den)
  if (!sn || !sd) return null

  const rProd = F.safeMul(sn.rad, sd.rad)
  if (rProd === null) return null

  const cDen = F.safeMul(sd.sq, sd.rad)
  if (cDen === null) return null

  return make(sn.sq, cDen, rProd)
}

function add(a, b) {
  if (a.num === 0) return { num: b.num, den: b.den, rad: b.rad }
  if (b.num === 0) return { num: a.num, den: a.den, rad: a.rad }
  if (a.rad !== b.rad) return null

  const q = F.add({ num: a.num, den: a.den }, { num: b.num, den: b.den })
  if (!q) return null
  if (q.num === 0) return { num: 0, den: 1, rad: 1 }
  return { num: q.num, den: q.den, rad: a.rad }
}

function sub(a, b) {
  return add(a, neg(b))
}

function mul(a, b) {
  if (a.num === 0 || b.num === 0) return { num: 0, den: 1, rad: 1 }

  const q = F.mul({ num: a.num, den: a.den }, { num: b.num, den: b.den })
  if (!q) return null

  const rProd = F.safeMul(a.rad, b.rad)
  if (rProd === null) return null

  const sim = simplify(rProd)
  if (!sim) return null

  const newNum = F.safeMul(q.num, sim.sq)
  if (newNum === null) return null

  return make(newNum, q.den, sim.rad)
}

function div(a, b) {
  if (b.num === 0) throw new Error('divide by zero')
  if (a.num === 0) return { num: 0, den: 1, rad: 1 }

  const q = F.div({ num: a.num, den: a.den }, { num: b.num, den: b.den })
  if (!q) return null

  const dDen = F.safeMul(q.den, b.rad)
  if (dDen === null) return null

  const rProd = F.safeMul(a.rad, b.rad)
  if (rProd === null) return null

  const sim = simplify(rProd)
  if (!sim) return null

  const newNum = F.safeMul(q.num, sim.sq)
  if (newNum === null) return null

  return make(newNum, dDen, sim.rad)
}

function neg(a) {
  return { num: -a.num, den: a.den, rad: a.rad }
}

function inv(a) {
  if (a.num === 0) throw new Error('divide by zero')
  const dDen = F.safeMul(a.num, a.rad)
  if (dDen === null) return null
  return make(a.den, dDen, a.rad)
}

function abs(a) {
  return { num: Math.abs(a.num), den: a.den, rad: a.rad }
}

function pow(a, n) {
  if (!F.isSafeInt(n)) throw new Error('int exponent only')
  if (n === 0) return { num: 1, den: 1, rad: 1 }
  if (Math.abs(n) > 4096) return null
  if (n < 0) {
    if (a.num === 0) throw new Error('divide by zero')
    const invA = inv(a)
    if (!invA) return null
    return pow(invA, -n)
  }

  // (c * √rad)^n
  // 如果 rad === 1，退化为纯有理数幂
  if (a.rad === 1) {
    const q = F.pow({ num: a.num, den: a.den }, n)
    if (!q) return null
    return { num: q.num, den: q.den, rad: 1 }
  }

  // 偶次幂：((c^2) * rad)^(n/2) 纯有理数
  const k = Math.floor(n / 2)
  const isOdd = n % 2 === 1

  // 先算底数的平方 (c^2 * rad)
  const c2 = F.mul({ num: a.num, den: a.den }, { num: a.num, den: a.den })
  if (!c2) return null
  const baseQNum = F.safeMul(c2.num, a.rad)
  if (baseQNum === null) return null
  let baseQ
  try {
    baseQ = F.make(baseQNum, c2.den)
  } catch (e) {
    return null
  }

  const evenPowQ = F.pow(baseQ, k)
  if (!evenPowQ) return null

  if (!isOdd) {
    return { num: evenPowQ.num, den: evenPowQ.den, rad: 1 }
  }

  return mul({ num: evenPowQ.num, den: evenPowQ.den, rad: 1 }, a)
}

function toNumber(t) {
  return (t.num / t.den) * Math.sqrt(t.rad)
}

function format(t) {
  if (t.num === 0) return '0'
  if (t.rad === 1) {
    return t.den === 1 ? '' + t.num : t.num + '/' + t.den
  }
  const isNeg = t.num < 0
  const an = Math.abs(t.num)
  const radStr = '√' + t.rad
  const numStr = an === 1 ? radStr : an + radStr
  const sign = isNeg ? '-' : ''
  if (t.den === 1) {
    return sign + numStr
  }
  return sign + numStr + '/' + t.den
}

export default {
  simplify,
  make,
  sqrtQ,
  add,
  sub,
  mul,
  div,
  pow,
  neg,
  inv,
  abs,
  toNumber,
  format
}
