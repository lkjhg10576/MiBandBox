/** 整数输入策略：只收 ±999999 的整数。不复用 units.parseInput —— 那个接受小数并服务单位换算。 */

export const INT_MIN = -999999
export const INT_MAX = 999999
export const INT_MAX_CHARS = 7

// 前导零每键归一，草稿才永远最多一个前导零，7 字符上限等价于「6 位数字 + 符号」
function normalizeDraft(s) {
  if (s === '' || s === '-') return s
  const neg = s.charAt(0) === '-'
  const digits = (neg ? s.slice(1) : s).replace(/^0+/, '')
  if (digits === '') return '0'
  return (neg ? '-' : '') + digits
}

/**
 * 追加一键，返回 { draft, reason }；reason 为 '' 接受 / 'char' 非法字符 / 'limit' 越界。
 * 内置输入法 number 模式会把符号行的 . ， % ~ 等原样抛过来，必须在这里挡掉。
 */
export function pushKey(draft, key) {
  const d = String(draft == null ? '' : draft)
  const k = String(key == null ? '' : key)
  if (k.length !== 1) return { draft: d, reason: 'char' }
  if (k === '-') {
    // 负号是首位开关。范围不变量保证 |n| ≤ 999999 即最多 6 位数字，加符号不会超 7 字符
    return { draft: d.charAt(0) === '-' ? d.slice(1) : '-' + d, reason: '' }
  }
  if (k < '0' || k > '9') return { draft: d, reason: 'char' }
  const next = normalizeDraft(d + k)
  if (next.length > INT_MAX_CHARS) return { draft: d, reason: 'limit' }
  const n = Number(next)
  if (!isFinite(n) || n < INT_MIN || n > INT_MAX) return { draft: d, reason: 'limit' }
  return { draft: next, reason: '' }
}

/** 草稿转整数；空串、只有负号、含小数或越界一律 null，由调用方回退原值。 */
export function parseDraft(draft) {
  if (typeof draft !== 'string') return null
  const s = normalizeDraft(draft.trim())
  if (!/^-?\d+$/.test(s)) return null
  const n = Number(s)
  if (!isFinite(n) || n < INT_MIN || n > INT_MAX) return null
  return n === 0 ? 0 : n
}

export default { INT_MIN, INT_MAX, INT_MAX_CHARS, pushKey, parseDraft }