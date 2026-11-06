import { test } from 'node:test'
import assert from 'node:assert/strict'
import otp from '../src/otp.js'

// RFC 4226 Appendix D：HOTP-SHA1（secret = ASCII "12345678901234567890"）
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const HOTP_VECTOR = [
  '755224', '287082', '359152', '969429', '338314',
  '254676', '287922', '162583', '399871', '520489'
]

test('RFC 4226 Appendix D：HOTP 10 组向量', () => {
  for (let i = 0; i < HOTP_VECTOR.length; i++) {
    const res = otp.generateHOTP(RFC_SECRET, i, 'SHA1', 6)
    assert.equal(res.ok, true)
    assert.equal(res.code, HOTP_VECTOR[i])
  }
})

// RFC 6238 Appendix B：TOTP-SHA1 8 位
const TOTP_VECTOR = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130']
]

test('RFC 6238 Appendix B：TOTP-SHA1 6 组向量', () => {
  for (const [t, code] of TOTP_VECTOR) {
    const res = otp.generateTOTP(RFC_SECRET, t, { algorithm: 'SHA1', digits: 8, period: 30 })
    assert.equal(res.ok, true)
    assert.equal(res.code, code)
  }
})

test('插件侧与 RFC 向量一致：resolveOtpState 状态机', () => {
  const acc = { secret: RFC_SECRET, type: 'totp', algorithm: 'SHA1', digits: 8, period: 30 }
  const ok = otp.resolveOtpState(acc, 59, 0)
  assert.equal(ok.code, '94287082')
  const bad = otp.resolveOtpState({ ...acc, secret: 'A' }, 59, 0)
  assert.equal(bad.reason, 'invalid-secret')
  const algo = otp.resolveOtpState({ ...acc, algorithm: 'SHA256' }, 59, 0)
  assert.equal(algo.reason, 'unsupported-algorithm')
})

test('formatCode / padCode', () => {
  assert.equal(otp.formatCode('123456'), '123 456')
  assert.equal(otp.padCode(7, 6), '000007')
})
