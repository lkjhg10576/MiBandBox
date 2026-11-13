/**
 * 方程 / 不等式求解器：把键盘拼出来的表达式串直接解出来。
 *
 * 语法：input := clause (';' clause)*，clause := expr rel expr
 *       rel := '=' | '>' | '<' | '>=' | '<='
 *
 * 支持 10 类：
 *   一次方程 / 二次方程 / 二元一次方程组 / 三元一次方程组
 *   一次不等式 / 二次不等式 / 一次不等式组 / 绝对值不等式
 *   指数方程 / 对数方程
 *
 * 两个「无解」必须分开（产品决策 5）：
 *   - noSolution=true  -> 页面只显示裸文字「无解」，不进结果卡
 *   - Δ<0 的二次方程     -> 进结果卡，写「无实数根」
 *
 * 绝不抛未捕获异常：所有病态输入都收敛成 error 字符串或 noSolution，
 * 否则页面会黑屏（见 calculator.ux 的 doSolve）。
 */
import calc from './calc.js'
import fraction from './fraction.js'
import poly from './poly.js'

const V = calc.val

// ---------- 结果封装 ----------

function R(kind, noSolution, lines, raw) {
  return {
    kind: kind,
    noSolution: !!noSolution,
    lines: noSolution ? [] : lines,
    error: null,
    raw: raw || null
  }
}

function fail(msg) {
  return { kind: 'error', noSolution: false, lines: [], error: msg, raw: null }
}

/** 认识的中文提示原样透给 Toast，其余（英文异常、TypeError）收敛成一句人话 */
const MESSAGES = [
  '语法错误',
  '括号不匹配',
  '缺少关系符',
  '每段一个关系符',
  '语法错误',
  '输入为空',
  '未知变量',
  '变量不一致',
  '变量不能在分母',
  '除以零',
  '指数含变量',
  '指数须为整数',
  '次数为负',
  '次数超过 2',
  '不支持阶乘',
  '不支持函数',
  '不支持绝对值',
  '不支持嵌套绝对值',
  '不支持这种形式',
  '底数须为正且非 1',
  '方程与不等式不能混用',
  '方程组只支持一次',
  '一元方程最多 1 个未知数',
  '一元不等式最多 1 个未知数',
  '未知数最多 3 个'
]

function shortError(e) {
  const msg = e && e.message ? String(e.message) : ''
  for (let i = 0; i < MESSAGES.length; i++) if (MESSAGES[i] === msg) return msg
  return '不支持这种形式'
}

function fmt(v, fracOn) {
  return calc.format(v, { fracOn: fracOn })
}

// ---------- 区间集合 ----------

const NEG = { k: 'inf', s: -1 }
const POS = { k: 'inf', s: 1 }

function numOf(v) {
  if (!v) return NaN
  if (v.k === 'inf') return v.s > 0 ? Infinity : -Infinity
  return V.toNumber(v)
}

function cmpV(a, b) {
  const x = numOf(a)
  const y = numOf(b)
  if (x < y) return -1
  if (x > y) return 1
  return 0
}

function iv(lo, hi, loOpen, hiOpen) {
  return { lo: lo, hi: hi, loOpen: loOpen, hiOpen: hiOpen }
}

function allIv() {
  return iv(NEG, POS, true, true)
}

function intersect(a, b) {
  if (!a || !b) return null
  let lo
  let loOpen
  const cl = cmpV(a.lo, b.lo)
  if (cl > 0) {
    lo = a.lo
    loOpen = a.loOpen
  } else if (cl < 0) {
    lo = b.lo
    loOpen = b.loOpen
  } else {
    lo = a.lo
    loOpen = a.loOpen || b.loOpen
  }
  let hi
  let hiOpen
  const ch = cmpV(a.hi, b.hi)
  if (ch < 0) {
    hi = a.hi
    hiOpen = a.hiOpen
  } else if (ch > 0) {
    hi = b.hi
    hiOpen = b.hiOpen
  } else {
    hi = a.hi
    hiOpen = a.hiOpen || b.hiOpen
  }
  const c = cmpV(lo, hi)
  if (c > 0) return null
  if (c === 0 && (loOpen || hiOpen)) return null
  return iv(lo, hi, loOpen, hiOpen)
}

/** 相邻/重叠则合并，否则返回 null */
function merge(a, b) {
  if (!a) return b
  if (!b) return a
  let x = a
  let y = b
  if (cmpV(x.lo, y.lo) > 0) {
    x = b
    y = a
  }
  const c = cmpV(x.hi, y.lo)
  if (c < 0) return null
  if (c === 0 && (x.hiOpen || y.loOpen)) return null
  const hc = cmpV(x.hi, y.hi)
  const hi = hc >= 0 ? x.hi : y.hi
  const hiOpen = hc > 0 ? x.hiOpen : hc < 0 ? y.hiOpen : x.hiOpen || y.hiOpen
  return iv(x.lo, hi, x.loOpen, hiOpen)
}

function normList(list) {
  const arr = []
  for (let i = 0; i < list.length; i++) if (list[i]) arr.push(list[i])
  arr.sort(function (a, b) {
    return cmpV(a.lo, b.lo)
  })
  const out = []
  for (let i = 0; i < arr.length; i++) {
    if (!out.length) {
      out.push(arr[i])
      continue
    }
    const m = merge(out[out.length - 1], arr[i])
    if (m) out[out.length - 1] = m
    else out.push(arr[i])
  }
  return out
}

function interAll(lists) {
  let acc = [allIv()]
  for (let i = 0; i < lists.length; i++) {
    const next = []
    for (let a = 0; a < acc.length; a++) {
      for (let b = 0; b < lists[i].length; b++) {
        const r = intersect(acc[a], lists[i][b])
        if (r) next.push(r)
      }
    }
    acc = normList(next)
    if (!acc.length) return []
  }
  return acc
}

function isAll(list) {
  return list.length === 1 && cmpV(list[0].lo, NEG) === 0 && cmpV(list[0].hi, POS) === 0
}

// ---------- 文案 ----------

function epText(v, fracOn) {
  if (v.k === 'inf') return v.s > 0 ? '+inf' : '-inf'
  return fmt(v, fracOn)
}

function ivText(i, fracOn) {
  return (i.loOpen ? '(' : '[') + epText(i.lo, fracOn) + ', ' + epText(i.hi, fracOn) + (i.hiOpen ? ')' : ']')
}

/** 区间集合文案；空集返回 null（调用方转成「无解」） */
function setText(list, fracOn) {
  if (!list.length) return null
  if (isAll(list)) return '全体实数'
  const parts = []
  for (let i = 0; i < list.length; i++) parts.push(ivText(list[i], fracOn))
  return parts.join(' U ')
}

/** 绝对值的自然语言写法：x < -1 或 x > 2 / -2 < x < 2 */
function oneDesc(i, fracOn) {
  const loInf = cmpV(i.lo, NEG) === 0
  const hiInf = cmpV(i.hi, POS) === 0
  if (loInf && hiInf) return '全体实数'
  if (loInf) return 'x ' + (i.hiOpen ? '<' : '<=') + ' ' + epText(i.hi, fracOn)
  if (hiInf) return 'x ' + (i.loOpen ? '>' : '>=') + ' ' + epText(i.lo, fracOn)
  if (cmpV(i.lo, i.hi) === 0) return 'x = ' + epText(i.lo, fracOn)
  return (
    epText(i.lo, fracOn) +
    ' ' +
    (i.loOpen ? '<' : '<=') +
    ' x ' +
    (i.hiOpen ? '<' : '<=') +
    ' ' +
    epText(i.hi, fracOn)
  )
}

function descText(list, fracOn) {
  if (!list.length) return null
  const parts = []
  for (let i = 0; i < list.length; i++) parts.push(oneDesc(list[i], fracOn))
  return parts.join(' 或 ')
}

// ---------- 求根 ----------

/**
 * 一元多项式求根（次数 <= 2）
 * @returns {{kind:'const', isZero:boolean} | {kind:'linear', roots:[Val]} | {kind:'quadratic', real:boolean, roots:[Val], single:boolean}}
 */
function rootsOf(p) {
  const zeros = []
  for (let i = 0; i < p.n; i++) zeros.push(0)
  const a0 = poly.coeff(p, zeros)
  const one = zeros.slice()
  one[0] = 1
  const a1 = poly.coeff(p, one)
  if (p.n >= 1) {
    const two = zeros.slice()
    two[0] = 2
    const a2 = poly.coeff(p, two)
    if (!V.isZero(a2)) {
      const r = roots2(a2, a1, a0)
      if (!r.real) return { kind: 'quadratic', real: false, roots: [], single: false, disc: r.disc }
      return { kind: 'quadratic', real: true, roots: r.roots, single: !!r.single }
    }
  }
  if (!V.isZero(a1)) return { kind: 'linear', roots: [V.div(V.neg(a0), a1)] }
  return { kind: 'const', isZero: V.isZero(a0) }
}

function roots2(a, b, c) {
  const disc = V.sub(V.mul(b, b), V.mul(V.q(4, 1), V.mul(a, c)))
  const d = numOf(disc)
  if (d < 0) return { real: false, disc: disc }
  const twoA = V.mul(V.q(2, 1), a)
  if (d === 0) return { real: true, roots: [V.div(V.neg(b), twoA)], single: true, disc: disc }
  let s
  if (V.isQ(disc)) {
    // 保持 fraction.sqrt：完全平方才开出有理数，否则降级浮点，绝不能使用带根式的开方（后者会产生根式 r，符号求解器不支持）
    const ex = fraction.sqrt(disc)
    s = ex ? V.fromQ(ex) : V.f(Math.sqrt(d))
  } else {
    s = V.f(Math.sqrt(d))
  }
  const r1 = V.div(V.sub(V.neg(b), s), twoA)
  const r2 = V.div(V.add(V.neg(b), s), twoA)
  return { real: true, roots: numOf(r1) <= numOf(r2) ? [r1, r2] : [r2, r1], single: false, disc: disc }
}

/** 估算显示宽度：全角算 2 个单位、半角 1 个（14px 字号下 1 个单位约 6.5px） */
function units(s) {
  let n = 0
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i) > 0x2e80 ? 2 : 1
  return n
}

/** 两根并一行放不下就拆成两行（结果卡单行约 29 个单位） */
function twoRootLines(label, a, b) {
  const joined = a + '，' + b
  if (units(joined) <= 28) return [label, joined]
  return [label, a, b]
}

/** 一元方程根 -> 结果行（1~3 行，决策 6） */
function eqLines(r, label, fracOn) {
  if (r.kind === 'const') {
    if (r.isZero) return [label, '无穷多解']
    return null
  }
  if (r.kind === 'linear') return [label, 'x = ' + fmt(r.roots[0], fracOn)]
  if (!r.real) return [label, '无实数根']
  if (r.roots.length === 1) return [label, 'x = ' + fmt(r.roots[0], fracOn)]
  return twoRootLines(label, 'x1 = ' + fmt(r.roots[0], fracOn), 'x2 = ' + fmt(r.roots[1], fracOn))
}

// ---------- 单变量不等式 ----------

function relToIvs(rel, r) {
  if (rel === '>') return [iv(r, POS, true, true)]
  if (rel === '>=') return [iv(r, POS, false, true)]
  if (rel === '<') return [iv(NEG, r, true, true)]
  if (rel === '<=') return [iv(NEG, r, true, false)]
  return [iv(r, r, false, false)]
}

function flipRel(rel) {
  if (rel === '>') return '<'
  if (rel === '>=') return '<='
  if (rel === '<') return '>'
  if (rel === '<=') return '>='
  return '='
}

function holdConst(c, rel) {
  if (rel === '>') return c > 0
  if (rel === '>=') return c >= 0
  if (rel === '<') return c < 0
  if (rel === '<=') return c <= 0
  return c === 0
}

/** a*x + b rel 0 */
function linIneq(a, b, rel) {
  const av = numOf(a)
  if (av === 0) return holdConst(numOf(b), rel) ? [allIv()] : []
  const r = V.div(V.neg(b), a)
  return relToIvs(av > 0 ? rel : flipRel(rel), r)
}

/** a*x^2 + b*x + c rel 0 */
function quadIneq(a, b, c, rel) {
  const av = numOf(a)
  if (av === 0) return linIneq(b, c, rel)
  const root = roots2(a, b, c)
  const pos = av > 0
  if (!root.real) {
    const alwaysPos = pos
    const truth = alwaysPos ? rel === '>' || rel === '>=' : rel === '<' || rel === '<='
    return truth ? [allIv()] : []
  }
  if (root.single) {
    const r = root.roots[0]
    if (pos) {
      if (rel === '>') return [iv(NEG, r, true, true), iv(r, POS, true, true)]
      if (rel === '>=') return [allIv()]
      if (rel === '<') return []
      return [iv(r, r, false, false)]
    }
    if (rel === '>') return []
    if (rel === '>=') return [iv(r, r, false, false)]
    if (rel === '<') return [iv(NEG, r, true, true), iv(r, POS, true, true)]
    return [allIv()]
  }
  const r1 = root.roots[0]
  const r2 = root.roots[1]
  if (pos) {
    if (rel === '>') return [iv(NEG, r1, true, true), iv(r2, POS, true, true)]
    if (rel === '>=') return [iv(NEG, r1, true, false), iv(r2, POS, false, true)]
    if (rel === '<') return [iv(r1, r2, true, true)]
    if (rel === '<=') return [iv(r1, r2, false, false)]
    return [iv(r1, r1, false, false), iv(r2, r2, false, false)]
  }
  if (rel === '>') return [iv(r1, r2, true, true)]
  if (rel === '>=') return [iv(r1, r2, false, false)]
  if (rel === '<') return [iv(NEG, r1, true, true), iv(r2, POS, true, true)]
  if (rel === '<=') return [iv(NEG, r1, true, false), iv(r2, POS, false, true)]
  return [iv(r1, r1, false, false), iv(r2, r2, false, false)]
}

/** 一元多项式 P rel 0 的解集 */
function polyIneqSet(p, rel) {
  if (p.n === 0) return holdConst(numOf(poly.constOf(p)), rel) ? [allIv()] : []
  if (p.degree > 2) throw new Error('次数超过 2')
  const zeros = []
  for (let i = 0; i < p.n; i++) zeros.push(0)
  const a0 = poly.coeff(p, zeros)
  const one = zeros.slice()
  one[0] = 1
  const a1 = poly.coeff(p, one)
  const two = zeros.slice()
  two[0] = 2
  const a2 = poly.coeff(p, two)
  if (V.isZero(a2)) return linIneq(a1, a0, rel)
  return quadIneq(a2, a1, a0, rel)
}

// ---------- 结构识别 ----------

function hasAbs(tokens) {
  for (let i = 0; i < tokens.length; i++) if (tokens[i].type === 'abs') return true
  return false
}

/** 整段恰好是 |...| */
function bareAbs(tokens) {
  if (tokens.length < 3) return null
  if (tokens[0].type !== 'abs' || tokens[0].role !== 'open') return null
  const last = tokens[tokens.length - 1]
  if (last.type !== 'abs' || last.role !== 'close') return null
  for (let i = 1; i < tokens.length - 1; i++) {
    if (tokens[i].type === 'abs') throw new Error('不支持嵌套绝对值')
  }
  return tokens.slice(1, tokens.length - 1)
}

/** 整段恰好是 log(...) / ln(...) */
function logCall(tokens) {
  if (!tokens.length) return null
  const t0 = tokens[0]
  if (t0.type !== 'fn' || (t0.value !== 'log' && t0.value !== 'ln')) return null
  const inner = poly.wholeParen(tokens.slice(1))
  if (!inner || !inner.length) return null
  return { name: t0.value, inner: inner }
}

function evalPoly1(p, x) {
  let acc = V.zero()
  p.terms.forEach(function (coef, key) {
    const vec = key.split(',')
    let e = 0
    for (let i = 0; i < vec.length; i++) e += Number(vec[i])
    acc = V.add(acc, V.mul(coef, V.pow(x, V.fromNum(e))))
  })
  return acc
}

function logOf(a, c) {
  if (V.isQ(a) && V.isQ(c) && fraction.isInt(a) && fraction.isInt(c)) {
    const ai = a.num
    const ci = c.num
    if (ai > 1 && ci > 0) {
      let v = 1
      for (let n = 0; n <= 64; n++) {
        if (v === ci) return V.q(n, 1)
        v *= ai
        if (v > ci) break
      }
    }
  }
  return V.f(Math.log(numOf(c)) / Math.log(numOf(a)))
}

// ---------- 各类求解 ----------

function eqPoly(clause, fracOn) {
  const vars = poly.unionVars([clause.left, clause.right])
  if (vars.length > 1) throw new Error('一元方程最多 1 个未知数')
  const p = poly.sub(poly.parsePolyTokens(clause.left, vars), poly.parsePolyTokens(clause.right, vars))
  if (vars.length === 0) {
    const ok = V.isZero(poly.constOf(p))
    return ok ? R('linear', false, ['【一次方程】', '无穷多解'], null) : R('linear', true, [], null)
  }
  if (p.degree > 2) throw new Error('次数超过 2')
  const r = rootsOf(p)
  const label = p.degree >= 2 ? '【二次方程】' : '【一次方程】'
  const lines = eqLines(r, label, fracOn)
  const kind = label === '【二次方程】' ? 'quadratic' : 'linear'
  if (!lines) return R(kind, true, [], null)
  return R(kind, false, lines, { roots: r.roots || [], disc: r.disc || null })
}

function eqAbs(clause, fracOn) {
  let inner = bareAbs(clause.left)
  let other = clause.right
  if (!inner) {
    inner = bareAbs(clause.right)
    other = clause.left
  }
  if (!inner) throw new Error('不支持这种形式')
  const vars = poly.unionVars([inner, other])
  if (vars.length > 1) throw new Error('一元方程最多 1 个未知数')
  if (poly.unionVars([other]).length > 0) throw new Error('不支持这种形式')
  const P = poly.parsePolyTokens(inner, vars)
  if (P.degree > 1) throw new Error('次数超过 2')
  const c = poly.constOf(poly.parsePolyTokens(other, vars))
  const label = '【绝对值方程】'
  if (numOf(c) < 0) return R('absIneq', true, [], null)
  const targets = numOf(c) === 0 ? [c] : [c, V.neg(c)]
  const roots = []
  for (let i = 0; i < targets.length; i++) {
    const eq = poly.sub(P, poly.polyConst(targets[i], vars))
    const r = rootsOf(eq)
    if (r.kind === 'const') {
      if (r.isZero) return R('absIneq', false, [label, '无穷多解'], null)
      continue
    }
    if (r.kind === 'linear') roots.push(r.roots[0])
    else if (r.real) for (let j = 0; j < r.roots.length; j++) roots.push(r.roots[j])
  }
  const uniq = []
  for (let i = 0; i < roots.length; i++) {
    let seen = false
    for (let j = 0; j < uniq.length; j++) if (numOf(uniq[j]) === numOf(roots[i])) seen = true
    if (!seen) uniq.push(roots[i])
  }
  uniq.sort(function (a, b) {
    return numOf(a) - numOf(b)
  })
  if (!uniq.length) return R('absIneq', true, [], null)
  if (uniq.length === 1) return R('absIneq', false, [label, 'x = ' + fmt(uniq[0], fracOn)], { roots: uniq })
  return R(
    'absIneq',
    false,
    twoRootLines(label, 'x1 = ' + fmt(uniq[0], fracOn), 'x2 = ' + fmt(uniq[1], fracOn)),
    { roots: uniq }
  )
}

function eqLog(clause, fracOn) {
  let call = logCall(clause.left)
  let other = clause.right
  if (!call) {
    call = logCall(clause.right)
    other = clause.left
  }
  if (!call) throw new Error('不支持这种形式')
  const vars = poly.unionVars([call.inner, other])
  if (vars.length > 1) throw new Error('一元方程最多 1 个未知数')
  if (poly.unionVars([other]).length > 0) throw new Error('不支持这种形式')
  const lab = '【对数方程】'
  const P = poly.parsePolyTokens(call.inner, vars)
  if (P.degree > 2) throw new Error('次数超过 2')
  const b = poly.constOf(poly.parsePolyTokens(other, vars))
  const target = V.f(call.name === 'log' ? Math.pow(10, numOf(b)) : Math.exp(numOf(b)))
  const r = rootsOf(poly.sub(P, poly.polyConst(target, vars)))
  if (r.kind === 'const') {
    return r.isZero ? R('logEq', false, [lab, '无穷多解'], null) : R('logEq', true, [], null)
  }
  if (r.kind === 'quadratic' && !r.real) return R('logEq', false, [lab, '无实数根'], null)
  const keep = []
  for (let i = 0; i < r.roots.length; i++) {
    if (numOf(evalPoly1(P, r.roots[i])) > 0) keep.push(r.roots[i])
  }
  if (!keep.length) return R('logEq', true, [], null)
  if (keep.length === 1) return R('logEq', false, [lab, 'x = ' + fmt(keep[0], fracOn)], { roots: keep })
  return R(
    'logEq',
    false,
    twoRootLines(lab, 'x1 = ' + fmt(keep[0], fracOn), 'x2 = ' + fmt(keep[1], fracOn)),
    { roots: keep }
  )
}

function eqPower(clause, fracOn) {
  const vars = poly.unionVars([clause.left, clause.right])
  if (vars.length === 0) throw new Error('不支持这种形式')
  if (vars.length > 1) throw new Error('一元方程最多 1 个未知数')
  const lab = '【指数方程】'
  const l = poly.detectPower(clause.left, vars)
  const r = poly.detectPower(clause.right, vars)
  const okBase = function (v) {
    const n = numOf(v)
    return n > 0 && n !== 1
  }
  if (l && r && l.hasVar && r.hasVar) {
    if (!okBase(l.base) || !okBase(r.base)) throw new Error('底数须为正且非 1')
    let eq
    if (V.isQ(l.base) && V.isQ(r.base) && l.base.num === r.base.num && l.base.den === r.base.den) {
      eq = poly.sub(l.exp, r.exp)
    } else {
      const la = poly.mul(l.exp, poly.polyConst(V.f(Math.log(numOf(l.base))), vars))
      const lb = poly.mul(r.exp, poly.polyConst(V.f(Math.log(numOf(r.base))), vars))
      eq = poly.sub(la, lb)
    }
    return finishEq(eq, lab, 'expEq', fracOn)
  }
  let base
  let expP
  let constTokens
  if (l && l.hasVar) {
    base = l.base
    expP = l.exp
    constTokens = clause.right
  } else if (r && r.hasVar) {
    base = r.base
    expP = r.exp
    constTokens = clause.left
  } else {
    throw new Error('不支持这种形式')
  }
  if (!okBase(base)) throw new Error('底数须为正且非 1')
  const cP = poly.parsePolyTokens(constTokens, vars)
  if (!poly.isConst(cP)) throw new Error('不支持这种形式')
  const c = poly.constOf(cP)
  if (numOf(c) <= 0) return R('expEq', true, [], null)
  const k = logOf(base, c)
  return finishEq(poly.sub(expP, poly.polyConst(k, vars)), lab, 'expEq', fracOn)
}

function finishEq(p, label, kind, fracOn) {
  if (p.degree > 2) throw new Error('次数超过 2')
  const r = rootsOf(p)
  const lines = eqLines(r, label, fracOn)
  if (!lines) return R(kind, true, [], null)
  return R(kind, false, lines, { roots: r.roots || [] })
}

function oneEquation(clause, fracOn) {
  if (hasAbs(clause.tokens)) return eqAbs(clause, fracOn)
  if (logCall(clause.left) || logCall(clause.right)) return eqLog(clause, fracOn)
  const pl = poly.detectPower(clause.left, null)
  const pr = poly.detectPower(clause.right, null)
  if ((pl && pl.hasVar) || (pr && pr.hasVar)) return eqPower(clause, fracOn)
  return eqPoly(clause, fracOn)
}

function oneInequality(clause, fracOn) {
  if (hasAbs(clause.tokens)) return ineqAbs(clause, fracOn)
  const vars = poly.unionVars([clause.left, clause.right])
  if (vars.length > 1) throw new Error('一元不等式最多 1 个未知数')
  const p = poly.sub(poly.parsePolyTokens(clause.left, vars), poly.parsePolyTokens(clause.right, vars))
  if (vars.length === 0) {
    const ok = holdConst(numOf(poly.constOf(p)), clause.rel)
    return ok
      ? R('ineq1', false, ['【一次不等式】', '解集：全体实数'], { set: [allIv()] })
      : R('ineq1', true, [], null)
  }
  const label = p.degree >= 2 ? '【二次不等式】' : '【一次不等式】'
  const kind = p.degree >= 2 ? 'ineq2' : 'ineq1'
  const set = normList(polyIneqSet(p, clause.rel))
  if (!set.length) return R(kind, true, [], null)
  return R(kind, false, [label, '解集：' + setText(set, fracOn)], { set: set })
}

function ineqAbs(clause, fracOn) {
  let inner = bareAbs(clause.left)
  let other = clause.right
  if (!inner) {
    inner = bareAbs(clause.right)
    other = clause.left
  }
  if (!inner) throw new Error('不支持这种形式')
  const vars = poly.unionVars([inner, other])
  if (vars.length > 1) throw new Error('一元不等式最多 1 个未知数')
  if (poly.unionVars([other]).length > 0) throw new Error('不支持这种形式')
  const P = poly.parsePolyTokens(inner, vars)
  if (P.degree > 1) throw new Error('次数超过 2')
  const c = poly.constOf(poly.parsePolyTokens(other, vars))
  const rel = clause.rel
  const lab = '【绝对值不等式】'
  // |P| rel c 等价于「P rel c」与「P flip(rel) -c」两支：
  // rel 为 >/>= 取两支并集，为 </<= 取两支交集
  if (rel !== '>' && rel !== '>=' && rel !== '<' && rel !== '<=') throw new Error('不支持这种形式')
  const flip = flipRel(rel)
  const branchA = polyIneqSet(poly.sub(P, poly.polyConst(c, vars)), rel)
  const branchB = polyIneqSet(poly.sub(P, poly.polyConst(V.neg(c), vars)), flip)
  let set
  if (rel === '>' || rel === '>=') set = normList(branchA.concat(branchB))
  else set = normList(interAll([branchA, branchB]))
  if (!set.length) return R('absIneq', true, [], null)
  const text = descText(set, fracOn)
  return R('absIneq', false, [lab, text], { set: set })
}

// ---------- 方程组 ----------

function cramer2(rows) {
  const a = rows[0][0]
  const b = rows[0][1]
  const e = rows[0][2]
  const c = rows[1][0]
  const d = rows[1][1]
  const f = rows[1][2]
  const det = V.sub(V.mul(a, d), V.mul(b, c))
  if (V.isZero(det)) return null
  const x = V.div(V.sub(V.mul(e, d), V.mul(b, f)), det)
  const y = V.div(V.sub(V.mul(a, f), V.mul(e, c)), det)
  return { type: 'unique', x: [x, y] }
}

/** 主元交换 -> RREF -> 比秩；rows 为 n+1 列增广矩阵 */
function gauss(rows, n) {
  const m = rows.length
  let r = 0
  let pivots = 0
  for (let c = 0; c < n && r < m; c++) {
    let p = -1
    for (let i = r; i < m; i++) {
      if (!V.isZero(rows[i][c])) {
        p = i
        break
      }
    }
    if (p < 0) continue
    const tmp = rows[r]
    rows[r] = rows[p]
    rows[p] = tmp
    const pv = rows[r][c]
    for (let j = c; j <= n; j++) rows[r][j] = V.div(rows[r][j], pv)
    for (let i = 0; i < m; i++) {
      if (i === r) continue
      const f = rows[i][c]
      if (V.isZero(f)) continue
      for (let j = c; j <= n; j++) rows[i][j] = V.sub(rows[i][j], V.mul(f, rows[r][j]))
    }
    r++
    pivots++
  }
  for (let i = 0; i < m; i++) {
    let allZero = true
    for (let j = 0; j < n; j++) {
      if (!V.isZero(rows[i][j])) {
        allZero = false
        break
      }
    }
    if (allZero && !V.isZero(rows[i][n])) return { type: 'none' }
  }
  if (pivots < n) return { type: 'infinite' }
  const out = []
  for (let i = 0; i < n; i++) out.push(rows[i][n])
  return { type: 'unique', x: out }
}

function sysEquation(clauses, fracOn) {
  const parts = []
  for (let i = 0; i < clauses.length; i++) {
    parts.push(clauses[i].left)
    parts.push(clauses[i].right)
  }
  const vars = poly.unionVars(parts)
  if (vars.length > 3) throw new Error('未知数最多 3 个')
  const rows = []
  for (let i = 0; i < clauses.length; i++) {
    const p = poly.sub(
      poly.parsePolyTokens(clauses[i].left, vars),
      poly.parsePolyTokens(clauses[i].right, vars)
    )
    if (p.degree > 1) throw new Error('方程组只支持一次')
    const row = []
    for (let k = 0; k < vars.length; k++) {
      const vec = []
      for (let j = 0; j < vars.length; j++) vec.push(k === j ? 1 : 0)
      row.push(poly.coeff(p, vec))
    }
    row.push(V.neg(poly.constOf(p)))
    rows.push(row)
  }
  const kind = vars.length === 3 ? 'sys3' : 'sys2'
  const label = vars.length === 3 ? '【三元一次方程组】' : '【二元一次方程组】'
  if (vars.length === 0) {
    for (let i = 0; i < rows.length; i++) if (!V.isZero(rows[i][0])) return R(kind, true, [], null)
    return R(kind, false, [label, '无穷多解'], null)
  }
  let sol = null
  if (vars.length === 2 && rows.length === 2) sol = cramer2(rows)
  if (!sol) sol = gauss(rows, vars.length)
  if (sol.type === 'none') return R(kind, true, [], null)
  if (sol.type === 'infinite') return R(kind, false, [label, '无穷多解'], null)
  const parts2 = []
  for (let i = 0; i < vars.length; i++) parts2.push(vars[i] + ' = ' + fmt(sol.x[i], fracOn))
  return R(kind, false, [label, parts2.join('，')], { x: sol.x, vars: vars })
}

function sysInequality(clauses, fracOn) {
  const lists = []
  for (let i = 0; i < clauses.length; i++) {
    const c = clauses[i]
    if (hasAbs(c.tokens)) {
      const r = ineqAbs(c, fracOn)
      if (r.error) throw new Error(r.error)
      if (r.noSolution) return R('ineqsys', true, [], null)
      lists.push(r.raw.set)
      continue
    }
    const vars = poly.unionVars([c.left, c.right])
    if (vars.length > 1) throw new Error('一元不等式最多 1 个未知数')
    const p = poly.sub(poly.parsePolyTokens(c.left, vars), poly.parsePolyTokens(c.right, vars))
    if (vars.length === 0) {
      if (!holdConst(numOf(poly.constOf(p)), c.rel)) return R('ineqsys', true, [], null)
      continue
    }
    lists.push(normList(polyIneqSet(p, c.rel)))
  }
  const set = normList(interAll(lists))
  if (!set.length) return R('ineqsys', true, [], null)
  return R('ineqsys', false, ['【不等式组】', '解集：' + setText(set, fracOn)], { set: set })
}

// ---------- 入口 ----------

function splitClauses(tokens) {
  const groups = []
  let cur = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'sep') {
      groups.push(cur)
      cur = []
    } else {
      cur.push(t)
    }
  }
  groups.push(cur)
  const out = []
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    if (!g.length) continue
    let idx = -1
    let count = 0
    for (let j = 0; j < g.length; j++) {
      if (g[j].type === 'rel') {
        count++
        if (idx < 0) idx = j
      }
    }
    if (count === 0) throw new Error('缺少关系符')
    if (count > 1) throw new Error('每段一个关系符')
    if (idx === 0 || idx === g.length - 1) throw new Error('语法错误')
    out.push({ left: g.slice(0, idx), rel: g[idx].value, right: g.slice(idx + 1), tokens: g })
  }
  return out
}

function run(input, fracOn) {
  const src = String(input || '').trim()
  if (!src) throw new Error('输入为空')
  const clauses = splitClauses(calc.tokenize(src))
  if (!clauses.length) throw new Error('输入为空')
  let eqCount = 0
  for (let i = 0; i < clauses.length; i++) if (clauses[i].rel === '=') eqCount++
  if (eqCount > 0 && eqCount < clauses.length) throw new Error('方程与不等式不能混用')
  if (eqCount === 0) {
    if (clauses.length === 1) return oneInequality(clauses[0], fracOn)
    return sysInequality(clauses, fracOn)
  }
  if (clauses.length === 1) return oneEquation(clauses[0], fracOn)
  return sysEquation(clauses, fracOn)
}

/**
 * @param {string} input 键盘拼出来的表达式
 * @param {{fracOn?:boolean}} [opts]
 * @returns {{kind:string, noSolution:boolean, lines:string[], error:string|null, raw:object|null}}
 */
function solve(input, opts) {
  const fracOn = !!(opts && opts.fracOn)
  try {
    return run(input, fracOn)
  } catch (e) {
    return fail(shortError(e))
  }
}

export default { solve }

/** 仅供 tools/test-solver.mjs 断言区间运算（页面不要用） */
export const __test = { iv, intersect, merge, normList, interAll, ivText, setText, descText, allIv, NEG, POS, roots2 }
