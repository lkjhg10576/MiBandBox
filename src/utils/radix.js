/** 进制转换内核：32 位非负整数在 2/8/10/16 进制间的解析、格式化与按键策略。
 * 不复用 units.js —— 那套按 factor/toBase 做物理量换算，parseInput 只认十进制小数。
 * 形态仿 numberInput.js：零 import、零 Vela 依赖，Node 可直接加载。
 */

export const MAX_VALUE = 4294967295

export const BASES = [
  { id: 'bin', name: '二进制', symbol: 'BIN', radix: 2, maxChars: 32, group: 4, chars: '01' },
  { id: 'oct', name: '八进制', symbol: 'OCT', radix: 8, maxChars: 11, group: 3, chars: '01234567' },
  { id: 'dec', name: '十进制', symbol: 'DEC', radix: 10, maxChars: 10, group: 3, chars: '0123456789' },
  { id: 'hex', name: '十六进制', symbol: 'HEX', radix: 16, maxChars: 8, group: 4, chars: '0123456789ABCDEF' }
]

/** 按 id 取进制元数据；未知 id 返回 null。 */
export function base(id) {
  for (let i = 0; i < BASES.length; i++) {
    if (BASES[i].id === id) return BASES[i]
  }
  return null
}

/** 字符串 → 整数；非法字符、越界一律 null。
 * 不接受 0x/0b 前缀：hex 下 0B 本身是合法数（=11），收前缀会有语义歧义；
 * 且键盘无 x 键、本页无粘贴通道。
 */
export function parse(str, radixId) {
  const b = base(radixId)
  if (!b || typeof str !== 'string') return null
  const s = str.toUpperCase()
  // 长度前置守卫：33 个 0 累加值恒为 0，不拦会漏网
  if (s.length === 0 || s.length > b.maxChars) return null
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const d = b.chars.indexOf(s.charAt(i))
    if (d < 0) return null
    n = n * b.radix + d
    if (n > MAX_VALUE) return null
  }
  return n
}

/** 整数 → 该进制字符串（大写）；只收 0 ~ MAX 的整数，其余一律 null。 */
export function format(value, radixId) {
  const b = base(radixId)
  if (!b) return null
  if (typeof value !== 'number' || !isFinite(value)) return null
  if (value < 0 || value > MAX_VALUE || Math.floor(value) !== value) return null
  // ≤ 2^32-1 时 toString 按整数精确运算
  return value.toString(b.radix).toUpperCase()
}

/**
 * 追加一键，返回 { draft, reason }；reason 为 '' 接受 / 'char' 非法字符 / 'limit' 越界。
 * hex 键面只抛 0-9 与 A-F，但 sign 行及其它键面的字形仍会原样过来，必须在这里挡掉。
 */
export function pushKey(draft, key, radixId) {
  const b = base(radixId)
  const d = String(draft == null ? '' : draft)
  const k = String(key == null ? '' : key)
  if (!b || k.length !== 1) return { draft: d, reason: 'char' }
  const up = k.toUpperCase()
  if (b.chars.indexOf(up) < 0) return { draft: d, reason: 'char' }
  // 前导零每键归一，草稿才永远最多一个前导零，maxChars 上限才有意义
  const next = (d + up).replace(/^0+/, '') || '0'
  if (next.length > b.maxChars) return { draft: d, reason: 'limit' }
  // oct 11 位最大 8589934591、dec 10 位最大 9999999999，都超 MAX，必须再查值
  if (parse(next, b.id) === null) return { draft: d, reason: 'limit' }
  return { draft: next, reason: '' }
}

/** 整数 → 四进制结果行 [{id,name,symbol,text}]；页面自行过滤掉输入进制。 */
export function convertAll(value) {
  const out = []
  for (let i = 0; i < BASES.length; i++) {
    const b = BASES[i]
    out.push({ id: b.id, name: b.name, symbol: b.symbol, text: format(value, b.id) })
  }
  return out
}

/** 从右往左每 group 位插一个空格（bin/hex 4 位、oct/dec 3 位）。 */
export function grouped(text, radixId) {
  const b = base(radixId)
  const s = String(text == null ? '' : text)
  if (!b || s === '') return s
  const first = s.length % b.group
  let out = first > 0 ? s.slice(0, first) : ''
  for (let i = first; i < s.length; i += b.group) {
    out += (out === '' ? '' : ' ') + s.slice(i, i + b.group)
  }
  return out
}

/** 分组文本按行切分 [l1, l2]：分组后 >19 字符（只有满 32 位 bin 会出现）在中间的
 * 空格处切成两行，每行 4 组 = 16 数字 + 3 空格。不依赖 Vela 自动折行 ——
 * 断行点不可控，可能劈开 4 位组。
 */
export function splitLines(text, radixId) {
  const g = grouped(text, radixId)
  if (g.length <= 19) return [g, '']
  const groups = g.split(' ')
  const mid = Math.ceil(groups.length / 2)
  return [groups.slice(0, mid).join(' '), groups.slice(mid).join(' ')]
}

/** 草稿按定宽原样切分 [l1, l2]（不分组：退格时不视觉跳动），chunk 由页面按屏宽传入。 */
export function draftLines(draft, chunk) {
  const s = String(draft == null ? '' : draft)
  const c = chunk >= 1 ? chunk : 1
  return [s.slice(0, c), s.slice(c)]
}

export default { MAX_VALUE, BASES, base, parse, format, pushKey, convertAll, grouped, splitLines, draftLines }
