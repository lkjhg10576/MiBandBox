/**
 * 色卡工具：HEX / RGB 两种输入格式的解析与互转。
 * 解析结果统一为 { ok, hex }，hex 恒为 6 位大写 RRGGBB（不带 #）；
 * 失败时 ok=false、hex=''。
 *
 * 仓库风格：不用 .find / .includes（未在 Vela 引擎验证过），
 * 用正则 test + split + parseInt（均为既有写法）。
 */

function isHex6(s) {
  return /^[0-9A-F]{6}$/.test(s)
}

function isHexDraft(s) {
  return /^[0-9A-F]{3}$/.test(s) || /^[0-9A-F]{6}$/.test(s)
}

/** 3 位缩写展开：F00 → FF0000 */
function expand3(hex) {
  if (hex.length !== 3) return hex
  return hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2)
}

function byteHex(v) {
  const s = v.toString(16).toUpperCase()
  return s.length === 1 ? '0' + s : s
}

/** HEX 输入：3/6 位十六进制（3 位自动展开，大小写都收）。 */
function parseHex(s) {
  const t = (s || '').toUpperCase()
  if (!isHexDraft(t)) return { ok: false, hex: '' }
  return { ok: true, hex: expand3(t) }
}

/** RGB 输入：R,G,B 各 0-255（容忍空格与全角逗号，统一按半角逗号切分）。 */
function parseRgb(s) {
  const t = (s || '').replace(/，/g, ',').replace(/\s+/g, '')
  const parts = t.split(',')
  if (parts.length !== 3) return { ok: false, hex: '' }
  const out = []
  for (let i = 0; i < 3; i++) {
    const p = parts[i]
    if (!/^\d{1,3}$/.test(p)) return { ok: false, hex: '' }
    const v = parseInt(p, 10)
    if (isNaN(v) || v < 0 || v > 255) return { ok: false, hex: '' }
    out.push(v)
  }
  return { ok: true, hex: byteHex(out[0]) + byteHex(out[1]) + byteHex(out[2]) }
}

/** hex（6 位）→ '255,136,0' */
function formatRgb(hex) {
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return r + ',' + g + ',' + b
}

/** 按模式解析草稿（mode：'hex' | 'rgb'）。 */
function parse(s, mode) {
  return mode === 'rgb' ? parseRgb(s) : parseHex(s)
}

/** hex → 指定模式的草稿表示（模式切换的数值守恒）。 */
function format(hex, mode) {
  return mode === 'rgb' ? formatRgb(hex) : hex
}

/** 前景色自适应（display.ux 同阈值）：亮底配深字、暗底配白字。 */
function fgFor(hex) {
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#111111' : '#FFFFFF'
}

export default { parseHex, parseRgb, parse, format, formatRgb, fgFor, isHex6 }
