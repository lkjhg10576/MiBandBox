/**
 * OTP/TOTP 纯逻辑内核：Base32、SHA-1、HMAC、动态截断、TOTP/HOTP 与账户状态机。
 *
 * 本文件在手表端（src/utils/otp.js）与手机插件端（plugin/bandbox-lyrics-sync/src/otp.js）
 * 各存一份，且**必须逐字一致**（插件 test/otp-cross.test.mjs
 * 用 SHA-256 校验）。因此本文件：
 *   - 不 import 任何模块（零依赖）
 *   - 不出现 TextEncoder/TextDecoder/console/setTimeout
 *   - 不用 BigInt（M2 的 SHA-512 用高低 32 位字模拟，协议字段已预留）
 *
 * SHA-1 为纯 JS 自写实现：不引入 jssha（需 TextEncoder polyfill 且违反
 * 「无新增第三方依赖」约定）；不依赖 @system.crypto（它只提供 getRandomValues，
 * 没有 HMAC）。
 */

/** M2 会扩展 SHA-256/SHA-512；M1 只支持 SHA1，其余算法返回 unsupported-algorithm。 */
const ALGORITHMS = ['SHA1', 'SHA256', 'SHA512']

const REASON = {
  INVALID_SECRET: 'invalid-secret',
  UNSUPPORTED: 'unsupported-algorithm',
  INVALID_ACCOUNT: 'invalid-account'
}

/** Base32 字母表（RFC 4648）。 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/**
 * 规范化 Base32 密钥：大写、剔除空格/连字符/等号 padding 与一切非字母表字符。
 * 与两类参考实现保持相同的宽容度（用户从截图抄写时常见的空格与全大写都能吃下）。
 * 返回空串表示没有有效字符。
 */
function normalizeBase32(secret) {
  const s = String(secret == null ? '' : secret).toUpperCase()
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i)
    if (B32.indexOf(ch) >= 0) out += ch
  }
  return out
}

/**
 * Base32 解码。返回 { ok:true, bytes } 或 { ok:false, reason:'invalid-secret' }。
 * 长度 %8 ∈ {1,3,6} 非法（RFC 4648）；{2,4,5,7} 的尾部位按标准丢弃。
 */
function decodeBase32(secret) {
  const clean = normalizeBase32(secret)
  if (!clean) return { ok: false, reason: REASON.INVALID_SECRET }
  const mod = clean.length % 8
  if (mod === 1 || mod === 3 || mod === 6) {
    return { ok: false, reason: REASON.INVALID_SECRET }
  }
  const bytes = []
  let bits = 0
  let value = 0
  for (let i = 0; i < clean.length; i++) {
    // value 只保留低 16 位：累计到 12 bit 就会被取走一个字节，高位都是垃圾
    value = ((value << 5) | B32.indexOf(clean.charAt(i))) & 0xffff
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((value >>> bits) & 0xff)
    }
  }
  return { ok: true, bytes: new Uint8Array(bytes) }
}

/**
 * 计数器 → 8 字节大端（RFC 4226 5.2 节 C 的 64 位大端编码）。
 * 不用 BigInt：|Number| 范围内的整数精度足够（HOTP 计数器远用不到 2^53）。
 */
function counterToBytes(counter) {
  let c = Math.floor(Number(counter) || 0)
  if (c < 0) c = 0
  const hi = Math.floor(c / 0x100000000)
  const lo = c >>> 0
  return [
    (hi >>> 24) & 0xff,
    (hi >>> 16) & 0xff,
    (hi >>> 8) & 0xff,
    hi & 0xff,
    (lo >>> 24) & 0xff,
    (lo >>> 16) & 0xff,
    (lo >>> 8) & 0xff,
    lo & 0xff
  ]
}

/**
 * 纯 JS SHA-1（FIPS 180-4）。输入 Array/Uint8Array 字节，返回 20 字节 Uint8Array。
 */
function sha1Bytes(input) {
  const srcLen = input.length
  // 0x80 填充 + 8 字节大端位长，向上取整到 64 字节块
  const total = Math.ceil((srcLen + 9) / 64) * 64
  const msg = new Uint8Array(total)
  msg.set(input)
  msg[srcLen] = 0x80
  const bitLen = srcLen * 8
  // 位长高 32 位恒 0（本实现不支持 ≥512MB 输入）
  msg[total - 4] = (bitLen >>> 24) & 0xff
  msg[total - 3] = (bitLen >>> 16) & 0xff
  msg[total - 2] = (bitLen >>> 8) & 0xff
  msg[total - 1] = bitLen & 0xff

  const w = new Int32Array(80)
  let h0 = 0x67452301 | 0
  let h1 = 0xefcdab89 | 0
  let h2 = 0x98badcfe | 0
  let h3 = 0x10325476 | 0
  let h4 = 0xc3d2e1f0 | 0

  for (let off = 0; off < total; off += 64) {
    for (let j = 0; j < 16; j++) {
      const i = off + j * 4
      w[j] = (msg[i] << 24) | (msg[i + 1] << 16) | (msg[i + 2] << 8) | msg[i + 3]
    }
    for (let j = 16; j < 80; j++) {
      const x = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16]
      w[j] = ((x << 1) | (x >>> 31)) | 0
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let j = 0; j < 80; j++) {
      let f
      let k
      if (j < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (j < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) | 0
      e = d
      d = c
      c = ((b << 30) | (b >>> 2)) | 0
      b = a
      a = t
    }
    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
  }

  const out = new Uint8Array(20)
  out[0] = (h0 >>> 24) & 0xff
  out[1] = (h0 >>> 16) & 0xff
  out[2] = (h0 >>> 8) & 0xff
  out[3] = h0 & 0xff
  out[4] = (h1 >>> 24) & 0xff
  out[5] = (h1 >>> 16) & 0xff
  out[6] = (h1 >>> 8) & 0xff
  out[7] = h1 & 0xff
  out[8] = (h2 >>> 24) & 0xff
  out[9] = (h2 >>> 16) & 0xff
  out[10] = (h2 >>> 8) & 0xff
  out[11] = h2 & 0xff
  out[12] = (h3 >>> 24) & 0xff
  out[13] = (h3 >>> 16) & 0xff
  out[14] = (h3 >>> 8) & 0xff
  out[15] = h3 & 0xff
  out[16] = (h4 >>> 24) & 0xff
  out[17] = (h4 >>> 16) & 0xff
  out[18] = (h4 >>> 8) & 0xff
  out[19] = h4 & 0xff
  return out
}

/**
 * HMAC-SHA1（RFC 2104）。key/message 为字节数组，返回 20 字节。
 */
function hmacSha1(key, messageBytes) {
  let k = key
  if (k.length > 64) k = sha1Bytes(k)
  const block = new Uint8Array(64)
  block.set(k)
  const inner = new Uint8Array(64 + messageBytes.length)
  const outer = new Uint8Array(84)
  for (let i = 0; i < 64; i++) {
    inner[i] = block[i] ^ 0x36
    outer[i] = block[i] ^ 0x5c
  }
  inner.set(messageBytes, 64)
  const innerHash = sha1Bytes(inner)
  outer.set(innerHash, 64)
  return sha1Bytes(outer)
}

/**
 * 动态截断（RFC 4226 5.3 节），返回 31 位正整数。
 */
function dynamicTruncate(mac) {
  const off = mac[19] & 0x0f
  return (
    ((mac[off] & 0x7f) << 24) |
    ((mac[off + 1] & 0xff) << 16) |
    ((mac[off + 2] & 0xff) << 8) |
    (mac[off + 3] & 0xff)
  ) >>> 0
}

/** 算法名规范化：'sha-1' → 'SHA1'；未知返回空串。 */
function normalizeAlgorithm(name) {
  const s = String(name == null ? '' : name)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  if (ALGORITHMS.indexOf(s) >= 0) return s
  return ''
}

/** 位数夹取：仅支持 6/7/8，默认 6。 */
function clampDigits(digits) {
  const d = Math.floor(Number(digits) || 0)
  if (d === 8) return 8
  if (d === 7) return 7
  return 6
}

/** 周期夹取：15..120 秒，默认 30。 */
function clampPeriod(period) {
  const p = Math.floor(Number(period) || 0)
  if (p >= 15 && p <= 120) return p
  return 30
}

/**
 * 数字 → 定长验证码字符串（不足补零，超出对 10^digits 取模）。
 */
function padCode(num, digits) {
  const d = clampDigits(digits)
  let s = String(Math.floor(Number(num) || 0) % Math.pow(10, d))
  while (s.length < d) s = '0' + s
  return s
}

/**
 * TOTP 计数器与剩余秒数。offsetSec 为人工校时偏移：手表钟快了就传负数。
 * 手动算一遍而不是依赖 Date.now()，保证给定入参结果可复现（单测友好）。
 */
function totpCounter(nowSec, period, offsetSec) {
  const p = clampPeriod(period)
  const t = Math.floor(Number(nowSec) || 0) + (Number(offsetSec) || 0)
  const counter = Math.floor(t / p)
  let remaining = p - (t - counter * p)
  if (remaining <= 0) remaining = p
  return { counter, remaining, period: p, time: t }
}

/**
 * 从计数器直接生成验证码（HOTP 语义，TOTP 传 floor(t/period)）。
 * 返回 { ok:true, code } 或 { ok:false, reason }。
 */
function createCodeFromCounter(secret, counter, algorithm, digits) {
  const decoded = decodeBase32(secret)
  if (!decoded.ok) return { ok: false, reason: decoded.reason }
  const algo = normalizeAlgorithm(algorithm)
  if (!algo || algo !== 'SHA1') {
    // M1 仅实现 SHA-1；SHA-256/512 属 M2（账户字段已保留，协议不变）
    return { ok: false, reason: REASON.UNSUPPORTED }
  }
  const mac = hmacSha1(decoded.bytes, counterToBytes(counter))
  return { ok: true, code: padCode(dynamicTruncate(mac), digits) }
}

/**
 * TOTP：密钥 + 当前时间 → { ok, code, remaining, counter, period, digits }。
 */
function generateTOTP(secret, nowSec, opts) {
  const o = opts || {}
  const decoded = decodeBase32(secret)
  if (!decoded.ok) {
    return { ok: false, reason: decoded.reason, code: '', counter: 0, remaining: 0 }
  }
  const algo = normalizeAlgorithm(o.algorithm)
  if (!algo || algo !== 'SHA1') {
    return { ok: false, reason: REASON.UNSUPPORTED, code: '', counter: 0, remaining: 0 }
  }
  const p = clampPeriod(o.period)
  const c = totpCounter(nowSec, p, o.offsetSec)
  const mac = hmacSha1(decoded.bytes, counterToBytes(c.counter))
  return {
    ok: true,
    code: padCode(dynamicTruncate(mac), o.digits),
    remaining: c.remaining,
    counter: c.counter,
    period: p,
    digits: clampDigits(o.digits)
  }
}

/**
 * HOTP（M2 预留）：密钥 + 计数器 → { ok, code }。
 */
function generateHOTP(secret, counter, algorithm, digits) {
  return createCodeFromCounter(secret, counter, algorithm, digits)
}

/**
 * 账户状态机：账户 + 当前时间 → 验证码或失败原因（不抛异常，渲染层直接用）。
 * account 应为 otpAccounts.normalizeAccount 的产物；offsetSec 为全局校时偏移。
 */
function resolveOtpState(account, nowSec, offsetSec) {
  if (!account || typeof account !== 'object' || !account.secret) {
    return { ok: false, reason: REASON.INVALID_ACCOUNT, code: '', remaining: 0 }
  }
  if (account.type === 'hotp') {
    const res = generateHOTP(account.secret, account.counter, account.algorithm, account.digits)
    if (!res.ok) return res
    return {
      ok: true,
      code: res.code,
      remaining: 0,
      counter: account.counter,
      digits: clampDigits(account.digits)
    }
  }
  return generateTOTP(account.secret, nowSec, {
    algorithm: account.algorithm,
    digits: account.digits,
    period: account.period,
    offsetSec
  })
}

/**
 * 验证码排版：对半插一个空格（6 位 "123 456"）。
 */
function formatCode(code) {
  const s = String(code == null ? '' : code)
  if (!s) return ''
  const mid = Math.floor(s.length / 2)
  return s.slice(0, mid) + ' ' + s.slice(mid)
}

/** Unix 秒（两端时间源一致，校时靠 timeOffsetSec 手动修正）。 */
function epochSeconds() {
  return Math.floor(Date.now() / 1000)
}

/**
 * UTF-8 字节长度（手写实现，不用 TextEncoder：QuickJS 没有）。
 * 与 src/utils/lyricsTransfer.js 的兜底分支同款。
 */
function byteLength(str) {
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

export default {
  ALGORITHMS,
  REASON,
  normalizeBase32,
  decodeBase32,
  counterToBytes,
  sha1Bytes,
  hmacSha1,
  dynamicTruncate,
  normalizeAlgorithm,
  clampDigits,
  clampPeriod,
  padCode,
  totpCounter,
  createCodeFromCounter,
  generateTOTP,
  generateHOTP,
  resolveOtpState,
  formatCode,
  epochSeconds,
  byteLength
}
