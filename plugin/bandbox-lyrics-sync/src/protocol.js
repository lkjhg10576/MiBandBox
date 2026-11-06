/**
 * 手机→手环 的传输协议（与手环端 src/utils/lyricsTransfer.js 保持一致）。
 *
 * 约定：所有消息都是 UTF-8 JSON 字符串。
 * 公共字段：app = "bandbox-lyrics"、v = 1、type。
 */
import { decodeText } from './lrc.js'

export const APP_ID = 'bandbox-lyrics'
export const VERSION = 1

/** 目标快应用包名（手环端 BandBox）。 */
export const TARGET_PKG = 'com.miband.box'

/** 单条 JSON 超过该字节数就分片（按上线消息的 UTF-8 字节数计）。 */
export const CHUNK_LIMIT = 12 * 1024

/** 分片消息外层（app/v/type/id/seq/total/title）的字节预留。 */
export const ENVELOPE_RESERVE = 256

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
 * 解宿主的 interconnect-message 信封。
 *
 * 宿主可能把快应用消息包成：
 *   { addr, pkgName, payloadText, payloadHex, payload }
 * 也可能直接传协议 JSON（旧宿主 / 裸消息）。统一返回 { addr, pkgName, data }。
 *
 * @param {string} raw
 * @returns {{addr: string, pkgName: string, data: string}}
 */
export function unwrapInterconnectPayload(raw) {
  if (typeof raw !== 'string') {
    if (raw && typeof raw === 'object' && typeof raw.data === 'string') {
      return { addr: '', pkgName: '', data: raw.data }
    }
    return { addr: '', pkgName: '', data: '' }
  }

  let obj
  try {
    obj = JSON.parse(raw)
  } catch (e) {
    return { addr: '', pkgName: '', data: raw }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { addr: '', pkgName: '', data: raw }
  }

  // 已经是协议消息本身（歌词协议与动态口令协议都按裸消息放行，
  // 由 plugin.js 的 handleReply 按 app 字段分流；否则 OTP 的 chunk.data
  // 字符串会被误当成信封 payload）
  if (obj.app === APP_ID || obj.app === 'bandbox-otp') {
    return { addr: '', pkgName: '', data: raw }
  }

  const addr = typeof obj.addr === 'string' ? obj.addr : ''
  const pkgName = typeof obj.pkgName === 'string' ? obj.pkgName : ''

  if (typeof obj.payloadText === 'string' && obj.payloadText) {
    return { addr, pkgName, data: obj.payloadText }
  }
  if (typeof obj.payload === 'string' && obj.payload) {
    return { addr, pkgName, data: obj.payload }
  }
  if (obj.payload && typeof obj.payload === 'object') {
    return { addr, pkgName, data: JSON.stringify(obj.payload) }
  }
  if (typeof obj.payloadHex === 'string' && obj.payloadHex) {
    return { addr, pkgName, data: hexToText(obj.payloadHex) }
  }
  if (typeof obj.data === 'string' && obj.data) {
    return { addr, pkgName, data: obj.data }
  }

  return { addr, pkgName, data: raw }
}

/**
 * 十六进制字符串 → UTF-8/GBK 文本。
 */
function hexToText(hex) {
  const clean = String(hex).replace(/[^0-9a-fA-F]/g, '')
  const len = Math.floor(clean.length / 2)
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  }
  return decodeText(bytes)
}

/**
 * 一段文本放进 JSON 字符串后所占的字节数（不含两端引号）。
 * 用 JSON.stringify 量，转义开销（\" \\ \n \r 等）自动计入。
 */
export function jsonTextCost(text) {
  return byteLength(JSON.stringify(String(text == null ? '' : text))) - 2
}

/**
 * 单片正文可用的字节预算 = 12 KB - 外层预留 - 标题字节。
 * 解析期校验与发送期切分必须用同一个函数，保证「校验通过 = 一定切得开」。
 */
export function chunkBudget(title) {
  return CHUNK_LIMIT - ENVELOPE_RESERVE - byteLength(String(title == null ? '' : title))
}

/**
 * 把歌词行切成若干片，按 **JSON 字节**计量（UTF-8 + 转义开销），不切断一行。
 * 返回 { chunks: string[], total: number }。
 */
export function splitChunks(text, limit) {
  const max = limit > 0 ? limit : CHUNK_LIMIT
  const lines = String(text == null ? '' : text).split('\n')
  const chunks = []
  let buf = [] // 当前片的行数组（不用空串当哨兵，避免前导空行被吞）
  let cost = 0 // 当前片累计 JSON 字节
  for (let i = 0; i < lines.length; i++) {
    const lc = jsonTextCost(lines[i])
    // 行间换行在 JSON 里转义成 \n，占 2 字节
    if (buf.length && cost + 2 + lc > max) {
      chunks.push(buf.join('\n'))
      buf = []
      cost = 0
    }
    if (buf.length) cost += 2
    cost += lc
    buf.push(lines[i])
  }
  chunks.push(buf.join('\n'))
  return { chunks, total: chunks.length }
}

/**
 * 校验一份歌词是否可以整份传输。
 * 单行正文超预算（切不开、会破坏「不切断一行」约定）或标题超长时返回失败，
 * 插件端据此在解析期拒绝导入。
 * 返回 { ok: true } 或 { ok: false, reason, lineIndex?, bytes?, limit? }。
 */
export function checkTransferable(title, lines) {
  const t = String(title == null ? '' : title)
  const titleLimit = CHUNK_LIMIT - ENVELOPE_RESERVE
  const tBytes = byteLength(t)
  if (tBytes > titleLimit) {
    return { ok: false, reason: 'title-too-long', bytes: tBytes, limit: titleLimit }
  }
  const budget = chunkBudget(t)
  const arr = Array.isArray(lines) ? lines : []
  for (let i = 0; i < arr.length; i++) {
    const cost = jsonTextCost(arr[i])
    if (cost > budget) {
      return { ok: false, reason: 'line-too-long', lineIndex: i, bytes: cost, limit: budget }
    }
  }
  return { ok: true }
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
  const { chunks, total } = splitChunks(body, chunkBudget(title))
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
 * 生成 pong 消息（回复手环的 ready / ping）。
 */
export function pong(id) {
  return encode('pong', { id: id || '' })
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
  ENVELOPE_RESERVE,
  ERRORS,
  ERROR_TEXT,
  message,
  encode,
  decode,
  unwrapInterconnectPayload,
  jsonTextCost,
  chunkBudget,
  splitChunks,
  checkTransferable,
  needsChunk,
  byteLength,
  makeId,
  planSend,
  chunkMessage,
  hello,
  pong,
  describeReply
}
