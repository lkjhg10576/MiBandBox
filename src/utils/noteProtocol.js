/**
 * BandBox 手机闪传便签协议：纯 JS 实现（协议规格副本）。
 *
 * 本文件在手表端（src/utils/noteProtocol.js）与手机插件端
 * （plugin/bandbox-helper/src/noteProtocol.js）各存一份，
 * **必须逐字一致**（note-cross 测试按 SHA-256 比对整文件）。
 * 自包含零依赖；不出现 TextEncoder/console/setTimeout。
 *
 * 与歌词（bandbox-lyrics）/ OTP（bandbox-otp）/ 二维码（bandbox-qr）协议共用同一条
 * @system.interconnect 通道，靠 app 字段分流；
 * 消息公共字段 { app:'bandbox-note', v:1, type, id, ts }。
 *
 * 单包直发规范（无需分片）：
 *   - 标题上限 MAX_TITLE_LEN = 24（对齐 docs.js 96B FATFS 路径安全线）
 *   - 正文字符上限 MAX_BODY_CHARS = 1000（对齐手表 notebook/edit 二次编辑不截断）
 *   - 正文字节上限 MAX_BODY_BYTES = 3072（整帧 JSON < 4KB，远低于 12KB BLE 阈值）
 *
 * 消息集：
 *   手机→手表 note_push { id, title, body, conflict:'rename'|'overwrite', ts }
 *   手表→手机 note_ack  { id, ok:true, name, overwritten }
 *   手表→手机 note_err  { id, reason }
 */

export const APP_ID = 'bandbox-note'
export const VERSION = 1

/** 目标快应用包名（手表端 BandBox）。两端保持一致。 */
export const TARGET_PKG = 'com.lkjhg.bandbox'

export const MAX_TITLE_LEN = 24
export const MAX_BODY_CHARS = 1000
export const MAX_BODY_BYTES = 3072

export const CONFLICT_MODES = {
  RENAME: 'rename',
  OVERWRITE: 'overwrite'
}

export const ERRORS = {
  BAD_JSON: 'bad-json',
  BAD_APP: 'bad-app',
  VERSION: 'version',
  BAD_TYPE: 'bad-type',
  EMPTY: 'empty',
  TITLE_TOO_LONG: 'title-too-long',
  BODY_TOO_LONG: 'body-too-long',
  BODY_TOO_LARGE: 'body-too-large',
  WRITE_FAILED: 'write-failed'
}

export const ERROR_TEXT = {
  'bad-json': '消息格式错误',
  'bad-app': '消息来源不匹配',
  'version': '协议版本不匹配，请更新插件或手环应用',
  'bad-type': '消息类型不匹配',
  'empty': '便签正文不能为空',
  'title-too-long': '标题过长（上限 24 字）',
  'body-too-long': '正文过长（上限 1000 字）',
  'body-too-large': '正文体积过大（上限 3072 字节）',
  'write-failed': '手环保存笔记失败'
}

/**
 * UTF-8 字节长度（手写实现，不用 TextEncoder：QuickJS 没有）。
 */
export function byteLength(str) {
  const s = String(str == null ? '' : str)
  let len = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) len += 1
    else if (c < 0x800) len += 2
    else if (c >= 0xd800 && c <= 0xdbff) {
      len += 4
      i++
    } else len += 3
  }
  return len
}

/**
 * 标题清洗（与 docs.js / lyricsDoc.normalizeTitle 一致）：去文件名非法字符 + 折叠空白 + trim。
 */
export function cleanTitleText(s) {
  return String(s || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeTitle(s) {
  return cleanTitleText(s).slice(0, MAX_TITLE_LEN)
}

export function normalizeBody(s) {
  return String(s == null ? '' : s).replace(/\r\n?/g, '\n')
}

export function normalizeConflict(conflict) {
  return conflict === CONFLICT_MODES.OVERWRITE ? CONFLICT_MODES.OVERWRITE : CONFLICT_MODES.RENAME
}

/** 标题缺省时从正文首行提取有效标题（仍为空则回落「手机便签」）。 */
export function deriveTitle(title, body) {
  const t = normalizeTitle(title)
  if (t) return t
  const lines = normalizeBody(body).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = normalizeTitle(lines[i])
    if (line) return line
  }
  return '手机便签'
}

/** 校验待发便签输入（标题 ≤24 字，正文非空且 ≤1000 字、≤3072 字节）。 */
export function validateNoteInput(title, body) {
  const rawTitle = cleanTitleText(title)
  if (rawTitle.length > MAX_TITLE_LEN) {
    return {
      ok: false,
      reason: ERRORS.TITLE_TOO_LONG,
      titleLen: rawTitle.length
    }
  }
  const b = normalizeBody(body)
  if (!b.trim()) {
    return { ok: false, reason: ERRORS.EMPTY }
  }
  if (b.length > MAX_BODY_CHARS) {
    return {
      ok: false,
      reason: ERRORS.BODY_TOO_LONG,
      chars: b.length,
      bytes: byteLength(b)
    }
  }
  const bytes = byteLength(b)
  if (bytes > MAX_BODY_BYTES) {
    return {
      ok: false,
      reason: ERRORS.BODY_TOO_LARGE,
      chars: b.length,
      bytes: bytes
    }
  }
  return {
    ok: true,
    title: rawTitle || deriveTitle('', b),
    body: b,
    chars: b.length,
    bytes: bytes
  }
}

export function makeId(prefix) {
  const p = prefix || 'np'
  const now = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return p + '-' + now + '-' + rand
}

export function message(type, payload) {
  const msg = { app: APP_ID, v: VERSION, type }
  if (payload) {
    for (const key in payload) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        msg[key] = payload[key]
      }
    }
  }
  return msg
}

export function encode(type, payload) {
  return JSON.stringify(message(type, payload))
}

export function parse(raw) {
  let obj
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch (e) {
      return { ok: false, reason: ERRORS.BAD_JSON }
    }
  } else if (raw && typeof raw === 'object') {
    obj = raw
  } else {
    return { ok: false, reason: ERRORS.BAD_JSON }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, reason: ERRORS.BAD_JSON }
  }
  if (obj.app !== APP_ID) return { ok: false, reason: ERRORS.BAD_APP }
  if (obj.v !== VERSION) return { ok: false, reason: ERRORS.VERSION }
  if (typeof obj.type !== 'string') return { ok: false, reason: ERRORS.BAD_TYPE }
  return { ok: true, msg: obj }
}

/** 手机→手表 推送一条便签。支持传 (opts) 或 (title, body, conflict, id)。 */
export function notePushMessage(titleOrOpts, body, conflict, id) {
  let opts
  if (titleOrOpts && typeof titleOrOpts === 'object') {
    opts = titleOrOpts
  } else {
    opts = { title: titleOrOpts, body, conflict, id }
  }
  const msgId = opts.id || makeId('np')
  const normBody = normalizeBody(opts.body)
  const finalTitle = normalizeTitle(opts.title)
  return encode('note_push', {
    id: msgId,
    title: finalTitle,
    body: normBody,
    conflict: normalizeConflict(opts.conflict),
    ts: typeof opts.ts === 'number' ? opts.ts : Date.now()
  })
}

/** 手表→手机 确认回执。 */
export function noteAckMessage(id, name, overwritten) {
  return encode('note_ack', {
    id: id || '',
    ok: true,
    name: String(name == null ? '' : name),
    overwritten: !!overwritten
  })
}

/** 手表→手机 错误回执。 */
export function noteErrMessage(id, reason) {
  return encode('note_err', {
    id: id || '',
    reason: reason || ERRORS.WRITE_FAILED
  })
}

/** 解释手表回执，产出给用户看的中文文案（插件侧用）。 */
export function describeReply(msg) {
  if (!msg) return { state: 'unknown', text: '未收到手环回应' }
  switch (msg.type) {
    case 'note_ack':
      return {
        state: 'sent',
        text: msg.overwritten
          ? '已覆盖手表笔记「' + (msg.name || '') + '」'
          : '已保存到手表笔记本「' + (msg.name || '') + '」'
      }
    case 'note_err':
      return {
        state: 'failed',
        text: ERROR_TEXT[msg.reason] || ('失败：' + (msg.reason || '未知原因'))
      }
    default:
      return { state: 'unknown', text: '未知回执：' + msg.type }
  }
}

export default {
  APP_ID,
  VERSION,
  TARGET_PKG,
  MAX_TITLE_LEN,
  MAX_BODY_CHARS,
  MAX_BODY_BYTES,
  CONFLICT_MODES,
  ERRORS,
  ERROR_TEXT,
  byteLength,
  cleanTitleText,
  normalizeTitle,
  normalizeBody,
  normalizeConflict,
  deriveTitle,
  validateNoteInput,
  makeId,
  message,
  encode,
  parse,
  notePushMessage,
  noteAckMessage,
  noteErrMessage,
  describeReply
}
