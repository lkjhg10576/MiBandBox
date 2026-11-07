import { test } from 'node:test'
import assert from 'node:assert/strict'
import proto from '../src/otpProtocol.js'

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

test('核心断言：60 个中文名账户每片上线消息 ≤ 12KB', () => {
  const accounts = []
  for (let i = 0; i < 60; i++) accounts.push(mkAccount(i))
  const plan = proto.planSync('accounts', { accounts }, 't1')
  assert.equal(plan.mode, 'chunk')
  for (const j of plan.jsons) {
    assert.ok(proto.byteLength(j) <= proto.CHUNK_LIMIT, '单片超预算')
  }
})

test('sync_delta 分片与重组还原', () => {
  const accounts = []
  for (let i = 0; i < 60; i++) accounts.push(mkAccount(i))
  const plan = proto.planSync('sync_delta', { upsert: accounts, remove: ['a', 'b'] }, 't2')
  assert.equal(plan.mode, 'chunk')
  const session = proto.createSession()
  let last = null
  for (const j of plan.jsons) {
    const parsed = proto.parse(j)
    assert.equal(parsed.ok, true)
    last = proto.acceptChunk(session, parsed.msg)
    assert.equal(last.ok, true)
  }
  assert.equal(last.done, true)
  assert.equal(last.payload.upsert.length, 60)
  assert.deepEqual(last.payload.remove, ['a', 'b'])
})

test('acceptChunk：乱序 / 缺片 / 跨 id', () => {
  const s = proto.createSession()
  assert.equal(
    proto.acceptChunk(s, { id: 'a', seq: 0, total: 2, kind: 'accounts', field: 'accounts', data: '[]' }).ok,
    true
  )
  const bad = proto.acceptChunk(s, { id: 'a', seq: 1, total: 3, kind: 'accounts', field: 'accounts', data: '[]' })
  assert.equal(bad.reason, 'bad-seq')
  const s2 = proto.createSession()
  const r = proto.acceptChunk(s2, { id: 'b', seq: 0, total: 1, kind: 'accounts', field: 'accounts', data: '[1]' })
  assert.equal(r.done, true)
  assert.equal(r.payload.accounts[0], 1)
})

test('parse：非 OTP 消息回 bad-app', () => {
  assert.equal(proto.parse('{"app":"bandbox-lyrics","v":1,"type":"hello"}').reason, 'bad-app')
  assert.equal(proto.parse('garbage').reason, 'bad-json')
})

test('unwrapInterconnectPayload：信封与裸消息', () => {
  const bare = proto.encode('hello', { time: 1 })
  assert.equal(proto.unwrapInterconnectPayload(bare).data, bare)
  const env = JSON.stringify({ addr: 'AA', pkgName: 'p', payloadText: bare })
  const u = proto.unwrapInterconnectPayload(env)
  assert.equal(u.addr, 'AA')
  assert.equal(u.data, bare)
})

test('describeReply 文案', () => {
  assert.equal(proto.describeReply({ type: 'ack' }).state, 'sent')
  assert.equal(proto.describeReply({ type: 'err', reason: 'too-large' }).text, '单条账户数据过大')
})
