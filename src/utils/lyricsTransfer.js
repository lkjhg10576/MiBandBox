/**
 * BandBox 歌词传输协议：纯 JS 实现。
 *
 * 与手机端 AstroBox 插件（BandBox辅助）约定的私有协议：
 *   - 所有消息都是 UTF-8 JSON 字符串
 *   - 公共字段：app = "bandbox-lyrics"、v = 1、type
 *   - 手机→手环：hello / lyrics / chunk
 *   - 手环→手机：pong / ack / err / ready / progress
 *
 * 本文件不得 import 任何 @system.* 模块，以便用 Node 直接跑单测。
 */

const APP_ID = 'bandbox-lyrics'
const VERSION = 1

/** 单条 JSON 消息的分片阈值（字节，按上线消息的 UTF-8 字节数计）。超过则按行切块。 */
const CHUNK_LIMIT = 12 * 1024

/** 分片消息外层（app/v/type/id/seq/total/title）的字节预留（与插件端一致）。 */
const ENVELOPE_RESERVE = 256

const ERRORS = {
  BAD_JSON: 'bad-json',
  NOT_ARMED: 'not-armed',
  WRITE_FAILED: 'write-failed',
  BAD_SEQ: 'bad-seq',
  VERSION: 'version',
  BAD_APP: 'bad-app',
  BAD_TYPE: 'bad-type',
  EMPTY: 'empty'
}

/**
 * 构造一条消息。
 */
function message(type, payload) {
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
 * 解析手机发来的消息。
 * 返回 { ok: true, msg } 或 { ok: false, reason }。
 */
function parse(raw) {
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
  if (obj.app !== APP_ID) {
    return { ok: false, reason: ERRORS.BAD_APP }
  }
  if (obj.v !== VERSION) {
    return { ok: false, reason: ERRORS.VERSION }
  }
  if (typeof obj.type !== 'string') {
    return { ok: false, reason: ERRORS.BAD_TYPE }
  }
  return { ok: true, msg: obj }
}

/**
 * UTF-8 字节长度（与插件端 protocol.js 同款实现）。
 */
function byteLength(str) {
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
 * 一段文本放进 JSON 字符串后所占的字节数（不含两端引号）。
 * 用 JSON.stringify 量，转义开销（\" \\ \n \r 等）自动计入。
 */
function jsonTextCost(text) {
  return byteLength(JSON.stringify(String(text == null ? '' : text))) - 2
}

/**
 * 把歌词文本切成若干片，按 **JSON 字节**计量（UTF-8 + 转义开销），保证不切断一行。
 * 与插件端 protocol.js 的 splitChunks 逐字一致（协议规格副本，手环端运行时不发送）。
 * 返回 { chunks: string[], total: number }，chunks 是每片的文本片段。
 */
function splitChunks(text, limit) {
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
 * 组装落盘文本：首行是标题，其余是正文。
 * body 可以是行数组，也可以是已用 \n 拼接好的正文串。
 */
function buildText(title, body) {
  const text = Array.isArray(body) ? body.join('\n') : String(body == null ? '' : body)
  const head = String(title == null ? '' : title)
  return text === '' ? head : head + '\n' + text
}

/**
 * 从手机发来的 lyrics 消息构造待落盘内容。
 */
function toLyricsPayload(msg) {
  const title = typeof msg.title === 'string' ? msg.title : ''
  if (!title) {
    return { ok: false, reason: ERRORS.EMPTY }
  }
  if (!Array.isArray(msg.lines) || msg.lines.length === 0) {
    return { ok: false, reason: ERRORS.EMPTY }
  }
  return {
    ok: true,
    title,
    lines: msg.lines.map((l) => String(l)),
    text: buildText(title, msg.lines)
  }
}

/**
 * 分片会话状态机：按 seq 顺序累积分片。
 */
function createSession() {
  return {
    id: '',
    total: 0,
    seq: -1,
    title: '',
    parts: [],
    startedAt: 0
  }
}

/**
 * 处理一条 chunk 消息。
 * 返回 { ok, reason?, received?, total?, done?, text?, title? }
 *   - ok:false  需要回 err
 *   - done:true 全部到齐，应当落盘
 */
function acceptChunk(session, msg) {
  if (typeof msg.seq !== 'number' || typeof msg.total !== 'number') {
    return { ok: false, reason: ERRORS.BAD_SEQ }
  }
  if (msg.total <= 0 || msg.seq < 0 || msg.seq >= msg.total) {
    return { ok: false, reason: ERRORS.BAD_SEQ }
  }
  if (session.id !== msg.id) {
    // 新的会话
    session.id = String(msg.id == null ? '' : msg.id)
    session.total = msg.total
    session.seq = -1
    session.title = typeof msg.title === 'string' ? msg.title : ''
    session.parts = []
  }
  if (session.total !== msg.total) {
    // 同一 id 的总片数变了，视为坏序列
    return { ok: false, reason: ERRORS.BAD_SEQ }
  }
  if (msg.seq !== session.seq + 1) {
    // 乱序或缺片
    return { ok: false, reason: ERRORS.BAD_SEQ }
  }
  session.seq = msg.seq
  session.parts.push(String(msg.data == null ? '' : msg.data))
  const received = session.parts.length
  if (received < session.total) {
    return { ok: true, done: false, received, total: session.total }
  }
  return {
    ok: true,
    done: true,
    received,
    total: session.total,
    title: session.title,
    text: session.parts.join('\n')
  }
}

/**
 * 生成 ACK 文案。
 */
function ack(id, name) {
  return message('ack', { id, ok: true, name })
}

/**
 * 生成 ERR 文案。
 */
function err(id, reason) {
  return message('err', { id, reason })
}

/**
 * 生成 progress 文案。
 */
function progress(id, received, total) {
  return message('progress', { id, received, total })
}

/**
 * 生成 ready 文案（手环进入「从手机传输」页时上报）。
 * id 可选：插件会原样回 pong，手环用它确认这次探测。
 */
function ready(id) {
  return message('ready', id ? { id } : {})
}

/**
 * 生成 ping 文案（手环主动探活手机插件）。
 */
function ping(id) {
  return message('ping', { id: id || '' })
}

/**
 * 生成 pong 文案（手环回复手机插件的 hello / ping）。
 */
function pong(id) {
  return message('pong', { id: id || '' })
}

export default {
  APP_ID,
  VERSION,
  CHUNK_LIMIT,
  ENVELOPE_RESERVE,
  ERRORS,
  message,
  parse,
  byteLength,
  jsonTextCost,
  splitChunks,
  buildText,
  toLyricsPayload,
  createSession,
  acceptChunk,
  ack,
  err,
  progress,
  ready,
  ping,
  pong
}
