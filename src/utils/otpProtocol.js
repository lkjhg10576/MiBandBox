/**
 * BandBox 动态口令同步协议：纯 JS 实现（协议规格副本）。
 *
 * 本文件在手表端（src/utils/otpProtocol.js）与手机插件端
 * （plugin/bandbox-helper/src/otpProtocol.js）各存一份，行为与常量
 * **必须一致**（cross 校验比对常量与 planSync/splitAccountChunks 行为）。
 * 自包含零依赖；不出现 TextEncoder/console/setTimeout。
 *
 * 与歌词协议（bandbox-lyrics）共用同一条 @system.interconnect 通道，
 * 双方都靠 app 字段分流；消息公共字段 { app:'bandbox-otp', v:1, type, id, ts }。
 * id 必须唯一：手表端 interconnect 有 80ms 同文本去重，重复文本会被吞。
 *
 * 消息表：
 *   手机→手表 hello          { time }                     （复用歌词心跳节奏，同次遍历多发一条）
 *   手表→手机 ready/pong     { accountsCount, timeOffsetSec, time, id? }
 *   手机→手表 list_accounts  { id }
 *   手表→手机 accounts       { id, accounts[] }
 *   手机→手表 upsert_accounts{ id, accounts[] }
 *   手机→手表 remove_account { id, ids[] }
 *   手机→手表 sync_delta     { id, upsert[], remove[] }
 *   手表→手机 set_offset 确认走 ack；set_offset 本身是手机→手表 { id, offset }
 *   手表→手机 ack/err/progress { id, ok?/reason/received,total }
 *   双向     chunk           { id, seq, total, kind, field, data }
 *
 * 分片口径沿用歌词协议：CHUNK_LIMIT=12KB、ENVELOPE_RESERVE=256，
 * 但按**单个账户条目**（JSON 字节）切分；单账户超预算由插件解析期拒绝（too-large）。
 */

export const APP_ID = 'bandbox-otp'
export const VERSION = 1

/** 目标快应用包名（手表端 BandBox）。手表侧不用，保留以保持两份一致。 */
export const TARGET_PKG = 'com.miband.box'

/** 单条 JSON 消息的分片阈值（字节，按上线消息的 UTF-8 字节数计）。 */
export const CHUNK_LIMIT = 12 * 1024

/** 分片消息外层（app/v/type/id/seq/total/kind/field）的字节预留。 */
export const ENVELOPE_RESERVE = 256

export const ERRORS = {
  BAD_JSON: 'bad-json',
  BAD_APP: 'bad-app',
  VERSION: 'version',
  BAD_TYPE: 'bad-type',
  BAD_SECRET: 'bad-secret',
  BAD_ACCOUNT: 'bad-account',
  BAD_SEQ: 'bad-seq',
  WRITE_FAILED: 'write-failed',
  NOT_READY: 'not-ready',
  TOO_LARGE: 'too-large',
  UNSUPPORTED: 'unsupported-algorithm',
  UNKNOWN_ID: 'unknown-id'
}

/** 错误码 → 中文提示（两端同步）。 */
export const ERROR_TEXT = {
  'bad-json': '消息格式错误',
  'bad-app': '消息来源不匹配',
  'version': '协议版本不匹配，请更新插件或手环应用',
  'bad-type': '消息类型不匹配',
  'bad-secret': '密钥无效（需 Base32）',
  'bad-account': '账户数据无效',
  'bad-seq': '传输中断，请重新发送',
  'write-failed': '手环保存账户失败',
  'not-ready': '手环未就绪',
  'too-large': '单条账户数据过大',
  'unsupported-algorithm': '手环暂不支持该算法',
  'unknown-id': '账户不存在'
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
 * 解析 OTP 协议消息。
 * 返回 { ok: true, msg } 或 { ok: false, reason }。
 * 非 OTP 消息（歌词协议等）返回 bad-app，调用方静默忽略。
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
 * 一段文本放进 JSON 字符串后所占的字节数（不含两端引号）。
 * 用 JSON.stringify 量，转义开销（\" \\ 中文原样）自动计入。
 */
export function jsonTextCost(text) {
  return byteLength(JSON.stringify(String(text == null ? '' : text))) - 2
}

/**
 * 生成唯一 id。两端环境都可用（Date.now + Math.random）；
 * 仅用于消息去重与回执关联，不是密钥材料。
 */
export function makeId(prefix) {
  const p = prefix || 'ot'
  const now = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return p + '-' + now + '-' + rand
}

/**
 * 单片预算：CHUNK_LIMIT - ENVELOPE_RESERVE。
 * 解析期校验与发送期切分必须用同一个函数。
 */
export function chunkBudget() {
  return CHUNK_LIMIT - ENVELOPE_RESERVE
}

/**
 * 按**单个账户条目**切分成组（JSON 字节计量，含条目间逗号开销）。
 * 超过单片预算的账户进入 tooLarge（不发、由上层拒绝导入/上报 too-large）。
 * 返回 { groups: [account[]], tooLarge: [index], total }。
 */
export function splitAccountChunks(accounts, limit) {
  const max = limit > 0 ? limit : chunkBudget()
  const arr = Array.isArray(accounts) ? accounts : []
  const groups = []
  const tooLarge = []
  let buf = []
  let cost = 0
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i]
    const c = jsonTextCost(JSON.stringify(item))
    if (c + 1 > max) {
      // +1 是条目后的逗号；单条都装不下
      tooLarge.push(i)
      continue
    }
    if (buf.length && cost + 1 + c > max) {
      groups.push(buf)
      buf = []
      cost = 0
    }
    if (buf.length) cost += 1
    cost += c
    buf.push(item)
  }
  groups.push(buf)
  return { groups, tooLarge, total: groups.length }
}

/**
 * 按 id 字符串切分成组（remove_account/sync_delta 的 remove 字段用）。
 */
export function splitIdChunks(ids, limit) {
  const max = limit > 0 ? limit : chunkBudget()
  const arr = Array.isArray(ids) ? ids : []
  const groups = []
  const tooLarge = []
  let buf = []
  let cost = 0
  for (let i = 0; i < arr.length; i++) {
    const item = String(arr[i] == null ? '' : arr[i])
    const c = jsonTextCost(item)
    if (c + 1 > max) {
      tooLarge.push(i)
      continue
    }
    if (buf.length && cost + 1 + c > max) {
      groups.push(buf)
      buf = []
      cost = 0
    }
    if (buf.length) cost += 1
    cost += c
    buf.push(item)
  }
  groups.push(buf)
  return { groups, tooLarge, total: groups.length }
}

/**
 * 生成 chunk 消息。
 */
export function chunkMessage(id, seq, total, kind, field, data) {
  return encode('chunk', { id, seq, total, kind, field, data })
}

/**
 * 把一次同步打包成发送计划。
 *
 * kind：
 *   'accounts'        payload { accounts }   —— 手表→手机 应答 list_accounts
 *   'upsert_accounts' payload { accounts }   —— 手机→手表 全量覆盖式 upsert
 *   'sync_delta'      payload { upsert, remove } —— 手机→手表 增量
 *
 * 返回：
 *   { mode:'single', id, json }
 *   { mode:'chunk', id, jsons: string[], total }
 *   { mode:'invalid', reason:'too-large', index, id } —— 单账户超预算，调用方拒绝
 */
export function planSync(kind, payload, id) {
  const msgId = id || makeId('ot')

  if (kind === 'sync_delta') {
    const upsert = Array.isArray(payload && payload.upsert) ? payload.upsert : []
    const remove = Array.isArray(payload && payload.remove) ? payload.remove : []
    const single = encode('sync_delta', { id: msgId, upsert, remove, ts: Date.now() })
    if (byteLength(single) <= CHUNK_LIMIT) {
      return { mode: 'single', id: msgId, json: single }
    }
    const spU = splitAccountChunks(upsert)
    if (spU.tooLarge.length) {
      return { mode: 'invalid', reason: ERRORS.TOO_LARGE, index: spU.tooLarge[0], id: msgId }
    }
    const spR = splitIdChunks(remove)
    const jsons = []
    const total = spU.groups.length + spR.groups.length
    let seq = 0
    for (let i = 0; i < spU.groups.length; i++) {
      jsons.push(
        chunkMessage(msgId, seq++, total, 'sync_delta', 'upsert', JSON.stringify(spU.groups[i]))
      )
    }
    for (let i = 0; i < spR.groups.length; i++) {
      jsons.push(
        chunkMessage(msgId, seq++, total, 'sync_delta', 'remove', JSON.stringify(spR.groups[i]))
      )
    }
    return { mode: 'chunk', id: msgId, jsons, total }
  }

  const accounts = Array.isArray(payload && payload.accounts) ? payload.accounts : []
  const single = encode(kind, { id: msgId, accounts, ts: Date.now() })
  if (byteLength(single) <= CHUNK_LIMIT) {
    return { mode: 'single', id: msgId, json: single }
  }
  const sp = splitAccountChunks(accounts)
  if (sp.tooLarge.length) {
    return { mode: 'invalid', reason: ERRORS.TOO_LARGE, index: sp.tooLarge[0], id: msgId }
  }
  const jsons = []
  for (let i = 0; i < sp.groups.length; i++) {
    jsons.push(
      chunkMessage(msgId, i, sp.groups.length, kind, 'accounts', JSON.stringify(sp.groups[i]))
    )
  }
  return { mode: 'chunk', id: msgId, jsons, total: jsons.length }
}

/**
 * 分片会话状态机：按 seq 顺序累积分片，收齐后按 field 拼装还原 payload。
 */
export function createSession() {
  return { id: '', total: 0, seq: -1, kind: '', parts: [] }
}

/**
 * 处理一条 chunk 消息。
 * 返回 { ok, done?, received?, total?, payload?, reason? }
 *   - ok:false  需要回 err
 *   - done:true 全部到齐，payload 已还原
 */
export function acceptChunk(session, msg) {
  if (typeof msg.seq !== 'number' || typeof msg.total !== 'number') {
    return { ok: false, reason: ERRORS.BAD_SEQ }
  }
  if (msg.total <= 0 || msg.seq < 0 || msg.seq >= msg.total) {
    return { ok: false, reason: ERRORS.BAD_SEQ }
  }
  const kind = typeof msg.kind === 'string' ? msg.kind : ''
  const field = typeof msg.field === 'string' ? msg.field : ''
  if (!kind || !field) return { ok: false, reason: ERRORS.BAD_TYPE }
  if (session.id !== msg.id || session.kind !== kind) {
    // 新的会话
    session.id = String(msg.id == null ? '' : msg.id)
    session.total = msg.total
    session.seq = -1
    session.kind = kind
    session.parts = []
  }
  if (session.total !== msg.total) {
    // 同一 id 的总片数变了
    return { ok: false, reason: ERRORS.BAD_SEQ }
  }
  if (msg.seq !== session.seq + 1) {
    // 乱序或缺片
    return { ok: false, reason: ERRORS.BAD_SEQ }
  }
  session.seq = msg.seq
  session.parts.push({ field, data: String(msg.data == null ? '' : msg.data) })
  const received = session.parts.length
  if (received < session.total) {
    return { ok: true, done: false, received, total: session.total }
  }
  // 拼装：各片 data 是 JSON 数组字符串，按 field 归并
  const accounts = []
  const upsert = []
  const remove = []
  for (let i = 0; i < session.parts.length; i++) {
    const part = session.parts[i]
    let arr
    try {
      arr = JSON.parse(part.data)
    } catch (e) {
      return { ok: false, reason: ERRORS.BAD_ACCOUNT }
    }
    if (!Array.isArray(arr)) return { ok: false, reason: ERRORS.BAD_ACCOUNT }
    if (part.field === 'accounts') {
      for (let j = 0; j < arr.length; j++) accounts.push(arr[j])
    } else if (part.field === 'upsert') {
      for (let j = 0; j < arr.length; j++) upsert.push(arr[j])
    } else if (part.field === 'remove') {
      for (let j = 0; j < arr.length; j++) remove.push(String(arr[j]))
    } else {
      return { ok: false, reason: ERRORS.BAD_TYPE }
    }
  }
  const payload = kind === 'sync_delta' ? { upsert, remove } : { accounts }
  return { ok: true, done: true, received, total: session.total, kind, payload }
}

// ------------------------------------------------------------------
// 消息构造器
// ------------------------------------------------------------------

/** 手机→手表 心跳（带手机 Unix 秒，供手表提示时间偏差）。 */
export function helloMessage(time, id) {
  return encode('hello', { id: id || makeId('oh'), time: Math.floor(Number(time) || 0) })
}

/** 手表→手机 就绪广播。 */
export function readyMessage(accountsCount, timeOffsetSec, time) {
  return encode('ready', {
    accountsCount: Math.floor(Number(accountsCount) || 0),
    timeOffsetSec: Math.floor(Number(timeOffsetSec) || 0),
    time: Math.floor(Number(time) || 0)
  })
}

/** 手表→手机 回复心跳。 */
export function pongMessage(id, accountsCount, timeOffsetSec, time) {
  return encode('pong', {
    id: id || '',
    accountsCount: Math.floor(Number(accountsCount) || 0),
    timeOffsetSec: Math.floor(Number(timeOffsetSec) || 0),
    time: Math.floor(Number(time) || 0)
  })
}

/** 手表→手机 或 手机→手表 探测心跳。 */
export function pingMessage(id) {
  return encode('ping', { id: id || makeId('op') })
}

/** 手机→手表 拉取全量。 */
export function listAccountsMessage(id) {
  return encode('list_accounts', { id: id || makeId('ol') })
}

/** 手机→手表 设置时间偏移（秒；快了为负）。 */
export function setOffsetMessage(offset, id) {
  return encode('set_offset', {
    id: id || makeId('os'),
    offset: Math.floor(Number(offset) || 0)
  })
}

/** 手表→手机 确认。 */
export function ackMessage(id, received) {
  const payload = { id, ok: true }
  if (typeof received === 'number') payload.received = received
  return encode('ack', payload)
}

/** 手表→手机 错误。 */
export function errMessage(id, reason) {
  return encode('err', { id, reason: reason || ERRORS.BAD_ACCOUNT })
}

/** 手表→手机 分片进度。 */
export function progressMessage(id, received, total) {
  return encode('progress', { id, received, total })
}

/**
 * 解释手表回执，产出给用户看的中文文案（插件侧用）。
 */
export function describeReply(msg) {
  if (!msg) return { state: 'unknown', text: '未收到手环回应' }
  switch (msg.type) {
    case 'ack':
      return { state: 'sent', text: '手环已保存' }
    case 'err':
      return {
        state: 'failed',
        text: ERROR_TEXT[msg.reason] || ('失败：' + (msg.reason || '未知原因'))
      }
    case 'pong':
      return { state: 'pong', text: '手环已响应' }
    case 'ping':
      return { state: 'ping', text: '收到心跳探测' }
    case 'ready':
      return { state: 'ready', text: '手环动态口令已就绪' }
    case 'accounts':
      return { state: 'accounts', text: '已拉取 ' + (msg.accounts ? msg.accounts.length : 0) + ' 个账户' }
    case 'progress':
      return { state: 'progress', text: '传输中 ' + msg.received + '/' + msg.total }
    default:
      return { state: 'unknown', text: '未知回执：' + msg.type }
  }
}

/**
 * 解宿主的 interconnect-message 信封（插件侧使用；手表侧消息本来就是裸文本，
 * 手表侧保留此函数仅为两份副本一致）。
 *
 * 宿主可能把快应用消息包成 { addr, pkgName, payloadText, payloadHex, payload }，
 * 也可能直接传协议 JSON（裸消息）。统一返回 { addr, pkgName, data }。
 * payloadHex 按 UTF-8 手写解码（OTP 消息是 JSON.stringify 产物，UTF-8 足够，
 * 不需要 lrc.js 的 GBK 解码）。
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

  // 已经是协议消息本身（本协议或歌词协议都按裸消息放行，由上层按 app 分流）
  if (obj.app === APP_ID || obj.app === 'bandbox-lyrics') {
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
    return { addr, pkgName, data: hexToUtf8(obj.payloadHex) }
  }
  if (typeof obj.data === 'string' && obj.data) {
    return { addr, pkgName, data: obj.data }
  }

  return { addr, pkgName, data: raw }
}

/** 十六进制 → UTF-8 文本（手写解码，含 4 字节序列的代理对）。 */
function hexToUtf8(hex) {
  const clean = String(hex == null ? '' : hex).replace(/[^0-9a-fA-F]/g, '')
  const len = Math.floor(clean.length / 2)
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  }
  return utf8Decode(bytes)
}

function utf8Decode(bytes) {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    if (b < 0x80) {
      out += String.fromCharCode(b)
      i += 1
    } else if (b < 0xe0 && bytes.length - i >= 2) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f))
      i += 2
    } else if (b < 0xf0 && bytes.length - i >= 3) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)
      )
      i += 3
    } else if (bytes.length - i >= 4) {
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f)
      const v = cp - 0x10000
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
      i += 4
    } else {
      i += 1
    }
  }
  return out
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
  parse,
  byteLength,
  jsonTextCost,
  chunkBudget,
  splitAccountChunks,
  splitIdChunks,
  chunkMessage,
  planSync,
  createSession,
  acceptChunk,
  helloMessage,
  readyMessage,
  pongMessage,
  pingMessage,
  listAccountsMessage,
  setOffsetMessage,
  ackMessage,
  errMessage,
  progressMessage,
  describeReply,
  unwrapInterconnectPayload,
  makeId
}
