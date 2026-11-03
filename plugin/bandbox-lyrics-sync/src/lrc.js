/**
 * LRC 歌词解析：纯函数，无平台依赖，可在 Node 下直接单测。
 *
 * 注意：AstroBox 的 JS 插件跑在 QuickJS 上，**没有 TextDecoder**，
 * 所以这里用纯 JS 解码 UTF-8，并用生成的映射表兜底 GBK/GB18030。
 */

import { GBK_TABLE } from './gbk-table.js'

/** 元数据标签（整行形如 [ti:xxx]），解析后丢弃。 */
const META_RE = /^\[(ti|ar|al|by|offset|length|re|ve|au|by|tool|encoding):(.*)\]$/i

/** 时间标签本体：[mm:ss.xx] / [mm:ss.xxx] / [mm:ss] */
const TIME_TAG_SRC = '\\[\\d{1,3}:\\d{1,2}(?:[.:]\\d{1,3})?\\]'

/** 行首连续的行时间标签（允许多个标签之间有空白） */
const LEAD_TIME_RE = new RegExp('^(?:' + TIME_TAG_SRC + '[ \\t]*)+')

/** 行内时间标签：常规逐字歌词的 [mm:ss.xx] */
const INLINE_TIME_RE = new RegExp(TIME_TAG_SRC, 'g')

/** 增强 LRC 的逐字标签 <mm:ss.xx> */
const WORD_RE = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g

/** 歌词格式的判定优先级：增强逐字 > 逐字 > 逐行 > 纯文本。 */
const FORMAT_RANK = { plain: 0, line: 1, word: 2, enhanced: 3 }

/**
 * 严格/非严格 UTF-8 解码。
 *
 * @param {Uint8Array} u8
 * @param {boolean} fatal true 时遇到非法序列直接抛错
 * @returns {string}
 */
function decodeUtf8(u8, fatal) {
  let out = ''
  let i = 0
  while (i < u8.length) {
    const b0 = u8[i]
    if (b0 < 0x80) {
      out += String.fromCharCode(b0)
      i++
      continue
    }

    let need
    let cp
    let min
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      need = 1
      cp = b0 & 0x1f
      min = 0x80
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      need = 2
      cp = b0 & 0x0f
      min = 0x800
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      need = 3
      cp = b0 & 0x07
      min = 0x10000
    } else {
      if (fatal) throw new Error('invalid utf-8 lead byte')
      out += '\ufffd'
      i++
      continue
    }

    if (i + need >= u8.length) {
      if (fatal) throw new Error('truncated utf-8 sequence')
      out += '\ufffd'
      i++
      continue
    }

    let ok = true
    for (let k = 1; k <= need; k++) {
      const b = u8[i + k]
      if ((b & 0xc0) !== 0x80) {
        ok = false
        break
      }
      cp = (cp << 6) | (b & 0x3f)
    }

    if (
      !ok ||
      cp < min ||
      cp > 0x10ffff ||
      (cp >= 0xd800 && cp <= 0xdfff)
    ) {
      if (fatal) throw new Error('invalid utf-8 sequence')
      out += '\ufffd'
      i++
      continue
    }

    i += need + 1
    if (cp > 0xffff) {
      const v = cp - 0x10000
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
    } else {
      out += String.fromCharCode(cp)
    }
  }
  return out
}

/**
 * GBK/GB18030 双字节解码。
 *
 * 表由 scripts/gen-gbk-table.mjs 生成：lead 0x81-0xFE，trail 0x40-0xFE（跳过 0x7F），
 * 共 126 × 190 = 23940 项。遇到 4 字节 GB18030 或非法序列返回 null，
 * 让调用方退回非严格 UTF-8。
 *
 * @param {Uint8Array} u8
 * @returns {string|null}
 */
function decodeGbk(u8) {
  let out = ''
  let i = 0
  while (i < u8.length) {
    const lead = u8[i]
    if (lead < 0x80) {
      out += String.fromCharCode(lead)
      i++
      continue
    }
    // CP936 把单字节 0x80 映射为欧元符号
    if (lead === 0x80) {
      out += '\u20ac'
      i++
      continue
    }
    if (lead < 0x81 || lead > 0xfe || i + 1 >= u8.length) return null

    const trail = u8[i + 1]
    if (trail < 0x40 || trail > 0xfe || trail === 0x7f) return null

    const index =
      (lead - 0x81) * 190 + (trail < 0x7f ? trail - 0x40 : trail - 0x41)
    const ch = GBK_TABLE.charCodeAt(index)
    if (ch === 0xfffd) return null
    out += GBK_TABLE.charAt(index)
    i += 2
  }
  return out
}

/**
 * 解码字节为文本。
 * 优先 UTF-8（严格），失败再试 GBK/GB18030（国内 LRC 常见）。
 * @param {Uint8Array|ArrayBuffer} bytes
 * @returns {string}
 */
export function decodeText(bytes) {
  if (!bytes) return ''
  let u8
  if (bytes instanceof Uint8Array) {
    u8 = bytes
  } else if (bytes instanceof ArrayBuffer) {
    u8 = new Uint8Array(bytes)
  } else if (ArrayBuffer.isView(bytes)) {
    u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  } else if (Array.isArray(bytes)) {
    // 有些宿主把 WIT list<u8> 映射成普通数组
    u8 = new Uint8Array(bytes)
  } else {
    return String(bytes)
  }

  // 去掉 BOM
  if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    u8 = u8.subarray(3)
  } else if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
    u8 = u8.subarray(2)
  }

  // 严格 UTF-8
  try {
    return decodeUtf8(u8, true)
  } catch (e) {
    // 落到 GBK
  }

  const gbk = decodeGbk(u8)
  if (gbk !== null) return gbk

  // 最后兜底：非严格 UTF-8
  return decodeUtf8(u8, false)
}

/**
 * 从文件名猜测标题（去掉扩展名）。
 */
export function titleFromFileName(fileName) {
  if (!fileName) return ''
  let name = String(fileName)
  const dot = name.lastIndexOf('.')
  if (dot > 0) name = name.slice(0, dot)
  return name.trim()
}

/**
 * 解析一行歌词。
 *
 * 三种时间轴形态统一处理：
 *   - 逐行：[00:01.00]歌词
 *   - 逐字：[00:01.00]歌[00:01.20]词[00:02.00]
 *   - 增强逐字：[00:01.00]<00:01.00>歌<00:01.20>词<00:02.00>
 *
 * 行首连续的 [time] 是行时间；其余 [time] / <time> 都是逐字时间，直接剥离。
 *
 * @param {string} rawLine
 * @returns {{type:'empty'}|{type:'meta',key:string,value:string}|{type:'lyric',content:string,format:string,repeat:number,tagged:boolean}}
 */
function parseLyricLine(rawLine) {
  const line = String(rawLine == null ? '' : rawLine).trim()
  if (!line) return { type: 'empty' }

  const meta = line.match(META_RE)
  if (meta) {
    return { type: 'meta', key: meta[1].toLowerCase(), value: meta[2].trim() }
  }

  let stamps = []
  let rest = line
  const lead = line.match(LEAD_TIME_RE)
  if (lead) {
    stamps = lead[0].match(INLINE_TIME_RE) || []
    rest = line.slice(lead[0].length)
  }

  const inlineTimes = rest.match(INLINE_TIME_RE) || []
  const inlineWords = rest.match(WORD_RE) || []
  const content = rest.replace(INLINE_TIME_RE, '').replace(WORD_RE, '').trim()
  if (!content) return { type: 'empty' }

  let format = 'plain'
  if (inlineWords.length > 0) format = 'enhanced'
  else if (inlineTimes.length > 0) format = 'word'
  else if (stamps.length > 0) format = 'line'

  // 行首有多个标签、行内又有逐字标签时，后续标签更可能是首个词的起点，
  // 不要把整行重复多次。
  const repeat =
    stamps.length > 1 && (inlineTimes.length > 0 || inlineWords.length > 0)
      ? 1
      : Math.max(1, stamps.length)

  return {
    type: 'lyric',
    content,
    format,
    repeat,
    tagged: stamps.length > 0 || inlineTimes.length > 0 || inlineWords.length > 0
  }
}

/**
 * 解析 LRC 文本。
 *
 * 兼容逐行 LRC、常规逐字 LRC（行内 [time]）和增强逐字 LRC（ESLyric 的 <time>）。
 * 所有时间轴都只用于定位文本，最终输出为逐行纯文本。
 *
 * @param {string} text
 * @param {string} [fileName] 用于在缺少 [ti:] 时推断标题
 * @returns {{ title: string, lines: string[], ok: boolean, hasTimestamp: boolean, format: string, reason?: string }}
 */
export function parseLrc(text, fileName) {
  const src = String(text == null ? '' : text)
  const rawLines = src.split(/\r\n|\r|\n/)

  const lines = []
  let title = ''
  let hasTimestamp = false
  let format = 'plain'

  for (let i = 0; i < rawLines.length; i++) {
    const parsed = parseLyricLine(rawLines[i])

    if (parsed.type === 'empty') continue

    if (parsed.type === 'meta') {
      if (parsed.key === 'ti' && parsed.value && !title) title = parsed.value
      continue
    }

    if (parsed.tagged) hasTimestamp = true
    if (FORMAT_RANK[parsed.format] > FORMAT_RANK[format]) format = parsed.format

    for (let r = 0; r < parsed.repeat; r++) {
      lines.push(parsed.content)
    }
  }

  if (!title) title = titleFromFileName(fileName)

  if (lines.length === 0) {
    return { ok: false, reason: '该文件没有可用的歌词行', title, lines: [], hasTimestamp, format }
  }

  return { ok: true, title, lines, hasTimestamp, format }
}

/**
 * 解析选中的文件（字节 -> 结果）。
 */
export function parseLrcBytes(bytes, fileName) {
  return parseLrc(decodeText(bytes), fileName)
}

export default { parseLrc, parseLrcBytes, decodeText, titleFromFileName }
