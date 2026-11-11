/**
 * 表达式求值：+ - * / % ^、括号、一元正负号、开方、ln/log/倒数/绝对值/阶乘。
 * 递归下降，不依赖 eval。
 *
 * L5 精确化：内部统一用 Val 表示数值
 *   Val = { k:'q', num, den }   精确有理数（已约分）
 *       | { k:'f', v }          浮点回退
 * 只有两边都是 q 且不溢出时才走 fraction.*；任一侧已是 f 就全程保持 f，
 * 绝不把浮点结果伪装成有理数（假精确比不准更糟）。
 *
 * 最关键的一点：**小数必须转成有理数**。0.125 要变成 1/8 而不是 parseFloat，
 * 否则 0.1+0.2 仍是 0.30000000000000004，「全程精确」直接失效。
 */
import fraction from './fraction.js'

// ---------- Val 基础操作 ----------

function qv(num, den) {
  const f = fraction.make(num, den)
  return { k: 'q', num: f.num, den: f.den }
}

/** fraction 的 {num,den} 包装成 Val */
function wrapQ(f) {
  return { k: 'q', num: f.num, den: f.den }
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

function isZero(a) {
  if (!a) return false
  return a.k === 'q' ? a.num === 0 : a.v === 0
}

function isIntVal(a) {
  return isQ(a) && a.den === 1
}

function toNumber(a) {
  if (!a) return NaN
  return a.k === 'q' ? a.num / a.den : a.v
}

/** 转浮点 Val（一旦降级就不再回退精确） */
function toF(a) {
  return a.k === 'f' ? a : fv(a.num / a.den)
}

function fromNum(n) {
  if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n) return fv(n)
  if (Math.abs(n) > fraction.MAX_SAFE) return fv(n)
  return { k: 'q', num: n, den: 1 }
}

function add(a, b) {
  if (a.k === 'q' && b.k === 'q') {
    const r = fraction.add(a, b)
    if (r) return wrapQ(r)
  }
  return fv(toNumber(a) + toNumber(b))
}

function sub(a, b) {
  if (a.k === 'q' && b.k === 'q') {
    const r = fraction.sub(a, b)
    if (r) return wrapQ(r)
  }
  return fv(toNumber(a) - toNumber(b))
}

function mul(a, b) {
  if (a.k === 'q' && b.k === 'q') {
    const r = fraction.mul(a, b)
    if (r) return wrapQ(r)
  }
  return fv(toNumber(a) * toNumber(b))
}

function div(a, b) {
  if (a.k === 'q' && b.k === 'q') {
    if (b.num === 0) throw new Error('divide by zero')
    const r = fraction.div(a, b)
    if (r) return wrapQ(r)
  }
  const d = toNumber(b)
  if (d === 0) throw new Error('divide by zero')
  return fv(toNumber(a) / d)
}

function pow(a, b) {
  if (a.k === 'q' && b.k === 'q' && b.den === 1 && Math.abs(b.num) <= 4096) {
    const r = fraction.pow(a, b.num)
    if (r) return wrapQ(r)
  }
  return fv(Math.pow(toNumber(a), toNumber(b)))
}

function neg(a) {
  return a.k === 'q' ? { k: 'q', num: -a.num, den: a.den } : fv(-a.v)
}

function absV(a) {
  return a.k === 'q' ? { k: 'q', num: Math.abs(a.num), den: a.den } : fv(Math.abs(a.v))
}

function inv(a) {
  if (a.k === 'q') {
    if (a.num === 0) throw new Error('divide by zero')
    return wrapQ(fraction.inv(a))
  }
  if (a.v === 0) throw new Error('divide by zero')
  return fv(1 / a.v)
}

/** 开方：分子分母都是完全平方数才精确（√4=2、√(1/4)=1/2），否则浮点 */
function sqrtV(a) {
  const n = toNumber(a)
  if (n < 0) throw new Error('sqrt negative')
  if (a.k === 'q') {
    const r = fraction.sqrt(a)
    if (r) return wrapQ(r)
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
  isQ
}

// ---------- 词法 ----------

/** 多字符单词按最长匹配；sqrt(4) 必须在 ln(2) 之前试探 */
const FUNCS = ['sqrt', 'log', 'inv', 'ln']

function canEndValue(t) {
  if (!t) return false
  if (t.type === 'num' || t.type === 'var' || t.type === 'post') return true
  if (t.type === 'abs') return t.role === 'close'
  if (t.type === 'paren') return t.value === ')'
  return false
}

function canStartValue(t) {
  if (t.type === 'num' || t.type === 'var' || t.type === 'fn') return true
  if (t.type === 'abs') return t.role === 'open'
  if (t.type === 'paren') return t.value === '('
  return false
}

/** 小数/整数原文 -> 精确有理数；超出安全整数时返回 null（上层用浮点） */
function numberToQ(raw) {
  const dot = raw.indexOf('.')
  let num
  let den
  if (dot < 0) {
    num = Number(raw)
    den = 1
  } else {
    const ip = raw.slice(0, dot) || '0'
    const fp = raw.slice(dot + 1)
    if (fp.length > 15) return null
    den = Math.pow(10, fp.length)
    num = Number(ip + fp)
  }
  if (!isFinite(num) || !isFinite(den)) return null
  if (!fraction.isSafeInt(num) || !fraction.isSafeInt(den) || den <= 0) return null
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
      const raw = src.slice(i, j)
      if (raw === '.') throw new Error('bad number')
      const q = numberToQ(raw)
      push({ type: 'num', value: q ? q.num / q.den : Number(raw), q: q })
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
    if (ch === ';') {
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

function makeParser(tokens) {
  let pos = 0

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

  /** ^ 与 * / 同级左结合（沿用既有语义：2^3^2 = 64） */
  function term() {
    let v = unary()
    while (
      peek() &&
      peek().type === 'op' &&
      (peek().value === '*' || peek().value === '/' || peek().value === '^')
    ) {
      const op = take().value
      const r = unary()
      if (op === '*') v = mul(v, r)
      else if (op === '/') v = div(v, r)
      else v = pow(v, r)
    }
    return v
  }

  function unary() {
    if (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = take().value
      const v = unary()
      return op === '-' ? neg(v) : v
    }
    return postfix()
  }

  /** % 与 ! 都是后缀，可连用 */
  function postfix() {
    let v = primary()
    while (peek() && peek().type === 'post') {
      const t = take().value
      if (t === '%') v = div(v, qv(100, 1))
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
        v = run(inner)
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

function run(tokens) {
  const p = makeParser(tokens)
  const v = p.expr()
  p.expectEnd()
  return v
}

// ---------- 对外 ----------

/** 求值并返回 Val（精确优先） */
function evaluateVal(input) {
  const tokens = tokenize(input)
  if (!tokens.length) throw new Error('empty')
  const v = run(tokens)
  if (!isFinite(toNumber(v))) throw new Error('not finite')
  return v
}

/** 旧契约：返回 Number */
function evaluate(input) {
  return toNumber(evaluateVal(input))
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
 * @param {{fracOn?:boolean}} [opts] fracOn=true 时有理数优先显示 a/b（统一假分数，不做带分数）
 */
function format(result, opts) {
  const fracOn = !!(opts && opts.fracOn)
  if (typeof result === 'number') return formatNumber(result)
  if (!result || (result.k !== 'q' && result.k !== 'f')) return '错误'
  if (result.k === 'q') {
    if (result.den === 1) return String(result.num)
    if (fracOn) return result.num + '/' + result.den
    return formatNumber(result.num / result.den)
  }
  return formatNumber(result.v)
}

/** 会被整块删除的多字符尾巴，按长度降序 */
const MULTI = ['sqrt(', 'log(', 'inv(', 'ln(', '>=', '<='].sort((a, b) => b.length - a.length)

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
  return /[xyz]|>=|<=|[=<>;]/.test(String(s || ''))
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
