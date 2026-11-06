#!/usr/bin/env node
/**
 * OTP 协议单测（零依赖）：消息表/分片/会话/信封/错误码。
 * 核心断言：每片上线消息 ≤ 12KB（CHUNK_LIMIT）。
 * 运行：node tools/test-otp-protocol.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const proto = (await import(pathToFileURL(path.join(root, 'src/utils/otpProtocol.js')).href)).default

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

console.log('OTP 协议单测')

const mkAccount = (i) => ({
  id: 'acc_1730000000_' + i,
  name: '账户名称第' + i + '号用于测试分片数据量',
  issuer: '测试颁发者组织',
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

test('常量与歌词协议口径一致', () => {
  assert.equal(proto.APP_ID, 'bandbox-otp')
  assert.equal(proto.VERSION, 1)
  assert.equal(proto.TARGET_PKG, 'com.miband.box')
  assert.equal(proto.CHUNK_LIMIT, 12 * 1024)
  assert.equal(proto.ENVELOPE_RESERVE, 256)
})

test('message/encode/parse 往返', () => {
  const json = proto.encode('hello', { time: 123, id: 'x' })
  const r = proto.parse(json)
  assert.equal(r.ok, true)
  assert.equal(r.msg.type, 'hello')
  assert.equal(r.msg.app, 'bandbox-otp')
  assert.equal(r.msg.v, 1)
  assert.equal(r.msg.time, 123)
})

test('parse：坏 JSON / 错 app / 错版本 / 缺 type', () => {
  assert.equal(proto.parse('not-json').reason, 'bad-json')
  assert.equal(proto.parse('{"app":"bandbox-lyrics","v":1,"type":"hello"}').reason, 'bad-app')
  assert.equal(proto.parse('{"app":"bandbox-otp","v":2,"type":"hello"}').reason, 'version')
  assert.equal(proto.parse('{"app":"bandbox-otp","v":1}').reason, 'bad-type')
})

test('byteLength：UTF-8 手写实现', () => {
  assert.equal(proto.byteLength('abc'), 3)
  assert.equal(proto.byteLength('中'), 3)
  assert.equal(proto.byteLength('中文abc'), 9)
})

test('jsonTextCost：转义开销计入', () => {
  assert.equal(proto.jsonTextCost('a"b'), 4) // a\"b
  assert.equal(proto.jsonTextCost('中文'), 6)
})

test('splitAccountChunks：60 个中文名账户每片 ≤ 12KB', () => {
  const accounts = []
  for (let i = 0; i < 60; i++) accounts.push(mkAccount(i))
  const plan = proto.planSync('accounts', { accounts }, 't1')
  assert.equal(plan.mode, 'chunk')
  assert.ok(plan.jsons.length > 1, '应分片')
  for (const j of plan.jsons) {
    assert.ok(proto.byteLength(j) <= proto.CHUNK_LIMIT, '单片超预算：' + proto.byteLength(j))
  }
  // 重组后账户数一致
  const session = proto.createSession()
  let last = null
  for (const j of plan.jsons) {
    last = proto.acceptChunk(session, JSON.parse(j))
    assert.equal(last.ok, true)
    if (!last.done) {
      // 中间片应回 progress
      assert.ok(last.received > 0 && last.received < last.total)
    }
  }
  assert.equal(last.done, true)
  assert.equal(last.payload.accounts.length, 60)
  assert.equal(last.payload.accounts[59].id, 'acc_1730000000_59')
})

test('splitAccountChunks：单账户超预算 → tooLarge', () => {
  const huge = mkAccount(0)
  huge.name = '巨'.repeat(7000) // 7000 中文字 ≈ 21KB
  const sp = proto.splitAccountChunks([huge, mkAccount(1)])
  assert.equal(sp.tooLarge.length, 1)
  assert.equal(sp.tooLarge[0], 0)
  assert.equal(sp.groups[0].length, 1) // 只有第二个进了组
})

test('acceptChunk：乱序拒绝', () => {
  const session = proto.createSession()
  const c0 = { id: 't', seq: 0, total: 3, kind: 'accounts', field: 'accounts', data: '[]' }
  const c2 = { id: 't', seq: 2, total: 3, kind: 'accounts', field: 'accounts', data: '[]' }
  assert.equal(proto.acceptChunk(session, c0).ok, true)
  const r = proto.acceptChunk(session, c2)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'bad-seq')
})

test('acceptChunk：缺片后跳号拒绝', () => {
  const session = proto.createSession()
  proto.acceptChunk(session, { id: 't', seq: 0, total: 3, kind: 'accounts', field: 'accounts', data: '[1]' })
  proto.acceptChunk(session, { id: 't', seq: 1, total: 3, kind: 'accounts', field: 'accounts', data: '[2]' })
  const r = proto.acceptChunk(session, { id: 't', seq: 3, total: 3, kind: 'accounts', field: 'accounts', data: '[4]' })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'bad-seq')
})

test('acceptChunk：跨 id 自动开新会话', () => {
  const session = proto.createSession()
  proto.acceptChunk(session, { id: 'a', seq: 0, total: 2, kind: 'accounts', field: 'accounts', data: '[1]' })
  // 新 id：即使 seq 跳变也重开会话
  const r = proto.acceptChunk(session, { id: 'b', seq: 0, total: 1, kind: 'accounts', field: 'accounts', data: '[9]' })
  assert.equal(r.ok, true)
  assert.equal(r.done, true)
  assert.equal(r.payload.accounts[0], 9)
})

test('acceptChunk：total 变化视为坏序列', () => {
  const session = proto.createSession()
  proto.acceptChunk(session, { id: 'a', seq: 0, total: 2, kind: 'accounts', field: 'accounts', data: '[]' })
  const r = proto.acceptChunk(session, { id: 'a', seq: 1, total: 3, kind: 'accounts', field: 'accounts', data: '[]' })
  assert.equal(r.ok, false)
})

test('acceptChunk：kind/field 混入其他字段拒绝', () => {
  const session = proto.createSession()
  const r = proto.acceptChunk(session, { id: 'a', seq: 0, total: 1, kind: 'accounts', field: 'weird', data: '[]' })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'bad-type')
})

test('sync_delta 分片：upsert 组在前、remove 组在后，重组还原', () => {
  const accounts = []
  for (let i = 0; i < 60; i++) accounts.push(mkAccount(i))
  const plan = proto.planSync('sync_delta', { upsert: accounts, remove: ['a', 'b', 'c'] }, 't2')
  assert.equal(plan.mode, 'chunk')
  for (const j of plan.jsons) {
    assert.ok(proto.byteLength(j) <= proto.CHUNK_LIMIT)
  }
  const session = proto.createSession()
  let last = null
  for (const j of plan.jsons) last = proto.acceptChunk(session, JSON.parse(j))
  assert.equal(last.done, true)
  assert.equal(last.payload.upsert.length, 60)
  assert.deepEqual(last.payload.remove, ['a', 'b', 'c'])
})

test('planSync：小数据走 single 模式', () => {
  const plan = proto.planSync('sync_delta', { upsert: [mkAccount(0)], remove: [] }, 't3')
  assert.equal(plan.mode, 'single')
  assert.ok(proto.byteLength(plan.json) <= proto.CHUNK_LIMIT)
  const r = proto.parse(plan.json)
  assert.equal(r.ok, true)
  assert.equal(r.msg.upsert.length, 1)
})

test('消息构造器：hello/ready/pong/ack/err/progress/set_offset', () => {
  const hello = JSON.parse(proto.helloMessage(1700000000, 'h1'))
  assert.equal(hello.type, 'hello')
  assert.equal(hello.time, 1700000000)
  const ready = JSON.parse(proto.readyMessage(3, -30, 1700000001))
  assert.equal(ready.type, 'ready')
  assert.equal(ready.accountsCount, 3)
  assert.equal(ready.timeOffsetSec, -30)
  const pong = JSON.parse(proto.pongMessage('h1', 3, 0, 1700000002))
  assert.equal(pong.type, 'pong')
  assert.equal(pong.id, 'h1')
  const ack = JSON.parse(proto.ackMessage('x', 5))
  assert.equal(ack.ok, true)
  assert.equal(ack.received, 5)
  const err = JSON.parse(proto.errMessage('x', 'bad-secret'))
  assert.equal(err.reason, 'bad-secret')
  const prog = JSON.parse(proto.progressMessage('x', 2, 7))
  assert.equal(prog.received, 2)
  const so = JSON.parse(proto.setOffsetMessage(-90, 's1'))
  assert.equal(so.type, 'set_offset')
  assert.equal(so.offset, -90)
})

test('describeReply：文案映射', () => {
  assert.equal(proto.describeReply({ type: 'ack' }).state, 'sent')
  assert.equal(proto.describeReply({ type: 'err', reason: 'bad-secret' }).text, '密钥无效（需 Base32）')
  assert.equal(proto.describeReply({ type: 'accounts', accounts: [1, 2] }).text, '已拉取 2 个账户')
  assert.equal(proto.describeReply(null).state, 'unknown')
})

test('unwrapInterconnectPayload：信封/裸消息/payloadHex', () => {
  // 裸 OTP 消息直接放行
  const bare = proto.encode('hello', { time: 1 })
  assert.equal(proto.unwrapInterconnectPayload(bare).data, bare)
  // 裸歌词消息也放行（由上层按 app 分流）
  const lyrics = '{"app":"bandbox-lyrics","v":1,"type":"hello"}'
  assert.equal(proto.unwrapInterconnectPayload(lyrics).data, lyrics)
  // payloadText 信封
  const env = JSON.stringify({ addr: 'AA', pkgName: 'com.miband.box', payloadText: bare })
  const u = proto.unwrapInterconnectPayload(env)
  assert.equal(u.addr, 'AA')
  assert.equal(u.data, bare)
  // payloadHex：UTF-8 中文
  const hexEnv = JSON.stringify({
    addr: 'BB',
    payloadHex: Buffer.from('{"app":"bandbox-otp","n":"中文"}', 'utf8').toString('hex')
  })
  const uh = proto.unwrapInterconnectPayload(hexEnv)
  assert.equal(JSON.parse(uh.data).n, '中文')
})

test('makeId：唯一性冒烟', () => {
  const seen = new Set()
  for (let i = 0; i < 5000; i++) seen.add(proto.makeId('ot'))
  assert.equal(seen.size, 5000)
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
