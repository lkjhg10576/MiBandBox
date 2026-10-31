/**
 * 手机→手环 的传输协议（与手环端 src/utils/lyricsTransfer.js 保持一致）。
 *
 * 约定：所有消息都是 UTF-8 JSON 字符串。
 * 公共字段：app = "bandbox-lyrics"、v = 1、type。
 */

export const APP_ID = 'bandbox-lyrics'
export const VERSION = 1

/** 目标快应用包名（手环端 BandBox）。 */
export const TARGET_PKG = 'com.miband.box'

/** 单条 JSON 超过该字节数就分片。 */
export const CHUNK_LIMIT = 12 * 1024

export const ERRORS = {
  BAD_JSON: 'bad-json',
  NOT_ARMED: 'not-armed',
  WRITE_FAILED: 'write-failed',
  BAD_SEQ: 'bad-seq',
  VERSION: 'version',
  BAD_APP: 'bad-app',
  BAD_TYPE: 'bad-type',
  EMPTY: 'empty'
}

/** 错误码 → 中文提示 */
export const ERROR_TEXT = {
  'bad-json': '消息格式错误',
  'not-armed': '请在手环上打开「从手机传输」页面',
  'write-failed': '手环保存歌词失败',
  'bad-seq': '传输中断，请重新发送',
  'version': '协议版本不匹配，请更新插件',
  'bad-app': '消息来源不匹配',
  'bad-type': '消息类型不匹配',
  'empty': '歌词内容为空'
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
 * 解析手环回执。
 * 返回 { ok: true, msg } 或 { ok: false, reason }。
 */
export function decode(raw) {
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
 * 把歌词行切成若干片，不切断一行。
 * 返回 { chunks: string[], total: number }。
 */
export function splitChunks(text, limit) {
  const max = limit > 0 ? limit : CHUNK_LIMIT
  const lines = String(text == null ? '' : text).split('\n')
  const chunks = []
  let cur = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const add = cur === '' ? line.length : line.length + 1
    if (cur !== '' && cur.length + add > max) {
      chunks.push(cur)
      cur = line
    } else {
      cur = cur === '' ? line : cur + '\n' + line
    }
  }
  if (cur !== '' || chunks.length === 0) {
    chunks.push(cur)
  }
  return { chunks, total: chunks.length }
}

/**
 * 判断单条消息是否需要分片（按 UTF-8 字节数算）。
 */
export function needsChunk(json, limit) {
  const max = limit > 0 ? limit : CHUNK_LIMIT
  return byteLength(json) > max
}

/**
 * UTF-8 字节长度。
 */
export function byteLength(str) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length
  }
  // 兜底：手动按 UTF-8 计算
  let len = 0
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
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
 * 生成唯一 id（不依赖 crypto，保证在快应用环境可用）。
 */
export function makeId(prefix) {
  const p = prefix || 'm'
  const now = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return p + '-' + now + '-' + rand
}

/**
 * 把解析结果打包成发送计划。
 *
 * 返回：
 *   { mode: 'single', json }
 *   { mode: 'chunk', id, title, chunks: string[], total }
 */
export function planSend(title, lines, id) {
  const msgId = id || makeId('ly')
  const body = (lines || []).join('\n')
  const single = encode('lyrics', {
    id: msgId,
    title,
    lines,
    count: (lines || []).length,
    ts: Date.now()
  })
  if (!needsChunk(single)) {
    return { mode: 'single', id: msgId, json: single }
  }
  const { chunks, total } = splitChunks(body)
  return { mode: 'chunk', id: msgId, title, chunks, total }
}

/**
 * 生成 chunk 消息。
 */
export function chunkMessage(id, seq, total, title, data) {
  return encode('chunk', { id, seq, total, title, data })
}

/**
 * 生成 hello 探活消息。
 */
export function hello(id) {
  return encode('hello', { id: id || makeId('h') })
}

/**
 * 解释手环回执，产出给用户看的中文文案。
 */
export function describeReply(msg) {
  if (!msg) return { state: 'unknown', text: '未收到手环回应' }
  switch (msg.type) {
    case 'ack':
      return { state: 'sent', text: '已发送到 ' + (msg.name || '手环') }
    case 'err':
      return {
        state: 'failed',
        text: ERROR_TEXT[msg.reason] || ('失败：' + (msg.reason || '未知原因'))
      }
    case 'pong':
      return { state: 'pong', text: '手环已响应' }
    case 'ready':
      return { state: 'ready', text: '手环已进入「从手机传输」页面' }
    case 'progress':
      return {
        state: 'progress',
        text: '传输中 ' + msg.received + '/' + msg.total
      }
    default:
      return { state: 'unknown', text: '未知回执：' + msg.type }
  }
}

export default {
  APP_ID,
  VERSION,
  TARGET_PKG,
  CHUNK_LIMIT,
  ERRORS,
  ERROR_TEXT,
  message,
  encode,
  decode,
  splitChunks,
  needsChunk,
  byteLength,
  makeId,
  planSend,
  chunkMessage,
  hello,
  describeReply
}
