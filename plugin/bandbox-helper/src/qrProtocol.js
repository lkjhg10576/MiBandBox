/**
 * BandBox 二维码导入协议：纯 JS 实现（协议规格副本）。
 *
 * 本文件在手表端（src/utils/qrProtocol.js）与手机插件端
 * （plugin/bandbox-helper/src/qrProtocol.js）各存一份，
 * **必须逐字一致**（qr-cross 测试按 SHA-256 比对整文件）。
 * 自包含零依赖；不出现 TextEncoder/console/setTimeout。
 *
 * 与歌词（bandbox-lyrics）/ OTP（bandbox-otp）协议共用同一条
 * @system.interconnect 通道，靠 app 字段分流；
 * 消息公共字段 { app:'bandbox-qr', v:1, type, id, ts }。
 * id 必须唯一：手表端 interconnect 有 80ms 同文本去重，重复文本会被吞。
 *
 * 消息表（本期单包直发，不做分片；文本上限 512 字节 → 单消息恒 <1KB）：
 *   手机→手表 qr_import { id, text, ts }
 *   手表→手机 qr_ack    { id, ok:true, duplicate }
 *   手表→手机 qr_err    { id, reason }
 *
 * 收藏侧只存二维码**原文本**（key qrFavs），调出时用 show 页现场重新生成，
 * 不存任何图片数据。
 */

export const APP_ID = 'bandbox-qr'
export const VERSION = 1

/** 目标快应用包名（手表端 BandBox）。手表侧不用，保留以保持两份一致。 */
export const TARGET_PKG = 'com.miband.bandbox'

/** 单条二维码文本的 UTF-8 字节上限（超出由插件解析期拒绝）。 */
export const MAX_TEXT_BYTES = 512

export const ERRORS = {
  BAD_JSON: 'bad-json',
  BAD_APP: 'bad-app',
  VERSION: 'version',
  BAD_TYPE: 'bad-type',
  EMPTY: 'empty',
  TOO_LARGE: 'too-large',
  WRITE_FAILED: 'write-failed'
}

/** 错误码 → 中文提示（两端同步）。 */
export const ERROR_TEXT = {
  'bad-json': '消息格式错误',
  'bad-app': '消息来源不匹配',
  'version': '协议版本不匹配，请更新插件或手环应用',
  'bad-type': '消息类型不匹配',
  'empty': '内容为空',
  'too-large': '内容过长（上限 512 字节）',
  'write-failed': '手环保存收藏失败'
}

/**
 * 构造一条消息对象。
 */
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

/**
 * 序列化消息。
 */
export function encode(type, payload) {
  return JSON.stringify(message(type, payload))
}

/**
 * 解析二维码导入协议消息。
 * 返回 { ok: true, msg } 或 { ok: false, reason }。
 * 只校验 app/v/type 三件事；非本协议消息（歌词/OTP 等）返回 bad-app，
 * 调用方静默忽略（三协议共用一条通道，靠 app 分流）。
 */
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
 * 生成唯一 id。两端环境都可用（Date.now + Math.random）；
 * 仅用于消息去重与回执关联，不是密钥材料。
 */
export function makeId(prefix) {
  const p = prefix || 'qr'
  const now = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return p + '-' + now + '-' + rand
}

// ------------------------------------------------------------------
// 消息构造器
// ------------------------------------------------------------------

/** 手机→手表 导入一条二维码原文本。 */
export function qrImportMessage(text, id) {
  return encode('qr_import', {
    id: id || makeId('qi'),
    text: String(text == null ? '' : text),
    ts: Date.now()
  })
}

/** 手表→手机 确认（duplicate: 该文本已在收藏里）。 */
export function qrAckMessage(id, duplicate) {
  return encode('qr_ack', { id: id || '', ok: true, duplicate: !!duplicate })
}

/** 手表→手机 错误。 */
export function qrErrMessage(id, reason) {
  return encode('qr_err', { id: id || '', reason: reason || ERRORS.WRITE_FAILED })
}

/**
 * 解释手表回执，产出给用户看的中文文案（插件侧用）。
 */
export function describeReply(msg) {
  if (!msg) return { state: 'unknown', text: '未收到手环回应' }
  switch (msg.type) {
    case 'qr_ack':
      return {
        state: 'sent',
        text: msg.duplicate ? '手环已收藏过该内容' : '手环已保存，可在「我的收藏」查看'
      }
    case 'qr_err':
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
  MAX_TEXT_BYTES,
  ERRORS,
  ERROR_TEXT,
  message,
  encode,
  parse,
  byteLength,
  makeId,
  qrImportMessage,
  qrAckMessage,
  qrErrMessage,
  describeReply
}
