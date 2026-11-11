/**
 * 符号多项式：把表达式变成「系数 × 变量幂积」的稀疏表示，供 solver 求根。
 *
 * Poly = {
 *   vars: ['x'] | ['x','y'] | ['x','y','z'],   // 固定顺序 x < y < z
 *   n: vars.length,
 *   terms: Map<key, Val>,                      // key = 各变量指数用 ',' 拼接，如 3 元时 '2,0,0' 表示 x^2
 *   degree: 各 key 指数和的最大值,
 *   kind: 'poly'
 * }
 *
 * 系数直接用 calc 的 Val（精确有理数优先），所以 1/3 x = 2 能解出精确的 6。
 * 词法完全复用 calc.tokenize（calc 是 default export 对象，必须 calc.tokenize 调用）。
 *
 * 不支持的形式一律 throw 中文错误：次数不是非负整数、变量在分母、函数/阶乘/绝对值参与运算。
 */
import calc from './calc.js'

const V = calc.val

function keyOf(vec) {
  return vec.join(',')
}

function vecOf(key, n) {
  if (n === 0) return []
  return key.split(',').map(Number)
}

function makePoly(vars) {
  return { vars: vars.slice(), n: vars.length, terms: new Map(), degree: 0, kind: 'poly' }
}

function finalize(p) {
  let deg = 0
  p.terms.forEach((v, k) => {
    const vec = vecOf(k, p.n)
    let s = 0
    for (let i = 0; i < vec.length; i++) s += vec[i]
    if (s > deg) deg = s
  })
  p.degree = deg
  return p
}

function addTerm(p, key, v) {
  if (!v || V.isZero(v)) return
  const cur = p.terms.get(key)
  const nv = cur ? V.add(cur, v) : v
  if (V.isZero(nv)) p.terms.delete(key)
  else p.terms.set(key, nv)
}

/** 常量多项式（所有指数为 0），空多项式的常量项是 0 */
function isConst(p) {
  let ok = true
  p.terms.forEach((v, k) => {
    const vec = vecOf(k, p.n)
    for (let i = 0; i < vec.length; i++) if (vec[i] !== 0) ok = false
  })
  return ok
}

function constOf(p) {
  const vec = []
  for (let i = 0; i < p.n; i++) vec.push(0)
  const v = p.terms.get(keyOf(vec))
  return v || V.zero()
}

function coeff(p, vec) {
  const v = p.terms.get(keyOf(vec))
  return v || V.zero()
}

function polyConst(value, vars) {
  const p = makePoly(vars)
  const vec = []
  for (let i = 0; i < p.n; i++) vec.push(0)
  addTerm(p, keyOf(vec), value)
  return finalize(p)
}

function polyVar(index, vars) {
  const p = makePoly(vars)
  const vec = []
  for (let i = 0; i < p.n; i++) vec.push(i === index ? 1 : 0)
  addTerm(p, keyOf(vec), V.one())
  return finalize(p)
}

function add(a, b) {
  if (a.n !== b.n) throw new Error('变量不一致')
  const p = makePoly(a.vars)
  a.terms.forEach((v, k) => addTerm(p, k, v))
  b.terms.forEach((v, k) => addTerm(p, k, v))
  return finalize(p)
}

function negPoly(a) {
  const p = makePoly(a.vars)
  a.terms.forEach((v, k) => addTerm(p, k, V.neg(v)))
  return finalize(p)
}

function sub(a, b) {
  return add(a, negPoly(b))
}

function mul(a, b) {
  if (a.n !== b.n) throw new Error('变量不一致')
  const p = makePoly(a.vars)
  a.terms.forEach((av, ak) => {
    b.terms.forEach((bv, bk) => {
      const va = vecOf(ak, a.n)
      const vb = vecOf(bk, b.n)
      const vec = []
      for (let i = 0; i < va.length; i++) vec.push(va[i] + vb[i])
      addTerm(p, keyOf(vec), V.mul(av, bv))
    })
  })
  return finalize(p)
}

function powPoly(a, k) {
  let p = polyConst(V.one(), a.vars)
  for (let i = 0; i < k; i++) p = mul(p, a)
  return p
}

/** 收集一段 token 里出现过的变量，固定按 x < y < z 排序 */
function scanVars(tokens) {
  const seen = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'var' && seen.indexOf(t.value) < 0) seen.push(t.value)
  }
  seen.sort((a, b) => 'xyz'.indexOf(a) - 'xyz'.indexOf(b))
  return seen
}

function unionVars(list) {
  const seen = []
  for (let i = 0; i < list.length; i++) {
    const vs = scanVars(list[i])
    for (let j = 0; j < vs.length; j++) if (seen.indexOf(vs[j]) < 0) seen.push(vs[j])
  }
  seen.sort((a, b) => 'xyz'.indexOf(a) - 'xyz'.indexOf(b))
  return seen
}

/**
 * token 序列 -> 多项式
 * @param {Array} tokens
 * @param {Array<string>} [varsOpt] 固定的变量表（多 clause 求解时必须统一，否则 key 维度不一致）
 */
function parsePolyTokens(tokens, varsOpt) {
  const vars = varsOpt && varsOpt.length ? varsOpt.slice() : scanVars(tokens)
  const n = vars.length
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

  // 与 calc.js 有意不同：符号求解按数学惯例让 ^ 高于 * /，否则 2x^2 会被读成 (2x)^2 = 4x^2。
  // calc.js 的数值求值保持旧的左结合（2^3^2 = 64），两处语义分别由两份单测固定。
  function term() {
    let v = unary()
    while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = take().value
      const r = unary()
      if (op === '*') v = mul(v, r)
      else v = divByConst(v, r)
    }
    return v
  }

  function unary() {
    if (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = take().value
      const v = unary()
      return op === '-' ? negPoly(v) : v
    }
    return power()
  }

  /** 右结合幂：x^2^3 = x^(2^3) */
  function power() {
    const base = postfix()
    if (peek() && peek().type === 'op' && peek().value === '^') {
      take()
      return powerOf(base, unary())
    }
    return base
  }

  function postfix() {
    let v = primary()
    while (peek() && peek().type === 'post') {
      const t = take().value
      if (t === '%') v = divByConst(v, polyConst(V.q(100, 1), vars))
      else throw new Error('不支持阶乘')
    }
    return v
  }

  function primary() {
    const t = peek()
    if (!t) throw new Error('语法错误')
    if (t.type === 'num') {
      take()
      return polyConst(t.q ? V.fromQ(t.q) : V.f(t.value), vars)
    }
    if (t.type === 'var') {
      take()
      const idx = vars.indexOf(t.value)
      if (idx < 0) throw new Error('未知变量')
      return polyVar(idx, vars)
    }
    if (t.type === 'paren' && t.value === '(') {
      take()
      const v = expr()
      const close = take()
      if (!close || close.value !== ')') throw new Error('括号不匹配')
      return v
    }
    if (t.type === 'fn') throw new Error('不支持函数')
    if (t.type === 'abs') throw new Error('不支持绝对值')
    throw new Error('语法错误')
  }

  function divByConst(a, b) {
    if (!isConst(b)) throw new Error('变量不能在分母')
    const c = constOf(b)
    if (V.isZero(c)) throw new Error('除以零')
    const p = makePoly(a.vars)
    a.terms.forEach((v, k) => addTerm(p, k, V.div(v, c)))
    return finalize(p)
  }

  function powerOf(base, e) {
    if (!isConst(e)) throw new Error('指数含变量')
    const c = constOf(e)
    if (!V.isInt(c)) throw new Error('指数须为整数')
    const k = V.toNumber(c)
    if (k < 0) throw new Error('次数为负')
    if (k > 32) throw new Error('次数超过 2')
    return powPoly(base, k)
  }

  const p = expr()
  if (pos !== tokens.length) throw new Error('语法错误')
  return p
}

function parsePoly(text, varsOpt) {
  return parsePolyTokens(calc.tokenize(text), varsOpt)
}

/** 整段 token 是否恰好是一个括号组，是则返回内部 token */
function wholeParen(tokens) {
  if (!tokens.length || tokens[0].type !== 'paren' || tokens[0].value !== '(') return null
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type !== 'paren') continue
    depth += t.value === '(' ? 1 : -1
    if (depth === 0) return i === tokens.length - 1 ? tokens.slice(1, i) : null
  }
  return null
}

/** 单个操作数：单 token，或被一对括号完整包住 */
function simpleOperand(tokens) {
  if (tokens.length === 1 && (tokens[0].type === 'num' || tokens[0].type === 'var')) return tokens
  return wholeParen(tokens)
}

function splitTopPow(tokens) {
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'paren') {
      depth += t.value === '(' ? 1 : -1
      continue
    }
    if (t.type === 'op' && t.value === '^' && depth === 0) {
      if (i === 0 || i === tokens.length - 1) return null
      return { base: tokens.slice(0, i), exp: tokens.slice(i + 1) }
    }
  }
  return null
}

/**
 * 识别指数形式 a^(kx+m) / a^b。
 * 底与指数都必须是「单个操作数」，否则 2^x+1 会被误读成 2^(x+1)。
 * @returns {{base:Val, exp:Poly, hasVar:boolean}|null}
 */
function detectPower(tokens, varsOpt) {
  const parts = splitTopPow(tokens)
  if (!parts) return null
  const baseToks = simpleOperand(parts.base)
  const expToks = simpleOperand(parts.exp)
  if (!baseToks || !expToks) return null
  const vars = varsOpt && varsOpt.length ? varsOpt : scanVars(tokens)
  let base
  let exp
  try {
    base = parsePolyTokens(baseToks, vars)
    exp = parsePolyTokens(expToks, vars)
  } catch (e) {
    return null
  }
  if (!isConst(base)) return null
  return { base: constOf(base), exp: exp, hasVar: exp.terms.size > 0 }
}

export default {
  parsePoly,
  parsePolyTokens,
  add,
  sub,
  mul,
  neg: negPoly,
  pow: powPoly,
  constOf,
  coeff,
  isConst,
  polyConst,
  polyVar,
  degree: (p) => p.degree,
  vars: scanVars,
  unionVars,
  detectPower,
  wholeParen,
  simpleOperand
}
