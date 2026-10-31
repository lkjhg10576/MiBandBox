/**
 * LRC 歌词解析：纯函数，无平台依赖，可在 Node 下直接单测。
 *
 * 目标：把带时间轴的 .lrc 还原成「逐行纯文本」，供手环歌词本使用。
 * 时间轴、元数据标签、逐字标签全部丢弃。
 */

/** 元数据标签（整行形如 [ti:xxx]），解析后丢弃。 */
const META_RE = /^\[(ti|ar|al|by|offset|length|re|ve|au|by|tool|encoding):(.*)\]$/i

/** 时间标签 [mm:ss.xx] / [mm:ss.xxx] / [mm:ss] */
const TIME_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

/** 增强 LRC 的逐字标签 <mm:ss.xx> */
const WORD_RE = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g

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
  } else {
    return String(bytes)
  }

  // 去掉 BOM
  if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    u8 = u8.subarray(3)
  } else if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
    u8 = u8.subarray(2)
  }

  // 严格 UTF-8 解码
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8)
  } catch (e) {
    // 落到 GBK
  }

  for (const enc of ['gb18030', 'gbk']) {
    try {
      return new TextDecoder(enc).decode(u8)
    } catch (e) {}
  }
  // 最后兜底：非严格 UTF-8
  try {
    return new TextDecoder('utf-8').decode(u8)
  } catch (e) {
    return ''
  }
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
 * 解析 LRC 文本。
 *
 * @param {string} text
 * @param {string} [fileName] 用于在缺少 [ti:] 时推断标题
 * @returns {{ title: string, lines: string[], ok: boolean, reason?: string }}
 */
export function parseLrc(text, fileName) {
  const src = String(text == null ? '' : text)
  const rawLines = src.split(/\r\n|\r|\n/)

  const lines = []
  let title = ''
  let hasTimestamp = false

  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i]
    if (!line) continue

    // 元数据标签
    const meta = line.match(META_RE)
    if (meta) {
      const key = meta[1].toLowerCase()
      const value = meta[2].trim()
      if (key === 'ti' && value && !title) title = value
      continue
    }

    // 提取时间标签
    TIME_RE.lastIndex = 0
    const stamps = []
    let m
    let lastIndex = 0
    while ((m = TIME_RE.exec(line)) !== null) {
      stamps.push(m[0])
      lastIndex = m.index + m[0].length
      if (TIME_RE.lastIndex === m.index) TIME_RE.lastIndex++
    }

    let content
    if (stamps.length > 0) {
      hasTimestamp = true
      content = line.slice(lastIndex)
    } else {
      content = line
    }

    // 去掉增强 LRC 的逐字标签
    WORD_RE.lastIndex = 0
    content = content.replace(WORD_RE, '')

    content = content.trim()
    if (!content) continue

    // 有多个时间标签时，同一文本展开为多行
    if (stamps.length > 0) {
      for (let s = 0; s < stamps.length; s++) {
        lines.push(content)
      }
    } else {
      lines.push(content)
    }
  }

  if (!title) title = titleFromFileName(fileName)

  if (lines.length === 0) {
    return { ok: false, reason: '该文件没有可用的歌词行', title, lines: [] }
  }

  return { ok: true, title, lines, hasTimestamp }
}

/**
 * 解析选中的文件（字节 -> 结果）。
 */
export function parseLrcBytes(bytes, fileName) {
  return parseLrc(decodeText(bytes), fileName)
}

export default { parseLrc, parseLrcBytes, decodeText, titleFromFileName }
