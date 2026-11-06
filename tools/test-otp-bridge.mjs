#!/usr/bin/env node
/**
 * OTP 桥接层单测：mock 消息注入 otpBridge.handle，验证分发/落盘/回执全链路。
 * 通过 loader 桩替换 @system.file / @system.interconnect。
 * 运行：node tools/test-otp-bridge.mjs
 */
import { register } from 'node:module'
import assert from 'node:assert/strict'

register(new URL('./vela-loader.mjs', import.meta.url))

// register 必须先于被测模块的动态导入
const { default: otpBridge } = await import('../src/utils/otpBridge.js')
const { default: otpStore } = await import('../src/utils/otpStore.js')
const { default: proto } = await import('../src/utils/otpProtocol.js')
const { default: interconnectUtil } = await import('../src/utils/interconnect.js')
const stub = await import('./stubs/system-interconnect.mjs')
const fileStub = await import('./stubs/system-file.mjs')

// 与 app.ux onCreate 相同的顺序：先 init 互连通道，再挂 OTP 桥
interconnectUtil.init()

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

function lastSent() {
  const all = stub.__sent()
  return all.length ? JSON.parse(all[all.length - 1]) : null
}

function sentOfTypes() {
  return stub.__sent().map((j) => {
    try {
      return JSON.parse(j).type
    } catch (e) {
      return '?'
    }
  })
}

const mkAccount = (name, secret) => ({
  id: proto.makeId('acc'),
  name,
  issuer: 'GitHub',
  secret: secret || 'JBSWY3DPEHPK3PXP',
  type: 'totp',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  counter: 0,
  createdAt: 1730000000,
  counterModifiedAt: 0,
  extraParams: {}
})

console.log('OTP 桥接层单测')

test('init 幂等且注册后收到 hello 回 pong', () => {
  otpBridge.init()
  otpBridge.init() // 幂等
  const before = stub.__sentCount()
  stub.__pushIncoming(proto.helloMessage(1730000000, 'h1'))
  const replyMsg = lastSent()
  assert.equal(replyMsg.type, 'pong')
  assert.equal(replyMsg.id, 'h1')
  assert.equal(replyMsg.accountsCount, 0)
  assert.equal(stub.__sentCount(), before + 1)
})

test('歌词协议消息不回任何东西（app 字段过滤）', () => {
  const before = stub.__sentCount()
  stub.__pushIncoming('{"app":"bandbox-lyrics","v":1,"type":"hello","id":"ly1"}')
  stub.__pushIncoming('garbage-not-json')
  assert.equal(stub.__sentCount(), before)
})

test('upsert_accounts：批量导入落盘并回 ack(N)', () => {
  const before = stub.__sentCount()
  stub.__pushIncoming(
    proto.encode('upsert_accounts', {
      id: 'u1',
      accounts: [mkAccount('alice'), mkAccount('bob', 'GEZDGNBVGY3TQOJQ')]
    })
  )
  const replyMsg = lastSent()
  assert.equal(replyMsg.type, 'ack')
  assert.equal(replyMsg.id, 'u1')
  assert.equal(replyMsg.received, 2)
  assert.equal(otpStore.list().length, 2)
  assert.equal(sentOfTypes()[before - stub.__sentCount()], undefined)
})

test('upsert_accounts：含坏密钥整批拒绝并回 err(bad-secret)', () => {
  const countBefore = otpStore.list().length
  stub.__pushIncoming(
    proto.encode('upsert_accounts', {
      id: 'u2',
      accounts: [mkAccount('bad', 'A')] // 长度 1 非法
    })
  )
  const replyMsg = lastSent()
  assert.equal(replyMsg.type, 'err')
  assert.equal(replyMsg.reason, 'bad-secret')
  assert.equal(otpStore.list().length, countBefore) // 未落盘
})

test('set_offset：写入偏移并回 ack，越界夹取', () => {
  stub.__pushIncoming(proto.setOffsetMessage(-90, 's1'))
  assert.equal(lastSent().type, 'ack')
  assert.equal(otpStore.getTimeOffsetSec(), -90)
  stub.__pushIncoming(proto.setOffsetMessage(9999, 's2'))
  assert.equal(otpStore.getTimeOffsetSec(), otpStore.OFFSET_MAX)
  otpStore.setTimeOffsetSec(0)
})

test('sync_delta：单条消息增量（新增+删除）', () => {
  const keep = mkAccount('keep', 'GEZDGNBVGY3TQOJQ')
  const gone = mkAccount('gone', 'MFRGGZDFMZTWQ2LK')
  otpStore.replaceAll([keep, gone])
  stub.__sent().length = 0 // 清空发送记录
  const added = mkAccount('added', 'MZXW6YTBOI======')
  stub.__pushIncoming(
    proto.encode('sync_delta', { id: 'd1', upsert: [added], remove: [gone.id] })
  )
  const replyMsg = lastSent()
  assert.equal(replyMsg.type, 'ack')
  assert.equal(replyMsg.received, 2)
  const ids = otpStore.list().map((a) => a.id)
  assert.ok(ids.indexOf(added.id) >= 0)
  assert.ok(ids.indexOf(gone.id) < 0)
  assert.ok(ids.indexOf(keep.id) >= 0)
})

test('sync_delta 分片：planSync 60 账户 → chunk → 收齐落盘', () => {
  otpStore.replaceAll([])
  stub.__sent().length = 0
  const accounts = []
  for (let i = 0; i < 60; i++) accounts.push(mkAccount('用户' + i))
  const plan = proto.planSync('sync_delta', { upsert: accounts, remove: [] }, 'chunk1')
  assert.equal(plan.mode, 'chunk')
  for (const j of plan.jsons) stub.__pushIncoming(j)
  const replyMsg = lastSent()
  assert.equal(replyMsg.type, 'ack')
  assert.equal(replyMsg.id, 'chunk1')
  assert.equal(replyMsg.received, 60)
  assert.equal(otpStore.list().length, 60)
  // 中途应发过 progress
  assert.ok(sentOfTypes().indexOf('progress') >= 0)
})

test('list_accounts：回 accounts（single 或分片）且每片 ≤ 12KB', () => {
  stub.__sent().length = 0
  stub.__pushIncoming(proto.listAccountsMessage('l1'))
  const types = sentOfTypes()
  for (const j of stub.__sent()) {
    assert.ok(proto.byteLength(j) <= proto.CHUNK_LIMIT)
  }
  const expected = otpStore.list().length
  const single = stub.__sent().map((j) => JSON.parse(j)).find((m) => m.type === 'accounts')
  if (single) {
    assert.equal(single.accounts.length, expected)
    return
  }
  // 分片形态：kind=accounts 的 chunk，重组校验
  assert.ok(types.indexOf('chunk') >= 0)
  const session = proto.createSession()
  let last = null
  for (const j of stub.__sent()) {
    const m = JSON.parse(j)
    if (m.type === 'chunk' && m.kind === 'accounts') {
      last = proto.acceptChunk(session, m)
      assert.equal(last.ok, true)
    }
  }
  assert.equal(last.done, true)
  assert.equal(last.payload.accounts.length, expected)
})

test('remove_account：删除并回 ack(removed)', () => {
  const first = otpStore.list()[0]
  stub.__sent().length = 0
  stub.__pushIncoming(proto.encode('remove_account', { id: 'r1', ids: [first.id] }))
  const replyMsg = lastSent()
  assert.equal(replyMsg.type, 'ack')
  assert.equal(replyMsg.received, 1)
})

test('落盘持久化：kv.flush 后文件里确有账户', () => {
  const text = fileStub.__files['internal://files/bandbox/store.json']
  assert.ok(text, 'store.json 应存在')
  const data = JSON.parse(text)
  assert.ok(Array.isArray(data['otp.accounts']))
})

test('getLastHelloTime：hello 携带的手机时间', () => {
  assert.equal(otpBridge.getLastHelloTime(), 1730000000)
})

test('notify：落盘触发订阅者（页面刷新机制）', () => {
  let fired = 0
  const un = otpStore.subscribe(() => fired++)
  otpStore.upsert(mkAccount('notify-test'))
  assert.ok(fired >= 1)
  un()
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
