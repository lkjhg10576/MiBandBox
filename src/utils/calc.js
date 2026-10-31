/**
 * 四则运算解析器：+ - * / % ^、括号、一元负号、开方。
 * 使用递归下降，不依赖 eval。
 */
function tokenize(input) {
  const src = String(input || '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/√/g, 'sqrt')
  const tokens = []
  let i = 0
  let prev = null
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
      if (prev && (prev.type === 'num' || prev.value === ')')) tokens.push({ type: 'op', value: '*' })
      tokens.push({ type: 'num', value: parseFloat(raw) })
      prev = tokens[tokens.length - 1]
      i = j
      continue
    }
    if (src.slice(i, i + 4) === 'sqrt') {
      if (prev && (prev.type === 'num' || prev.value === ')')) tokens.push({ type: 'op', value: '*' })
      tokens.push({ type: 'fn', value: 'sqrt' })
      prev = tokens[tokens.length - 1]
      i += 4
      continue
    }
    if ('+-*/^%()'.indexOf(ch) >= 0) {
      if (ch === '(' && prev && (prev.type === 'num' || prev.value === ')')) {
        tokens.push({ type: 'op', value: '*' })
      }
      tokens.push({ type: ch === '(' || ch === ')' ? 'paren' : 'op', value: ch })
      prev = tokens[tokens.length - 1]
      i++
      continue
    }
    throw new Error('bad char')
  }
  return tokens
}

function evaluate(input) {
  const tokens = tokenize(input)
  let pos = 0

  function peek() {
    return tokens[pos]
  }
  function take() {
    return tokens[pos++]
  }
  function parseExpr() {
    let v = parseTerm()
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = take().value
      const r = parseTerm()
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  function parseTerm() {
    let v = parseUnary()
    while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/' || peek().value === '^')) {
      const op = take().value
      const r = parseUnary()
      if (op === '*') v = v * r
      else if (op === '/') v = v / r
      else v = Math.pow(v, r)
    }
    return v
  }
  function parseUnary() {
    if (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = take().value
      const v = parseUnary()
      return op === '-' ? -v : v
    }
    return parsePostfix()
  }
  function parsePostfix() {
    let v = parsePrimary()
    while (peek() && peek().type === 'op' && peek().value === '%') {
      take()
      v = v / 100
    }
    return v
  }
  function parsePrimary() {
    const t = peek()
    if (!t) throw new Error('unexpected end')
    if (t.type === 'num') {
      take()
      return t.value
    }
    if (t.type === 'fn') {
      take()
      const v = parseUnary()
      if (t.value === 'sqrt') {
        if (v < 0) throw new Error('sqrt negative')
        return Math.sqrt(v)
      }
    }
    if (t.type === 'paren' && t.value === '(') {
      take()
      const v = parseExpr()
      const close = take()
      if (!close || close.value !== ')') throw new Error('missing )')
      return v
    }
    throw new Error('unexpected token')
  }

  const value = parseExpr()
  if (pos !== tokens.length) throw new Error('extra token')
  if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) throw new Error('not finite')
  return value
}

function format(n) {
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

export default { evaluate, format, tokenize }
