/**
 * 文本排版高度估算 —— 给 <scroll> 的内容容器算显式高度用。
 *
 * 为什么需要它：Vela 的 <scroll> 必须显式给内容高，否则内容按视口高裁 ——
 * 超出视口的部分既滚不到也看不见（输入页的预览框、摩斯电码都踩过这个坑：
 * 文字照样渲染，但 scroll 的可滚范围按视口高算，多出来的行永远够不着）。
 * 快应用没有「取文本实测高度」的 API，只能按字宽估算行数。
 *
 * 口径：**宁可高估，不要低估**。
 *   - 高估 = 多出一段空白（多滚一下，无害）；
 *   - 低估 = 把文字底部裁掉（用户看不到自己输入的结尾，是真 bug）。
 * 所以字宽取各类字符的**上限档**（拉丁小写 0.72em、大写 0.85em、窄符号 0.34em），
 * 宽度再乘 1.08 的安全系数，行数额外加一行。
 */

/** 各类字符的宽度上限（单位 em） */
const W_SPACE = 0.3    // 空格
const W_NARROW = 0.34  // . , : ; ! | ' " ` ( ) [ ] { } - / \
const W_MEDIUM = 0.62  // @ # $ % & * + = < > ? ~ ^
const W_DIGIT = 0.62   // 0-9
const W_LOW_NARROW = 0.3  // i j l（细杆字母，英文里很常见）
const W_LOW_MID = 0.42   // f r t
const W_LOW = 0.72       // 其余小写（m/w 偏宽，取常见档）
const W_UPPER = 0.85      // A-Z（W/M 偏宽，取常见档）
const W_FULL = 1.0        // CJK 与其它全角

/** 字宽估算的安全系数（宽度乘这个系数再折行） */
const SAFETY = 1.08

const NARROW_CHARS = '.,:;!|\'"`()[]{}-/\\'
const LOW_NARROW = 'ijl'
const LOW_MID = 'frt'

/** 单个字符的宽度（em） */
export function charWidthEm(code) {
  if (code === 32) return W_SPACE
  if (code >= 48 && code <= 57) return W_DIGIT
  if (code >= 65 && code <= 90) {
    if (code === 73) return W_LOW_NARROW // I
    return W_UPPER
  }
  if (code >= 97 && code <= 122) {
    const ch = String.fromCharCode(code)
    if (LOW_NARROW.indexOf(ch) >= 0) return W_LOW_NARROW
    if (LOW_MID.indexOf(ch) >= 0) return W_LOW_MID
    return W_LOW
  }
  if (code < 128) {
    if (NARROW_CHARS.indexOf(String.fromCharCode(code)) >= 0) return W_NARROW
    return W_MEDIUM
  }
  return W_FULL
}

/** 一段文本的排版宽度（px）；letterSpacing 为字间距（px/字） */
export function textWidth(text, fontSize, letterSpacing) {
  const s = String(text == null ? '' : text)
  let em = 0
  for (let i = 0; i < s.length; i++) em += charWidthEm(s.charCodeAt(i))
  return em * fontSize + (letterSpacing || 0) * s.length
}

/**
 * 文本折行后的行数：按 boxWidth 宽折行，显式换行分段各算各的。
 * 宽度带 1.08 安全系数，行数向上取整 —— 宁可多算一行。
 */
export function estimateLines(text, boxWidth, fontSize, letterSpacing) {
  const s = String(text == null ? '' : text)
  if (!s) return 0
  if (!boxWidth || boxWidth <= 0) return 1
  const segs = s.split('\n')
  let lines = 0
  for (let i = 0; i < segs.length; i++) {
    const w = textWidth(segs[i], fontSize, letterSpacing) * SAFETY
    lines += Math.max(1, Math.ceil(w / boxWidth))
  }
  return lines
}

/**
 * 文本的排版高度（px）：行数 + 一行的余量。
 * 返回 0 表示空文本（调用方按占位元素的高度处理）。
 */
export function textHeight(text, boxWidth, fontSize, lineHeight, letterSpacing) {
  const lines = estimateLines(text, boxWidth, fontSize, letterSpacing)
  if (!lines) return 0
  return (lines + 1) * lineHeight
}

export default { charWidthEm, textWidth, estimateLines, textHeight }
