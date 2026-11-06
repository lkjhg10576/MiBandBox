#!/usr/bin/env node
/**
 * OTP 纯逻辑内核单测（零依赖）：RFC 4226/6238 向量、Base32、动态截断、状态机。
 * 运行：node tools/test-otp.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const otp = (await import(pathToFileURL(path.join(root, 'src/utils/otp.js')).href)).default

let passed = 0
let failed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    failures.push({ name, error: e })
    console.log(`  ✗ ${name}`)
    console.log(`      ${e.message}`)
  }
}

console.log('OTP 纯逻辑内核单测')

// RFC 4226 Appendix D：HOTP-SHA1，secret = ASCII "12345678901234567890"
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const HOTP_VECTOR = [
  '755224', '287082', '359152', '969429', '338314',
  '254676', '287922', '162583', '399871', '520489'
]

test('RFC 4226 Appendix D：HOTP 10 组向量', () => {
  for (let i = 0; i < HOTP_VECTOR.length; i++) {
    const res = otp.generateHOTP(RFC_SECRET, i, 'SHA1', 6)
    assert.equal(res.ok, true, `counter=${i} ok`)
    assert.equal(res.code, HOTP_VECTOR[i], `counter=${i} code`)
  }
})

// RFC 6238 Appendix B：TOTP-SHA1 8 位，secret = ASCII "12345678901234567890"
const TOTP_VECTOR = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130']
]

test('RFC 6238 Appendix B：TOTP-SHA1 6 组向量（8 位）', () => {
  for (const [t, code] of TOTP_VECTOR) {
    const res = otp.generateTOTP(RFC_SECRET, t, { algorithm: 'SHA1', digits: 8, period: 30 })
    assert.equal(res.ok, true, `t=${t} ok`)
    assert.equal(res.code, code, `t=${t} code`)
  }
})

test('TOTP 6 位与 8 位同源（前 6 位一致）', () => {
  const t = 1111111109
  const r8 = otp.generateTOTP(RFC_SECRET, t, { algorithm: 'SHA1', digits: 8 })
  const r6 = otp.generateTOTP(RFC_SECRET, t, { algorithm: 'SHA1', digits: 6 })
  assert.equal(r8.ok && r6.ok, true)
  assert.equal(r8.code.slice(2), r6.code)
})

test('SHA-1 标准向量（"abc" 与空串）', () => {
  const abc = otp.sha1Bytes([0x61, 0x62, 0x63])
  assert.equal(Buffer.from(abc).toString('hex'), 'a9993e364706816aba3e25717850c26c9cd0d89d')
  const empty = otp.sha1Bytes([])
  assert.equal(Buffer.from(empty).toString('hex'), 'da39a3ee5e6b4b0d3255bfef95601890afd80709')
})

test('Base32：非法长度 %8∈{1,3,6} 拒绝', () => {
  for (const bad of ['A', 'ABC', 'ABCDEF']) {
    assert.equal(otp.decodeBase32(bad).ok, false, bad)
    assert.equal(otp.decodeBase32(bad).reason, 'invalid-secret')
  }
})

test('Base32：合法长度 %8∈{2,4,5,7,0} 通过', () => {
  for (const good of ['AB', 'ABCD', 'ABCDE', 'ABCDEFG', 'JBSWY3DPEHPK3PXP']) {
    assert.equal(otp.decodeBase32(good).ok, true, good)
  }
})

test('Base32 规范化：小写/空格/连字符/=padding', () => {
  assert.equal(otp.normalizeBase32('jbsw y3dp-ehp k3pxp=='), 'JBSWY3DPEHPK3PXP')
  assert.equal(otp.normalizeBase32('jbsw1y3dp'), 'JBSWY3DP') // 1 不是字母表字符，剔除
})

test('Base32 解码值正确（"JBSWY3DP" → "Hello"）', () => {
  const r = otp.decodeBase32('JBSWY3DP')
  assert.equal(r.ok, true)
  assert.equal(Buffer.from(r.bytes).toString(), 'Hello')
})

test('counterToBytes：64 位大端', () => {
  assert.deepEqual(
    otp.counterToBytes(0),
    [0, 0, 0, 0, 0, 0, 0, 0]
  )
  assert.deepEqual(
    otp.counterToBytes(1),
    [0, 0, 0, 0, 0, 0, 0, 1]
  )
  // 0x1 2345 6789 = 4886718345
  assert.deepEqual(
    otp.counterToBytes(4886718345),
    [0, 0, 0, 0x01, 0x23, 0x45, 0x67, 0x89]
  )
})

test('dynamicTruncate：手工向量', () => {
  // mac[19]=0x1f → offset = 0x1f & 0x0f = 15；先填字节再覆盖 mac[19]
  const mac = new Uint8Array(20)
  for (let i = 0; i < 20; i++) mac[i] = i
  mac[19] = 0x1f
  // offset=15 → mac[15..18] = 0x0f,0x10,0x11,0x12
  const expected = ((0x0f & 0x7f) << 24) | (0x10 << 16) | (0x11 << 8) | 0x12
  assert.equal(otp.dynamicTruncate(mac), expected)
})

test('padCode：补零与取模', () => {
  assert.equal(otp.padCode(42, 6), '000042')
  assert.equal(otp.padCode(1234567, 6), '234567')
  assert.equal(otp.padCode(0, 8), '00000000')
})

test('formatCode：6 位对半插空格', () => {
  assert.equal(otp.formatCode('123456'), '123 456')
  assert.equal(otp.formatCode(''), '')
})

test('totpCounter：剩余秒数口径', () => {
  // t=59, period=30 → counter=1, remaining=30-(59-30)=1
  const c = otp.totpCounter(59, 30, 0)
  assert.equal(c.counter, 1)
  assert.equal(c.remaining, 1)
  // 整分第 0 秒
  const c2 = otp.totpCounter(60, 30, 0)
  assert.equal(c2.counter, 2)
  assert.equal(c2.remaining, 30)
})

test('resolveOtpState：无效密钥 → invalid-secret', () => {
  const acc = { secret: 'AB', type: 'totp', algorithm: 'SHA1', digits: 6, period: 30 }
  // 'AB' 长度 2 合法但只有 10 bit → 1 字节，是有效密钥；用长度 1 的密钥测
  const accBad = { secret: 'A', type: 'totp', algorithm: 'SHA1', digits: 6, period: 30 }
  const res = otp.resolveOtpState(accBad, 59, 0)
  assert.equal(res.ok, false)
  assert.equal(res.reason, 'invalid-secret')
})

test('resolveOtpState：SHA256 → unsupported-algorithm（M1）', () => {
  const acc = { secret: RFC_SECRET, type: 'totp', algorithm: 'SHA256', digits: 6, period: 30 }
  const res = otp.resolveOtpState(acc, 59, 0)
  assert.equal(res.ok, false)
  assert.equal(res.reason, 'unsupported-algorithm')
})

test('resolveOtpState：空账户 → invalid-account', () => {
  assert.equal(otp.resolveOtpState(null, 59, 0).reason, 'invalid-account')
  assert.equal(otp.resolveOtpState({ type: 'totp' }, 59, 0).reason, 'invalid-account')
})

test('resolveOtpState：正常出码并与 RFC 6238 一致', () => {
  const acc = { secret: RFC_SECRET, type: 'totp', algorithm: 'SHA1', digits: 8, period: 30 }
  const res = otp.resolveOtpState(acc, 1111111109, 0)
  assert.equal(res.ok, true)
  assert.equal(res.code, '07081804')
  // 1111111109 % 30 = 29 → 剩 1 秒
  assert.equal(res.remaining, 1)
  assert.equal(otp.formatCode(res.code), '0708 1804')
})

test('timeOffsetSec：偏移等价于时间平移', () => {
  // 无偏移 t=1111111109 的码 = 有偏移 t=1111111109+30 偏移 -30 的码
  const acc = { secret: RFC_SECRET, type: 'totp', algorithm: 'SHA1', digits: 8, period: 30 }
  const base = otp.resolveOtpState(acc, 1111111109, 0)
  const shifted = otp.resolveOtpState(acc, 1111111109 + 30, -30)
  assert.equal(base.code, shifted.code)
  // 剩余秒数相同
  assert.equal(base.remaining, shifted.remaining)
})

test('周期夹取：15..120 之外回 30', () => {
  assert.equal(otp.totpCounter(0, 10, 0).period, 30)
  assert.equal(otp.totpCounter(0, 60, 0).period, 60)
})

test('HOTP 账户状态机（M2 字段预留）', () => {
  const acc = { secret: RFC_SECRET, type: 'hotp', algorithm: 'SHA1', digits: 6, counter: 0 }
  const res = otp.resolveOtpState(acc, 0, 0)
  assert.equal(res.ok, true)
  assert.equal(res.code, '755224')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exitCode = 1
}
