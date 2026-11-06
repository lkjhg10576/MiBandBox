/**
 * OTP 账户模型：规范化 / 校验 / otpauth:// 解析与生成 / 合并与增量。
 *
 * 本文件在手表端（src/utils/otpAccounts.js）与手机插件端
 * （plugin/bandbox-lyrics-sync/src/otpAccounts.js）各存一份，且**必须逐字一致**
 * （cross 校验）。为保证两份拷贝的 import 路径完全一致，本文件自包含零依赖：
 * Base32 规范化/解码从 src/utils/otp.js 复制最小必需部分（有 RFC 向量单测兜底）。
 *
 * 账户字段与 WhistleO/otp-watch-vela、otp-helper-astrobox-plugin 一致
 * （MIT），保证 otpauth:// 数据层兼容；字段在 M1 全部保留，
 * M2 扩展 HOTP/SHA256/512 时不需要改协议。
 */

const ALGORITHMS = ['SHA1', 'SHA256', 'SHA512']

/** 名称/颁发者长度上限：M1 二维码导出复用通用展示页，宽度有限。 */
const NAME_LIMIT = 40
const ISSUER_LIMIT = 24

/** Base32 字母表（RFC 4648）。 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** 与 otp.js 一致的 Base32 规范化（复制最小实现，理由见文件头）。 */
function normalizeBase32(secret) {
  const s = String(secret == null ? '' : secret).toUpperCase()
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i)
    if (B32.indexOf(ch) >= 0) out += ch
  }
  return out
}

/** 与 otp.js 一致的 Base32 解码（仅用于校验密钥合法性）。 */
function decodeBase32(secret) {
  const clean = normalizeBase32(secret)
  if (!clean) return { ok: false, reason: 'invalid-secret' }
  const mod = clean.length % 8
  if (mod === 1 || mod === 3 || mod === 6) {
    return { ok: false, reason: 'invalid-secret' }
  }
  const bytes = []
  let bits = 0
  let value = 0
  for (let i = 0; i < clean.length; i++) {
    value = ((value << 5) | B32.indexOf(clean.charAt(i))) & 0xffff
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((value >>> bits) & 0xff)
    }
  }
  return { ok: true, bytes: new Uint8Array(bytes) }
}

/** 安全取整：NaN/undefined 回退默认值。 */
function toInt(v, def) {
  const n = Math.floor(Number(v))
  return isNaN(n) ? def : n
}

/** 文本截断（M1 二维码导出复用通用展示页，宽度有限，超长直接截断）。 */
function clampText(v, limit) {
  const s = String(v == null ? '' : v)
  return s.length > limit ? s.slice(0, limit) : s
}

/**
 * 生成账户 id：acc_<ts>_<rand>。两端环境都可用（Date.now + Math.random）。
 * 注意：id 仅用于存储索引与同步合并，不是密钥材料，可预测无安全影响。
 */
function makeAccountId() {
  return 'acc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
}

/**
 * 规范化账户。硬性字段缺失（无 id / 无 secret）返回 null；
 * 其余字段尽量保留：算法/位数/周期不合法时回默认值，不丢密钥。
 * 返回对象的键序固定，JSON.stringify 结果稳定（三态 diff 依赖这一点）。
 */
function normalizeAccount(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = String(raw.id == null ? '' : raw.id)
  if (!id) return null
  const secret = normalizeBase32(raw.secret)
  if (!secret) return null
  const type = raw.type === 'hotp' ? 'hotp' : 'totp'
  let algorithm = String(raw.algorithm == null ? '' : raw.algorithm)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  if (ALGORITHMS.indexOf(algorithm) < 0) algorithm = 'SHA1'
  const digits = toInt(raw.digits, 6) === 8 ? 8 : 6
  let period = toInt(raw.period, 30)
  if (period < 15 || period > 120) period = 30
  let counter = toInt(raw.counter, 0)
  if (counter < 0) counter = 0
  let createdAt = toInt(raw.createdAt, 0)
  if (createdAt <= 0) createdAt = Math.floor(Date.now() / 1000)
  const counterModifiedAt = toInt(raw.counterModifiedAt, 0)
  const extraParams = {}
  if (raw.extraParams && typeof raw.extraParams === 'object' && !Array.isArray(raw.extraParams)) {
    for (const k in raw.extraParams) {
      if (Object.prototype.hasOwnProperty.call(raw.extraParams, k)) {
        extraParams[k] = raw.extraParams[k]
      }
    }
  }
  return {
    id,
    name: clampText(raw.name, NAME_LIMIT),
    issuer: clampText(raw.issuer, ISSUER_LIMIT),
    secret,
    type,
    algorithm,
    digits,
    period,
    counter,
    createdAt,
    counterModifiedAt,
    extraParams
  }
}

/**
 * 严格校验（入库/下发前）。返回 { ok:true, account }（规范化后）或 { ok:false, reason }。
 * reason 与协议错误码对齐：bad-account / bad-secret。
 */
function validateAccount(raw) {
  const a = normalizeAccount(raw)
  if (!a) return { ok: false, reason: 'bad-account' }
  const decoded = decodeBase32(a.secret)
  if (!decoded.ok || !decoded.bytes.length) return { ok: false, reason: 'bad-secret' }
  return { ok: true, account: a }
}

/** 新建账户（自动生成 id 与 createdAt）。字段不合法时返回 null。 */
function newAccount(fields) {
  const f = fields || {}
  return normalizeAccount({
    id: f.id || makeAccountId(),
    name: f.name,
    issuer: f.issuer,
    secret: f.secret,
    type: f.type,
    algorithm: f.algorithm,
    digits: f.digits,
    period: f.period,
    counter: f.counter,
    createdAt: f.createdAt,
    counterModifiedAt: 0,
    extraParams: f.extraParams
  })
}

/**
 * 解析单条 otpauth:// URI。
 * 兼容：`\/` 转义、`&amp;` HTML 转义、参数名大小写、issuer 前缀（Label 或 %3A 编码）。
 * 返回 { ok:true, account } 或 { ok:false, reason: 'bad-account' | 'bad-secret' }。
 */
function parseOtpauthUri(uri) {
  const text = String(uri == null ? '' : uri)
    .trim()
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
  if (!/^otpauth:\/\//i.test(text)) return { ok: false, reason: 'bad-account' }

  const rest = text.slice('otpauth://'.length)
  const qIdx = rest.indexOf('?')
  const pathPart = qIdx >= 0 ? rest.slice(0, qIdx) : rest
  const queryPart = qIdx >= 0 ? rest.slice(qIdx + 1) : ''

  const slash = pathPart.indexOf('/')
  const type = (slash >= 0 ? pathPart.slice(0, slash) : pathPart).toLowerCase()
  const labelRaw = slash >= 0 ? pathPart.slice(slash + 1) : ''
  if (type !== 'totp' && type !== 'hotp') return { ok: false, reason: 'bad-account' }

  const params = {}
  if (queryPart) {
    const pairs = queryPart.split('&')
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i]
      if (!pair) continue
      const eq = pair.indexOf('=')
      const k = (eq >= 0 ? pair.slice(0, eq) : pair).toLowerCase()
      let v = eq >= 0 ? pair.slice(eq + 1) : ''
      try {
        v = decodeURIComponent(v.replace(/\+/g, ' '))
      } catch (e) {
        // 非法百分号编码：保留原文
      }
      if (k) params[k] = v
    }
  }

  let label = labelRaw
  try {
    label = decodeURIComponent(labelRaw)
  } catch (e) {
    // 非法编码：用原文
  }

  let name = label
  let issuerFromLabel = ''
  const colon = label.indexOf(':')
  if (colon > 0) {
    issuerFromLabel = label.slice(0, colon).trim()
    name = label.slice(colon + 1).trim()
  }

  const secret = normalizeBase32(params.secret)
  if (!secret) return { ok: false, reason: 'bad-secret' }
  if (!decodeBase32(secret).ok) return { ok: false, reason: 'bad-secret' }

  if (params.digits !== undefined && params.digits !== '' && params.digits !== '6' && params.digits !== '8') {
    return { ok: false, reason: 'bad-account' }
  }
  const digits = params.digits === '8' ? 8 : 6
  if (type === 'totp' && params.period !== undefined && params.period !== '') {
    const p = toInt(params.period, 0)
    if (p < 15 || p > 120) return { ok: false, reason: 'bad-account' }
  }
  if (type === 'hotp' && params.counter !== undefined && params.counter !== '') {
    if (toInt(params.counter, -1) < 0) return { ok: false, reason: 'bad-account' }
  }

  const issuer = (params.issuer || issuerFromLabel || '').trim()
  const extraParams = {}
  const known = ['secret', 'issuer', 'algorithm', 'digits', 'period', 'counter']
  for (const k in params) {
    if (Object.prototype.hasOwnProperty.call(params, k) && known.indexOf(k) < 0) {
      extraParams[k] = params[k]
    }
  }

  const account = normalizeAccount({
    id: makeAccountId(),
    name,
    issuer,
    secret,
    type,
    algorithm: params.algorithm || 'SHA1',
    digits,
    period: params.period,
    counter: params.counter,
    extraParams
  })
  if (!account) return { ok: false, reason: 'bad-secret' }
  return { ok: true, account }
}

/**
 * 解析一段批量粘贴文本（可含多条 URI、多行、混合空白分隔）。
 * 返回 { ok, accounts, invalid: [{ index, line, reason }], count }。
 */
function parseOtpauthText(text) {
  const s = String(text == null ? '' : text)
  const accounts = []
  const invalid = []
  const tokens = s.split(/\s+/)
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue
    if (/^otpauth:\/\//i.test(token)) {
      const res = parseOtpauthUri(token)
      if (res.ok) accounts.push(res.account)
      else invalid.push({ index: i, line: token, reason: res.reason })
    } else {
      invalid.push({ index: i, line: token, reason: 'bad-account' })
    }
  }
  return { ok: invalid.length === 0, accounts, invalid, count: accounts.length }
}

/**
 * 生成 otpauth:// URI（与 Google Authenticator 导出格式兼容）。
 * 账户不合法返回空串。
 */
function buildOtpauthUri(account) {
  const a = normalizeAccount(account)
  if (!a || !a.secret) return ''
  const label = a.issuer ? a.issuer + ':' + a.name : a.name
  let uri = 'otpauth://' + a.type + '/' + encodeURIComponent(label) + '?secret=' + a.secret
  if (a.issuer) uri += '&issuer=' + encodeURIComponent(a.issuer)
  if (a.algorithm !== 'SHA1') uri += '&algorithm=' + a.algorithm
  if (a.digits !== 6) uri += '&digits=' + a.digits
  if (a.type === 'totp' && a.period !== 30) uri += '&period=' + a.period
  if (a.type === 'hotp') uri += '&counter=' + a.counter
  return uri
}

/** 全量导出：多行 otpauth:// URI 文本（空列表返回空串）。 */
function exportAllAsUris(accounts) {
  const list = Array.isArray(accounts) ? accounts : []
  const lines = []
  for (let i = 0; i < list.length; i++) {
    const uri = buildOtpauthUri(list[i])
    if (uri) lines.push(uri)
  }
  return lines.join('\n')
}

/**
 * 按 id 合并：incoming 覆盖 existing 中同 id 项（保持原位置），新项追加到尾部。
 * 不删除未出现的项。返回新数组，不改入参。
 */
function upsertAccounts(existing, incoming) {
  const list = (Array.isArray(existing) ? existing : [])
    .map((a) => normalizeAccount(a))
    .filter(Boolean)
  const inc = (Array.isArray(incoming) ? incoming : [])
    .map((a) => normalizeAccount(a))
    .filter(Boolean)
  const result = []
  const seen = {}
  for (let i = 0; i < list.length; i++) {
    seen[list[i].id] = true
    result.push(list[i])
  }
  for (let i = 0; i < inc.length; i++) {
    const n = inc[i]
    if (seen[n.id]) {
      for (let j = 0; j < result.length; j++) {
        if (result[j].id === n.id) {
          result[j] = n
          break
        }
      }
    } else {
      seen[n.id] = true
      result.push(n)
    }
  }
  return result
}

/**
 * 增量合并：先删 removeIds，再应用 upsert。返回新数组，不改入参。
 */
function mergeDelta(existing, upsert, removeIds) {
  const removeSet = {}
  const ids = Array.isArray(removeIds) ? removeIds : []
  for (let i = 0; i < ids.length; i++) removeSet[String(ids[i])] = true
  const list = (Array.isArray(existing) ? existing : []).filter((a) => {
    return a && a.id && !removeSet[a.id]
  })
  return upsertAccounts(list, upsert)
}

/**
 * 判断两个账户是否指向同一凭据（导入去重用：issuer+name+type+secret 一致）。
 */
function sameAccountCore(a, b) {
  const x = normalizeAccount(a)
  const y = normalizeAccount(b)
  if (!x || !y) return false
  return x.secret === y.secret && x.issuer === y.issuer && x.name === y.name && x.type === y.type
}

export default {
  ALGORITHMS,
  NAME_LIMIT,
  ISSUER_LIMIT,
  normalizeBase32,
  decodeBase32,
  makeAccountId,
  normalizeAccount,
  validateAccount,
  newAccount,
  parseOtpauthUri,
  parseOtpauthText,
  buildOtpauthUri,
  exportAllAsUris,
  upsertAccounts,
  mergeDelta,
  sameAccountCore
}
