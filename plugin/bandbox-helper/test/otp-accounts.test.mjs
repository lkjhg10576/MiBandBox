import { test } from 'node:test'
import assert from 'node:assert/strict'
import acc from '../src/otpAccounts.js'

test('parseOtpauthUri：标准与转义形态', () => {
  const a = acc.parseOtpauthUri('otpauth://totp/GitHub:alice?secret=JBSWY3DPEHPK3PXP&issuer=GitHub')
  assert.equal(a.ok, true)
  assert.equal(a.account.issuer, 'GitHub')
  assert.equal(a.account.name, 'alice')
  const b = acc.parseOtpauthUri(
    'otpauth:\/\/totp\/GitHub:alice?secret=JBSWY3DPEHPK3PXP&amp;issuer=GitHub&amp;digits=8'
  )
  assert.equal(b.ok, true)
  assert.equal(b.account.digits, 8)
})

test('parseOtpauthText：批量导入与非法行', () => {
  const r = acc.parseOtpauthText(
    'otpauth://totp/A:one?secret=JBSWY3DPEHPK3PXP\nbadline\notpauth://totp/B:two?secret=GEZDGNBVGY3TQOJQ'
  )
  assert.equal(r.count, 2)
  assert.equal(r.invalid.length, 1)
})

test('buildOtpauthUri：roundtrip', () => {
  const a = acc.newAccount({ name: 'x', issuer: 'I', secret: 'JBSWY3DPEHPK3PXP' })
  const back = acc.parseOtpauthUri(acc.buildOtpauthUri(a))
  assert.equal(back.ok, true)
  assert.equal(back.account.secret, a.secret)
})

test('upsertAccounts / mergeDelta：合并语义', () => {
  const a1 = acc.newAccount({ name: 'a', secret: 'JBSWY3DPEHPK3PXP' })
  const a2 = acc.newAccount({ name: 'b', secret: 'GEZDGNBVGY3TQOJQ' })
  const a3 = acc.newAccount({ name: 'c', secret: 'MFRGGZDFMZTWQ2LK' })
  const merged = acc.upsertAccounts([a1, a2], [a3])
  assert.equal(merged.length, 3)
  const afterDel = acc.mergeDelta(merged, [], [a1.id])
  assert.equal(afterDel.length, 2)
})

test('normalizeAccount：键序稳定（三态 diff 依赖）', () => {
  const a = acc.newAccount({ name: 'n', secret: 'JBSWY3DPEHPK3PXP' })
  const b = acc.normalizeAccount(JSON.parse(JSON.stringify(a)))
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})
