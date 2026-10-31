/**
 * BandBox 歌词传输协议：纯 JS 实现。
 *
 * 与手机端 AstroBox 插件（BandBox歌词同步）约定的私有协议：
 *   - 所有消息都是 UTF-8 JSON 字符串
 *   - 公共字段：app = "bandbox-lyrics"、v = 1、type
 *   - 手机→手环：hello / lyrics / chunk
 *   - 手环→手机：pong / ack / err / ready / progress
 *
 * 本文件不得 import 任何 @system.* 模块，以便用 Node 直接跑单测。
 */

const APP_ID = 'bandbox-lyrics'
const VERSION = 1

/** 单条 JSON 消息的分片阈值（字节）。超过则按行切块。 */
const CHUNK_LIMIT = 12 * 1024

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
 * 把歌词文本切成若干片，保证不切断一行。
 * 返回 { chunks: string[], total: number }，chunks 是每片的文本片段。
 */
function splitChunks(text, limit) {
  const max = limit > 0 ? limit : CHUNK_LIMIT
  const lines = String(text == null ? '' : text).split('\n')
  const chunks = []
  let cur = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 加上换行符后的长度
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
 */
function ready() {
  return message('ready', {})
}

export default {
  APP_ID,
  VERSION,
  CHUNK_LIMIT,
  ERRORS,
  message,
  parse,
  splitChunks,
  buildText,
  toLyricsPayload,
  createSession,
  acceptChunk,
  ack,
  err,
  progress,
  ready
}
