#!/usr/bin/env node
/**
 * OTP 账户模型单测（零依赖）：normalize/validate/otpauth 解析与生成/合并/增量。
 * 运行：node tools/test-otp-accounts.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const acc = (await import(pathToFileURL(path.join(root, 'src/utils/otpAccounts.js')).href)).default

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    console.log(`  ✗ ${name}`)
    console.log(`      ${e.message}`)
  }
}

console.log('OTP 账户模型单测')

test('normalizeAccount：完整字段与键序固定', () => {
  const a = acc.normalizeAccount({
    secret: 'jbsw y3dpeh pk3pxp',
    name: 'alice',
    issuer: 'GitHub',
    algorithm: 'sha-1',
    digits: '8'
  })
  assert.equal(a, null) // 无 id → null
  const b = acc.normalizeAccount({ id: 'acc_1', secret: 'jbsw y3dpeh pk3pxp', name: 'alice' })
  assert.equal(b.id, 'acc_1')
  assert.equal(b.secret, 'JBSWY3DPEHPK3PXP')
  assert.equal(b.type, 'totp')
  assert.equal(b.algorithm, 'SHA1')
  assert.equal(b.digits, 6)
  assert.equal(b.period, 30)
  assert.deepEqual(Object.keys(b), [
    'id', 'name', 'issuer', 'secret', 'type', 'algorithm',
    'digits', 'period', 'counter', 'createdAt', 'counterModifiedAt', 'extraParams'
  ])
})

test('normalizeAccount：未知算法回 SHA1，digits 只留 6/8', () => {
  const a = acc.normalizeAccount({ id: 'x', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'FOO', digits: 7 })
  assert.equal(a.algorithm, 'SHA1')
  assert.equal(a.digits, 6)
  const b = acc.normalizeAccount({ id: 'x', secret: 'JBSWY3DPEHPK3PXP', digits: 8 })
  assert.equal(b.digits, 8)
})

test('normalizeAccount：period 夹取 15..120、counter 非负', () => {
  assert.equal(acc.normalizeAccount({ id: 'x', secret: 'JBSWY3DPEHPK3PXP', period: 10 }).period, 30)
  assert.equal(acc.normalizeAccount({ id: 'x', secret: 'JBSWY3DPEHPK3PXP', period: 60 }).period, 60)
  assert.equal(acc.normalizeAccount({ id: 'x', secret: 'JBSWY3DPEHPK3PXP', counter: -5 }).counter, 0)
})

test('normalizeAccount：名称/颁发者截断到上限', () => {
  const a = acc.normalizeAccount({ id: 'x', secret: 'JBSWY3DPEHPK3PXP', name: '名'.repeat(50), issuer: 'I'.repeat(30) })
  assert.equal(a.name.length, acc.NAME_LIMIT)
  assert.equal(a.issuer.length, acc.ISSUER_LIMIT)
})

test('validateAccount：无效密钥拒绝', () => {
  assert.equal(acc.validateAccount({ id: 'x', secret: 'A' }).ok, false) // 长度 1 非法
  assert.equal(acc.validateAccount({ id: 'x', secret: 'A' }).reason, 'bad-secret')
  assert.equal(acc.validateAccount({ secret: 'JBSWY3DPEHPK3PXP' }).ok, false) // 无 id
  assert.equal(acc.validateAccount({ id: 'x', secret: 'JBSWY3DPEHPK3PXP' }).ok, true)
})

test('newAccount：自动生成 id 与 createdAt', () => {
  const a = acc.newAccount({ name: 'alice', secret: 'JBSWY3DPEHPK3PXP' })
  assert.ok(a.id.indexOf('acc_') === 0)
  assert.ok(a.createdAt > 1600000000)
})

test('parseOtpauthUri：标准 totp', () => {
  const r = acc.parseOtpauthUri('otpauth://totp/GitHub:alice?secret=JBSWY3DPEHPK3PXP&issuer=GitHub')
  assert.equal(r.ok, true)
  assert.equal(r.account.issuer, 'GitHub')
  assert.equal(r.account.name, 'alice')
  assert.equal(r.account.secret, 'JBSWY3DPEHPK3PXP')
  assert.equal(r.account.type, 'totp')
})

test('parseOtpauthUri：\\/ 转义与 &amp; 实体', () => {
  const r = acc.parseOtpauthUri(
    'otpauth:\/\/totp\/GitHub:alice?secret=JBSWY3DPEHPK3PXP&amp;issuer=GitHub&amp;digits=8'
  )
  assert.equal(r.ok, true)
  assert.equal(r.account.digits, 8)
  assert.equal(r.account.issuer, 'GitHub')
})

test('parseOtpauthUri：参数大小写不敏感、issuer 前缀兜底', () => {
  const r = acc.parseOtpauthUri('otpauth://totp/My%20Issuer%3Abob?SECRET=JBSWY3DPEHPK3PXP&Digits=6')
  assert.equal(r.ok, true)
  assert.equal(r.account.issuer, 'My Issuer')
  assert.equal(r.account.name, 'bob')
})

test('parseOtpauthUri：issuer 参数优先于 label 前缀', () => {
  const r = acc.parseOtpauthUri('otpauth://totp/A:alice?secret=JBSWY3DPEHPK3PXP&issuer=B')
  assert.equal(r.account.issuer, 'B')
  assert.equal(r.account.name, 'alice')
})

test('parseOtpauthUri：非法 digits / 坏 scheme / 缺 secret', () => {
  assert.equal(acc.parseOtpauthUri('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=7').ok, false)
  assert.equal(acc.parseOtpauthUri('https://totp/x?secret=JBSWY3DPEHPK3PXP').ok, false)
  assert.equal(acc.parseOtpauthUri('otpauth://totp/x?secret=A').ok, false) // Base32 长度非法
  assert.equal(acc.parseOtpauthUri('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=-1').ok, false)
})

test('parseOtpauthUri：hotp + counter 与 SHA256 保留', () => {
  const r = acc.parseOtpauthUri(
    'otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=5&algorithm=SHA256'
  )
  assert.equal(r.ok, true)
  assert.equal(r.account.type, 'hotp')
  assert.equal(r.account.counter, 5)
  assert.equal(r.account.algorithm, 'SHA256')
})

test('parseOtpauthText：多行 + 非法行报告', () => {
  const text = [
    'otpauth://totp/A:one?secret=JBSWY3DPEHPK3PXP',
    'junk line',
    'otpauth://totp/B:two?secret=GEZDGNBVGY3TQOJQ'
  ].join('\n')
  const r = acc.parseOtpauthText(text)
  assert.equal(r.count, 2)
  // 非法 token 按空白逐个报告："junk line" 是两个 token
  assert.equal(r.invalid.length, 2)
  assert.equal(r.invalid[0].reason, 'bad-account')
  assert.equal(r.ok, false)
})

test('buildOtpauthUri：往返一致（roundtrip）', () => {
  const a = acc.newAccount({ name: 'alice', issuer: 'GitHub', secret: 'JBSWY3DPEHPK3PXP' })
  const uri = acc.buildOtpauthUri(a)
  assert.ok(uri.indexOf('otpauth://totp/GitHub%3Aalice?secret=JBSWY3DPEHPK3PXP') === 0)
  assert.ok(uri.indexOf('&issuer=GitHub') > 0)
  const back = acc.parseOtpauthUri(uri)
  assert.equal(back.ok, true)
  assert.equal(back.account.secret, a.secret)
  assert.equal(back.account.issuer, a.issuer)
  assert.equal(back.account.name, a.name)
})

test('buildOtpauthUri：非默认字段进 URI', () => {
  const a = acc.newAccount({ name: 'x', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA256', digits: 8, period: 60 })
  const uri = acc.buildOtpauthUri(a)
  assert.ok(uri.indexOf('&algorithm=SHA256') > 0)
  assert.ok(uri.indexOf('&digits=8') > 0)
  assert.ok(uri.indexOf('&period=60') > 0)
})

test('exportAllAsUris：多行导出', () => {
  const list = [
    acc.newAccount({ name: 'a', secret: 'JBSWY3DPEHPK3PXP' }),
    acc.newAccount({ name: 'b', secret: 'GEZDGNBVGY3TQOJQ' })
  ]
  const text = acc.exportAllAsUris(list)
  assert.equal(text.split('\n').length, 2)
  assert.equal(acc.parseOtpauthText(text).count, 2)
})

test('upsertAccounts：按 id 覆盖原位、新增追加、不删未出现项', () => {
  const a1 = acc.newAccount({ name: 'a', secret: 'JBSWY3DPEHPK3PXP' })
  const a2 = acc.newAccount({ name: 'b', secret: 'GEZDGNBVGY3TQOJQ' })
  const a3 = acc.newAccount({ name: 'c', secret: 'MFRGGZDFMZTWQ2LK' })
  const merged = acc.upsertAccounts([a1, a2], [{ ...a2, name: 'b2' }, a3])
  assert.equal(merged.length, 3)
  assert.equal(merged[0].id, a1.id)
  assert.equal(merged[1].name, 'b2') // 原位覆盖
  assert.equal(merged[2].id, a3.id)
})

test('mergeDelta：先删后增', () => {
  const a1 = acc.newAccount({ name: 'a', secret: 'JBSWY3DPEHPK3PXP' })
  const a2 = acc.newAccount({ name: 'b', secret: 'GEZDGNBVGY3TQOJQ' })
  const a3 = acc.newAccount({ name: 'c', secret: 'MFRGGZDFMZTWQ2LK' })
  const out = acc.mergeDelta([a1, a2], [a3], [a1.id])
  assert.equal(out.length, 2)
  assert.equal(out[0].id, a2.id)
  assert.equal(out[1].id, a3.id)
})

test('sameAccountCore：同凭据判定', () => {
  const a = acc.newAccount({ name: 'a', issuer: 'I', secret: 'JBSWY3DPEHPK3PXP' })
  const b = acc.newAccount({ name: 'a', issuer: 'I', secret: 'JBSWY3DPEHPK3PXP' })
  assert.equal(acc.sameAccountCore(a, b), true)
  const c = acc.newAccount({ name: 'a', issuer: 'I', secret: 'GEZDGNBVGY3TQOJQ' })
  assert.equal(acc.sameAccountCore(a, c), false)
})

test('normalizeAccount 产物 JSON 稳定（三态 diff 依赖）', () => {
  const a = acc.newAccount({ name: 'a', secret: 'JBSWY3DPEHPK3PXP' })
  const b = acc.normalizeAccount(JSON.parse(JSON.stringify(a)))
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
