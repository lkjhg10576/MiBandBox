/**
 * TOTP 状态缓存层（不改 otp.js，保持两端 otp.js 逐字一致）。
 *
 * 按 id + secret 尾 6 位 + secret 校验摘要 + counter + period + digits + algorithm
 * 缓存成功态的验证码；同窗口内每秒刷新只重算 remaining，不再重复做 Base32 解码与 HMAC。
 * HOTP 与非法账户直接走 otp.resolveOtpState。缓存超过 64 条整体清空。
 */
import otp from './otp'

const CACHE_MAX = 64

let cache = Object.create(null)
let cacheCount = 0

function hashSecret(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

function makeKey(account, counter, period, digits, algo) {
  const id = account.id == null ? '' : String(account.id)
  const sec = String(account.secret)
  const tail = sec.length > 6 ? sec.slice(-6) : sec
  return (
    id +
    '|' +
    tail +
    ':' +
    hashSecret(sec) +
    '|' +
    counter +
    '|' +
    period +
    '|' +
    digits +
    '|' +
    algo
  )
}

export function clear() {
  cache = Object.create(null)
  cacheCount = 0
}

export function size() {
  return cacheCount
}

export function resolve(account, now, offset) {
  if (!account || typeof account !== 'object' || !account.secret || account.type === 'hotp') {
    return otp.resolveOtpState(account, now, offset)
  }

  const c = otp.totpCounter(now, account.period, offset)
  const algo = otp.normalizeAlgorithm(account.algorithm)
  const digits = otp.clampDigits(account.digits)
  const key = makeKey(account, c.counter, c.period, digits, algo)

  const hit = cache[key]
  if (hit) {
    return {
      ok: true,
      code: hit.code,
      remaining: c.remaining,
      counter: hit.counter,
      period: hit.period,
      digits: hit.digits
    }
  }

  const res = otp.resolveOtpState(account, now, offset)
  if (res && res.ok) {
    if (cacheCount >= CACHE_MAX) {
      cache = Object.create(null)
      cacheCount = 0
    }
    cache[key] = {
      code: res.code,
      counter: res.counter,
      period: res.period,
      digits: res.digits
    }
    cacheCount++
  }
  return res
}

export default { resolve, clear, size }
