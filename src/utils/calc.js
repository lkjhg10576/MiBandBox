/**
 * 功能与按键语义借鉴 Open_Modular_Boardgame_Companion（MIT, Copyright (c) 2025 MinimumBubble11）；求值引擎为本项目自研，未复制其源码。
 *
 * 表达式求值：+ - * / % ^、括号、一元正负号、开方、三角/反三角、ln/log/倒数/绝对值/阶乘、常数 π/e、角度单位 °。
 * 递归下降，不依赖 eval。
 *
 * L5 精确化：内部统一用 Val 表示数值
 *   Val = { k:'q', num, den }         精确有理数（已约分）
 *       | { k:'r', num, den, rad }    精确根式 (num/den)*√rad
 *       | { k:'f', v }                浮点回退
 * 只有两边都是精确表示且不溢出时才走 fraction / radical 内核；
 * 一旦降级为浮点就全程保持浮点，绝不伪装精确。
 */
import fraction from './fraction.js'
import radical from './radical.js'

// ---------- Val 基础操作 ----------

function qv(num, den) {
  const f = fraction.make(num, den)
  return { k: 'q', num: f.num, den: f.den }
}

/** fraction 的 {num,den} 包装成 Val */
function wrapQ(f) {
  return { k: 'q', num: f.num, den: f.den }
}

function rv(num, den, rad) {
  const r = radical.make(num, den, rad)
  if (!r) return fv((num / den) * Math.sqrt(rad))
  if (r.rad === 1) return { k: 'q', num: r.num, den: r.den }
  return { k: 'r', num: r.num, den: r.den, rad: r.rad }
}

function wrapR(r) {
  if (r.rad === 1) return { k: 'q', num: r.num, den: r.den }
  return { k: 'r', num: r.num, den: r.den, rad: r.rad }
}

function fv(v) {
  return { k: 'f', v: v }
}

function zero() {
  return { k: 'q', num: 0, den: 1 }
}

function one() {
  return { k: 'q', num: 1, den: 1 }
}

function isQ(a) {
  return !!a && a.k === 'q'
}

function isR(a) {
  return !!a && a.k === 'r'
}

function isZero(a) {
  if (!a) return false
  if (a.k === 'q' || a.k === 'r') return a.num === 0
  return a.v === 0
}

function isIntVal(a) {
  return isQ(a) && a.den === 1
}

function toNumber(a) {
  if (!a) return NaN
  if (a.k === 'q') return a.num / a.den
  if (a.k === 'r') return radical.toNumber(a)
  return a.v
}

/** 转浮点 Val（一旦降级就不再回退精确） */
function toF(a) {
  return a.k === 'f' ? a : fv(toNumber(a))
}

function fromNum(n) {
  if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n) return fv(n)
  if (Math.abs(n) > fraction.MAX_SAFE) return fv(n)
  return { k: 'q', num: n, den: 1 }
}

function markDeg(a) {
  const t = { ...a }
  t.deg = true
  return t
}

function keepDeg(src, dst) {
  if (src && src.deg) dst.deg = true
  return dst
}

function argRad(v, deg) {
  const n = toNumber(v)
  return (v && v.deg) || deg ? (n * Math.PI) / 180 : n
}

function add(a, b) {
  if (a.k === 'q' && b.k === 'q') {
    const r = fraction.add(a, b)
    if (r) return wrapQ(r)
  } else if ((a.k === 'q' || a.k === 'r') && (b.k === 'q' || b.k === 'r')) {
    const ar = a.k === 'r' ? a : { num: a.num, den: a.den, rad: 1 }
    const br = b.k === 'r' ? b : { num: b.num, den: b.den, rad: 1 }
    const r = radical.add(ar, br)
    if (r) return wrapR(r)
  }
  return fv(toNumber(a) + toNumber(b))
}

function sub(a, b) {
  if (a.k === 'q' && b.k === 'q') {
    const r = fraction.sub(a, b)
    if (r) return wrapQ(r)
  } else if ((a.k === 'q' || a.k === 'r') && (b.k === 'q' || b.k === 'r')) {
    const ar = a.k === 'r' ? a : { num: a.num, den: a.den, rad: 1 }
    const br = b.k === 'r' ? b : { num: b.num, den: b.den, rad: 1 }
    const r = radical.sub(ar, br)
    if (r) return wrapR(r)
  }
  return fv(toNumber(a) - toNumber(b))
}

function mul(a, b) {
  if (a.k === 'q' && b.k === 'q') {
    const r = fraction.mul(a, b)
    if (r) return wrapQ(r)
  } else if ((a.k === 'q' || a.k === 'r') && (b.k === 'q' || b.k === 'r')) {
    const ar = a.k === 'r' ? a : { num: a.num, den: a.den, rad: 1 }
    const br = b.k === 'r' ? b : { num: b.num, den: b.den, rad: 1 }
    const r = radical.mul(ar, br)
    if (r) return wrapR(r)
  }
  return fv(toNumber(a) * toNumber(b))
}

function div(a, b) {
  if (a.k === 'q' && b.k === 'q') {
    if (b.num === 0) throw new Error('divide by zero')
    const r = fraction.div(a, b)
    if (r) return wrapQ(r)
  } else if ((a.k === 'q' || a.k === 'r') && (b.k === 'q' || b.k === 'r')) {
    if (b.num === 0) throw new Error('divide by zero')
    const ar = a.k === 'r' ? a : { num: a.num, den: a.den, rad: 1 }
    const br = b.k === 'r' ? b : { num: b.num, den: b.den, rad: 1 }
    const r = radical.div(ar, br)
    if (r) return wrapR(r)
  }
  const d = toNumber(b)
  if (d === 0) throw new Error('divide by zero')
  return fv(toNumber(a) / d)
}

function pow(a, b) {
  if (a.k === 'q' && b.k === 'q' && b.den === 1 && Math.abs(b.num) <= 4096) {
    const r = fraction.pow(a, b.num)
    if (r) return wrapQ(r)
  } else if (a.k === 'r' && b.k === 'q' && b.den === 1 && Math.abs(b.num) <= 4096) {
    const r = radical.pow(a, b.num)
    if (r) return wrapR(r)
  }
  return fv(Math.pow(toNumber(a), toNumber(b)))
}

function neg(a) {
  let res
  if (a.k === 'q') res = { k: 'q', num: -a.num, den: a.den }
  else if (a.k === 'r') res = { k: 'r', num: -a.num, den: a.den, rad: a.rad }
  else res = fv(-a.v)
  return keepDeg(a, res)
}

function absV(a) {
  let res
  if (a.k === 'q') res = { k: 'q', num: Math.abs(a.num), den: a.den }
  else if (a.k === 'r') res = { k: 'r', num: Math.abs(a.num), den: a.den, rad: a.rad }
  else res = fv(Math.abs(a.v))
  return keepDeg(a, res)
}

function inv(a) {
  if (a.k === 'q') {
    if (a.num === 0) throw new Error('divide by zero')
    return wrapQ(fraction.inv(a))
  }
  if (a.k === 'r') {
    if (a.num === 0) throw new Error('divide by zero')
    const r = radical.inv(a)
    if (r) return wrapR(r)
  }
  const d = toNumber(a)
  if (d === 0) throw new Error('divide by zero')
  return fv(1 / d)
}

/** 开方：优先有理数，次选根式三元组，否则浮点 */
function sqrtV(a) {
  const n = toNumber(a)
  if (n < 0) throw new Error('sqrt negative')
  if (a.k === 'q') {
    const r = fraction.sqrt(a)
    if (r) return wrapQ(r)
    const radR = radical.sqrtQ(a)
    if (radR) return wrapR(radR)
  }
  return fv(Math.sqrt(n))
}

function fact(a) {
  if (!isIntVal(a)) throw new Error('factorial needs integer')
  const n = a.num
  if (n < 0 || n > 170) throw new Error('factorial out of range')
  let r = 1
  for (let i = 2; i <= n; i++) r *= i
  return fv(r)
}

const val = {
  q: qv,
  fromQ: wrapQ,
  r: rv,
  fromR: wrapR,
  f: fv,
  zero,
  one,
  fromNum,
  add,
  sub,
  mul,
  div,
  pow,
  neg,
  abs: absV,
  inv,
  sqrt: sqrtV,
  toNumber,
  isZero,
  isInt: isIntVal,
  isQ,
  isR
}

// ---------- 词法 ----------

/** 多字符单词按最长匹配；asin/acos/atan 必须在 sin/cos/tan 之前试探 */
const FUNCS = ['sqrt', 'asin', 'acos', 'atan', 'sin', 'cos', 'tan', 'log', 'inv', 'ln']

function canEndValue(t) {
  if (!t) return false
  if (t.type === 'num' || t.type === 'var' || t.type === 'const' || t.type === 'post') return true
  if (t.type === 'abs') return t.role === 'close'
  if (t.type === 'paren') return t.value === ')'
  return false
}

function canStartValue(t) {
  if (t.type === 'num' || t.type === 'var' || t.type === 'const' || t.type === 'fn') return true
  if (t.type === 'abs') return t.role === 'open'
  if (t.type === 'paren') return t.value === '('
  return false
}

/** 小数/整数原文 -> 精确有理数；支持科学计数法；超出安全整数时返回 null */
function numberToQ(raw) {
  let mantissaStr = raw
  let exp = 0
  const ePos = raw.search(/[eE]/)
  if (ePos >= 0) {
    mantissaStr = raw.slice(0, ePos)
    exp = parseInt(raw.slice(ePos + 1), 10)
    if (!isFinite(exp)) return null
  }
  const dot = mantissaStr.indexOf('.')
  let num
  let den
  if (dot < 0) {
    num = Number(mantissaStr)
    den = 1
  } else {
    const ip = mantissaStr.slice(0, dot) || '0'
    const fp = mantissaStr.slice(dot + 1)
    if (fp.length > 15) return null
    den = Math.pow(10, fp.length)
    num = Number(ip + fp)
  }
  if (!isFinite(num) || !isFinite(den)) return null
  if (!fraction.isSafeInt(num) || !fraction.isSafeInt(den) || den <= 0) return null

  if (exp >= 0) {
    if (exp > 15) return null
    const mult = Math.pow(10, exp)
    const newNum = fraction.safeMul(num, mult)
    if (newNum === null) return null
    num = newNum
  } else {
    const absExp = -exp
    if (absExp > 15) return null
    const mult = Math.pow(10, absExp)
    const newDen = fraction.safeMul(den, mult)
    if (newDen === null) return null
    den = newDen
  }
  try {
    return fraction.make(num, den)
  } catch (e) {
    return null
  }
}

function tokenize(input) {
  const src = String(input || '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/√/g, 'sqrt')
  const tokens = []
  let i = 0
  let barOpen = false

  function push(tok) {
    const prev = tokens.length ? tokens[tokens.length - 1] : null
    if (prev && canEndValue(prev) && canStartValue(tok)) tokens.push({ type: 'op', value: '*' })
    tokens.push(tok)
  }

  while (i < src.length) {
    const ch = src[i]
    if (ch === ' ') {
      i++
      continue
    }

    if (/[0-9.]/.test(ch)) {
      let j = i
      let dots = 0
      while (j < src.length && /[0-9.]/.test(src[j])) {
        if (src[j] === '.') dots++
        j++
      }
      if (dots > 1) throw new Error('bad number')

      // 检查科学计数法：紧随其后的 e/E 且带可选正负号和至少一位数字
      if (j < src.length && (src[j] === 'e' || src[j] === 'E')) {
        let k = j + 1
        if (k < src.length && (src[k] === '+' || src[k] === '-')) {
          k++
        }
        if (k < src.length && /[0-9]/.test(src[k])) {
          while (k < src.length && /[0-9]/.test(src[k])) {
            k++
          }
          j = k
        }
      }

      const raw = src.slice(i, j)
      if (raw === '.') throw new Error('bad number')
      const valNum = Number(raw)
      if (!isFinite(valNum)) throw new Error('not finite')
      const q = numberToQ(raw)
      push({ type: 'num', value: q ? q.num / q.den : valNum, q: q })
      i = j
      continue
    }

    let fn = null
    for (let k = 0; k < FUNCS.length; k++) {
      const name = FUNCS[k]
      if (src.slice(i, i + name.length) === name) {
        fn = name
        break
      }
    }
    if (fn) {
      push({ type: 'fn', value: fn })
      i += fn.length
      continue
    }

    if (ch === 'π') {
      push({ type: 'const', value: 'π', v: Math.PI })
      i++
      continue
    }
    if (ch === 'e') {
      push({ type: 'const', value: 'e', v: Math.E })
      i++
      continue
    }

    if (ch === 'x' || ch === 'y' || ch === 'z') {
      push({ type: 'var', value: ch })
      i++
      continue
    }

    if (src.slice(i, i + 2) === '>=' || src.slice(i, i + 2) === '<=') {
      push({ type: 'rel', value: src.slice(i, i + 2) })
      i += 2
      continue
    }
    if (ch === '=' || ch === '>' || ch === '<') {
      push({ type: 'rel', value: ch })
      i++
      continue
    }
    if (ch === ';' || ch === '\n') {
      push({ type: 'sep', value: ';' })
      i++
      continue
    }
    if (ch === '|') {
      push({ type: 'abs', value: '|', role: barOpen ? 'close' : 'open' })
      barOpen = !barOpen
      i++
      continue
    }
    if (ch === '!') {
      push({ type: 'post', value: '!' })
      i++
      continue
    }
    if (ch === '%') {
      push({ type: 'post', value: '%' })
      i++
      continue
    }
    if (ch === '°') {
      push({ type: 'post', value: '°' })
      i++
      continue
    }
    if (ch === '(' || ch === ')') {
      push({ type: 'paren', value: ch })
      i++
      continue
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^') {
      push({ type: 'op', value: ch })
      i++
      continue
    }
    throw new Error('bad char')
  }
  return tokens
}

// ---------- 语法 ----------

function makeParser(tokens, opts) {
  let pos = 0
  const isDeg = !!(opts && opts.deg)

  function peek() {
    return tokens[pos]
  }
  function take() {
    return tokens[pos++]
  }

  function expr() {
    let v = term()
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = take().value
      const r = term()
      v = op === '+' ? add(v, r) : sub(v, r)
    }
    return v
  }

  function term() {
    let v = unary()
    while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = take().value
      const r = unary()
      v = op === '*' ? mul(v, r) : div(v, r)
    }
    return v
  }

  function unary() {
    if (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = take().value
      const v = unary()
      return op === '-' ? neg(v) : v
    }
    return power()
  }

  /** ^ 高于乘除，右结合：2^3^2 = 2^(3^2) = 512 */
  function power() {
    let v = postfix()
    if (peek() && peek().type === 'op' && peek().value === '^') {
      take()
      const r = unary()
      v = pow(v, r)
    }
    return v
  }

  /** %, !, ° 都是后缀，可连用 */
  function postfix() {
    let v = primary()
    while (peek() && peek().type === 'post') {
      const t = take().value
      if (t === '%') v = div(v, qv(100, 1))
      else if (t === '°') v = markDeg(v)
      else v = fact(v)
    }
    return v
  }

  function primary() {
    const t = peek()
    if (!t) throw new Error('unexpected end')

    if (t.type === 'num') {
      take()
      return t.q ? wrapQ(t.q) : fv(t.value)
    }

    if (t.type === 'const') {
      take()
      return fv(t.v)
    }

    if (t.type === 'var') throw new Error('variable')

    if (t.type === 'paren' && t.value === '(') {
      take()
      const v = expr()
      const close = take()
      if (!close || close.value !== ')') throw new Error('missing )')
      return v
    }

    if (t.type === 'abs') {
      if (t.role !== 'open') throw new Error('bad bar')
      let close = -1
      for (let k = pos + 1; k < tokens.length; k++) {
        if (tokens[k].type === 'abs') {
          if (tokens[k].role !== 'close') throw new Error('nested abs')
          close = k
          break
        }
      }
      if (close < 0) throw new Error('missing |')
      const inner = tokens.slice(pos + 1, close)
      if (!inner.length) throw new Error('missing |')
      let v
      try {
        v = run(inner, opts)
      } catch (e) {
        if (e.message === 'bad bar' || e.message === 'nested abs') throw new Error('nested abs')
        throw e
      }
      pos = close + 1
      return absV(v)
    }

    if (t.type === 'fn') {
      take()
      const name = t.value
      if (name === 'sqrt') return sqrtV(unary())
      const open = take()
      if (!open || open.value !== '(') throw new Error('missing (')
      const inner = expr()
      const close = take()
      if (!close || close.value !== ')') throw new Error('missing )')
      if (name === 'inv') return inv(inner)
      if (name === 'sin') return fv(Math.sin(argRad(inner, isDeg)))
      if (name === 'cos') return fv(Math.cos(argRad(inner, isDeg)))
      if (name === 'tan') return fv(Math.tan(argRad(inner, isDeg)))
      if (name === 'asin' || name === 'acos' || name === 'atan') {
        const n = toNumber(inner)
        if ((name === 'asin' || name === 'acos') && (n < -1 || n > 1)) {
          throw new Error(name + ' domain')
        }
        let radVal = name === 'asin' ? Math.asin(n) : name === 'acos' ? Math.acos(n) : Math.atan(n)
        if (isDeg) {
          radVal = (radVal * 180) / Math.PI
        }
        return fv(radVal)
      }
      const n = toNumber(inner)
      if (n <= 0) throw new Error('log domain')
      return fv(name === 'log' ? Math.log10(n) : Math.log(n))
    }

    throw new Error('unexpected token')
  }

  return {
    expr,
    expectEnd() {
      if (pos !== tokens.length) throw new Error('extra token')
    },
    pos() {
      return pos
    },
    tokens() {
      return tokens
    }
  }
}

function run(tokens, opts) {
  const p = makeParser(tokens, opts)
  const v = p.expr()
  p.expectEnd()
  return v
}

// ---------- 对外 ----------

/** 求值并返回 Val（精确优先） */
function evaluateVal(input, opts) {
  const tokens = tokenize(input)
  if (!tokens.length) throw new Error('empty')
  const v = run(tokens, opts)
  if (!isFinite(toNumber(v))) throw new Error('not finite')
  return v
}

/** 旧契约：返回 Number */
function evaluate(input, opts) {
  return toNumber(evaluateVal(input, opts))
}

/** 纯小数/科学计数法格式化（原 format 主体，行为保持不变） */
function formatNumber(n) {
  if (typeof n !== 'number' || isNaN(n) || !isFinite(n)) return '错误'
  const abs = Math.abs(n)
  if (abs !== 0 && (abs >= 1e10 || abs < 1e-6)) {
    return n.toExponential(6).replace(/\.?0+e/, 'e')
  }
  let s = n.toFixed(8)
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '')
  if (s === '-0') s = '0'
  return s
}

/**
 * 格式化结果。
 * @param {Number|Val} result 兼容旧的「直接传 Number」调用
 * @param {{fracOn?:boolean}} [opts] fracOn=true 时有理数或根式优先精确显示（统一假分数，不做带分数）
 */
function format(result, opts) {
  const fracOn = !!(opts && opts.fracOn)
  if (typeof result === 'number') return formatNumber(result)
  if (!result || (result.k !== 'q' && result.k !== 'f' && result.k !== 'r')) return '错误'
  if (result.k === 'q') {
    if (result.den === 1) return String(result.num)
    if (fracOn) return result.num + '/' + result.den
    return formatNumber(result.num / result.den)
  }
  if (result.k === 'r') {
    if (fracOn) return radical.format(result)
    return formatNumber(radical.toNumber(result))
  }
  return formatNumber(result.v)
}

/** 会被整块删除的多字符尾巴，按长度降序 */
const MULTI = [
  'sqrt(',
  'asin(',
  'acos(',
  'atan(',
  'sin(',
  'cos(',
  'tan(',
  'log(',
  'inv(',
  'ln(',
  '>=',
  '<='
].sort((a, b) => b.length - a.length)

/** 退格：命中多字符块就整块删，否则删 1 个字符（√ 是单字符，不在表里） */
function backspaceToken(s) {
  const str = String(s || '')
  for (let i = 0; i < MULTI.length; i++) {
    const m = MULTI[i]
    if (str.length >= m.length && str.slice(str.length - m.length) === m) {
      return str.slice(0, str.length - m.length)
    }
  }
  return str.slice(0, str.length - 1)
}

/** 是否像方程/不等式/方程组：含变量或关系符或分句符 */
function looksLikeEquation(s) {
  return /[xyz]|>=|<=|[=<>;\n]/.test(String(s || ''))
}

export default {
  evaluate,
  evaluateVal,
  format,
  formatNumber,
  tokenize,
  backspaceToken,
  looksLikeEquation,
  val,
  MULTI
}
