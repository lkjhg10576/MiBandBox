#!/usr/bin/env node
/**
 * OTP 双端一致性单测：otp.js / otpAccounts.js 源码 SHA-256 逐字一致，
 * otpProtocol.js 常量与行为一致。
 * 运行：node tools/test-otp-cross.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const read = (p) => crypto.createHash('sha256').update(String(readSync(root, p))).digest('hex')
import { readFileSync } from 'node:fs'
function readSync(base, rel) {
  return readFileSync(path.join(base, rel), 'utf8')
}

const otpWatch = (await import(pathToFileURL(path.join(root, 'src/utils/otp.js')).href)).default
const otpPlugin = (
  await import(
    pathToFileURL(path.join(root, 'plugin/bandbox-lyrics-sync/src/otp.js')).href
  )
).default
const accWatch = (
  await import(pathToFileURL(path.join(root, 'src/utils/otpAccounts.js')).href)
).default
const accPlugin = (
  await import(
    pathToFileURL(path.join(root, 'plugin/bandbox-lyrics-sync/src/otpAccounts.js')).href
  )
).default
const protoWatch = (
  await import(pathToFileURL(path.join(root, 'src/utils/otpProtocol.js')).href)
).default
const protoPlugin = (
  await import(
    pathToFileURL(path.join(root, 'plugin/bandbox-lyrics-sync/src/otpProtocol.js')).href
  )
).default

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

console.log('OTP 双端一致性单测')

test('otp.js 双端 SHA-256 逐字一致', () => {
  assert.equal(
    read('src/utils/otp.js'),
    read('plugin/bandbox-lyrics-sync/src/otp.js')
  )
})

test('otpAccounts.js 双端 SHA-256 逐字一致', () => {
  assert.equal(
    read('src/utils/otpAccounts.js'),
    read('plugin/bandbox-lyrics-sync/src/otpAccounts.js')
  )
})

test('otp.js 双端 RFC 4226 向量一致', () => {
  for (let i = 0; i < 10; i++) {
    const a = otpWatch.generateHOTP('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', i, 'SHA1', 6)
    const b = otpPlugin.generateHOTP('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', i, 'SHA1', 6)
    assert.equal(a.code, b.code)
  }
})

test('otpAccounts.js 双端 otpauth 解析一致', () => {
  const uri = 'otpauth://totp/GitHub:alice?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&digits=8'
  const a = accWatch.parseOtpauthUri(uri).account
  const b = accPlugin.parseOtpauthUri(uri).account
  // id/createdAt 每次解析都会新生成，比较其余字段
  const strip = (x) => {
    const c = { ...x }
    delete c.id
    delete c.createdAt
    return c
  }
  assert.equal(JSON.stringify(strip(a)), JSON.stringify(strip(b)))
})

test('otpProtocol：常量一致', () => {
  for (const k of ['APP_ID', 'VERSION', 'TARGET_PKG', 'CHUNK_LIMIT', 'ENVELOPE_RESERVE']) {
    assert.equal(protoWatch[k], protoPlugin[k], k)
  }
  assert.deepEqual(protoWatch.ERRORS, protoPlugin.ERRORS)
  assert.deepEqual(protoWatch.ERROR_TEXT, protoPlugin.ERROR_TEXT)
})

test('otpProtocol：splitAccountChunks/planSync 行为一致', () => {
  const accounts = []
  for (let i = 0; i < 120; i++) {
    accounts.push({
      id: 'acc_x_' + i,
      name: '账户第' + i + '号数据量测试',
      issuer: '一致性校验',
      secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      type: 'totp',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      counter: 0,
      createdAt: 1730000000,
      counterModifiedAt: 0,
      extraParams: {}
    })
  }
  const a = protoWatch.splitAccountChunks(accounts)
  const b = protoPlugin.splitAccountChunks(accounts)
  assert.equal(a.total, b.total)
  assert.deepEqual(a.groups.map((g) => g.length), b.groups.map((g) => g.length))
  const pa = protoWatch.planSync('sync_delta', { upsert: accounts, remove: ['x'] }, 'id1')
  const pb = protoPlugin.planSync('sync_delta', { upsert: accounts, remove: ['x'] }, 'id1')
  assert.equal(pa.mode, pb.mode)
  assert.equal(pa.total, pb.total)
  assert.equal(pa.jsons.length, pb.jsons.length)
  for (let i = 0; i < pa.jsons.length; i++) {
    assert.ok(protoWatch.byteLength(pa.jsons[i]) <= protoWatch.CHUNK_LIMIT)
    assert.ok(protoPlugin.byteLength(pb.jsons[i]) <= protoPlugin.CHUNK_LIMIT)
  }
})

test('otpProtocol：解析与重组跨端互通（手表片 → 插件会话）', () => {
  const accounts = []
  for (let i = 0; i < 80; i++) {
    accounts.push({
      id: 'acc_i_' + i + '_xyz12345',
      name: '互通测试账户名称第' + i + '号分片数据',
      issuer: '一致性校验组织',
      secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      type: 'totp',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      counter: 0,
      createdAt: 1730000000,
      counterModifiedAt: 0,
      extraParams: {}
    })
  }
  const plan = protoWatch.planSync('accounts', { accounts }, 'ix')
  const session = protoPlugin.createSession()
  let last = null
  const messages = plan.mode === 'chunk' ? plan.jsons : [plan.json]
  for (const j of messages) {
    // 手表端编码的消息，用插件端 parse 校验再入会话
    const parsed = protoPlugin.parse(j)
    assert.equal(parsed.ok, true)
    if (parsed.msg.type === 'chunk') {
      last = protoPlugin.acceptChunk(session, parsed.msg)
      assert.equal(last.ok, true)
    }
  }
  if (plan.mode === 'chunk') {
    assert.equal(last.done, true)
    assert.equal(last.payload.accounts.length, 80)
  } else {
    assert.equal(parsedAccountsCount(plan), 80)
  }
})

function parsedAccountsCount(plan) {
  const msg = JSON.parse(plan.json)
  return msg.accounts.length
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
