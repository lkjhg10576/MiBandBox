/**
 * 歌词文档解析：落盘格式为「首行标题 + 正文」。
 *
 * 格式约定（唯一）：
 *   internal://files/bandbox/lyrics/<encodeURIComponent(safeName(title))>.txt
 *   第 1 行：标题（歌名）
 *   第 2 行起：歌词正文（逐行）
 *
 * 读取端必须容错：历史文件可能没有标题行（分片导入的旧文件），
 * 所以「首行是不是标题」不能只看位置，要看归一化后是否与文件名一致。
 *
 * 本文件不得 import 任何 @system.* 模块，也不依赖 docs.js（docs.js 依赖
 * @system.file，无法在纯 Node 单测里导入），以便用 Node 直接跑单测。
 */

/** 文件名/标题的最大长度（与落盘文件名长度上限一致）。 */
const MAX_TITLE_LEN = 24

/**
 * 标题归一化：与落盘文件名规则一致。
 * 去非法字符 → 空白折叠 → trim → 截断到 24 字。
 *
 * 注意：用 String(s || '') 而不是 String(s ?? '')，
 * 是为了与旧版 safeName 的行为逐字一致（旧版对 0 / false 会得到空串）。
 */
export function normalizeTitle(s) {
  return String(s || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_LEN)
}

/**
 * 统计正文行数（空串算 0 行）。
 */
function countLines(text) {
  if (!text) return 0
  return text.split('\n').length
}

/**
 * 解析歌词文件文本。
 *
 * @param {string} rawText 文件原文
 * @param {string} fileName 文件名（不含 .txt）
 * @returns {{ok:boolean, reason?:string, title:string, body:string, lineCount:number}}
 *
 * 规则（按顺序）：
 *   1. rawText 为空或非字符串 → { ok:false, reason:'empty' }
 *   2. 没有换行（单行文件）→ 整篇都是正文
 *   3. 首行归一化后与文件名归一化一致 → 首行是标题，正文从第二行起
 *   4. 否则首行属于正文 → 不剥离，整篇都是正文
 */
export function parseLyricsDoc(rawText, fileName) {
  const file = String(fileName == null ? '' : fileName)
  const normalizedFile = normalizeTitle(file)

  if (typeof rawText !== 'string' || rawText === '') {
    return { ok: false, reason: 'empty', title: file, body: '', lineCount: 0 }
  }

  const pos = rawText.indexOf('\n')
  if (pos < 0) {
    // 单行文件：整行都是正文
    return { ok: true, title: file, body: rawText, lineCount: countLines(rawText) }
  }

  const head = rawText.slice(0, pos)
  // 文件名归一化后为空时不能把首行当标题（否则会吃掉正文第一行）
  if (normalizedFile !== '' && normalizeTitle(head) === normalizedFile) {
    const body = rawText.slice(pos + 1)
    return { ok: true, title: head, body: body, lineCount: countLines(body) }
  }

  // 首行不是标题（常见于分片导入的旧文件）→ 整篇都是正文，首行不丢
  return { ok: true, title: file, body: rawText, lineCount: countLines(rawText) }
}

export default { normalizeTitle, parseLyricsDoc, MAX_TITLE_LEN }
