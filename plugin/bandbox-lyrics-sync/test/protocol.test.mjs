import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  APP_ID, VERSION, ERRORS, encode, decode, splitChunks, needsChunk,
  byteLength, makeId, planSend, chunkMessage, hello, describeReply, message
} from '../src/protocol.js'

test('message() 带上公共字段', () => {
  const m = message('lyrics', { id: 'x' })
  assert.equal(m.app, APP_ID)
  assert.equal(m.v, VERSION)
  assert.equal(m.type, 'lyrics')
  assert.equal(m.id, 'x')
})

test('encode/decode 往返一致', () => {
  const json = encode('lyrics', { id: 'a', title: '歌', lines: ['一'] })
  const r = decode(json)
  assert.equal(r.ok, true)
  assert.equal(r.msg.title, '歌')
  assert.deepEqual(r.msg.lines, ['一'])
})

test('decode 拒绝坏 JSON', () => {
  assert.equal(decode('{oops').reason, ERRORS.BAD_JSON)
  assert.equal(decode(42).reason, ERRORS.BAD_JSON)
  assert.equal(decode(null).reason, ERRORS.BAD_JSON)
})

test('decode 拒绝错误的 app', () => {
  assert.equal(decode(JSON.stringify({ app: 'x', v: 1, type: 'a' })).reason, ERRORS.BAD_APP)
})

test('decode 拒绝错误版本', () => {
  assert.equal(decode(JSON.stringify({ app: APP_ID, v: 7, type: 'a' })).reason, ERRORS.VERSION)
})

test('decode 拒绝缺少 type', () => {
  assert.equal(decode(JSON.stringify({ app: APP_ID, v: 1 })).reason, ERRORS.BAD_TYPE)
})

test('splitChunks 按行切分且可无损重组', () => {
  const lines = []
  for (let i = 0; i < 200; i++) lines.push('line ' + i + ' ' + 'x'.repeat(20))
  const body = lines.join('\n')
  const { chunks, total } = splitChunks(body, 256)
  assert.ok(total > 1)
  assert.equal(chunks.join('\n'), body)
})

test('splitChunks 短文本单片', () => {
  const { chunks, total } = splitChunks('a\nb')
  assert.equal(total, 1)
  assert.equal(chunks[0], 'a\nb')
})

test('byteLength 按 UTF-8 计算', () => {
  assert.equal(byteLength('abc'), 3)
  assert.equal(byteLength('中'), 3)
  assert.equal(byteLength('😀'), 4)
})

test('needsChunk 依据字节数判断', () => {
  const small = encode('lyrics', { id: 'a', title: 't', lines: ['x'] })
  assert.equal(needsChunk(small), false)
  const big = encode('lyrics', { id: 'a', title: 't', lines: ['x'.repeat(20000)] })
  assert.equal(needsChunk(big), true)
})

test('planSend 短歌词走单包', () => {
  const p = planSend('歌', ['一', '二'], 'id1')
  assert.equal(p.mode, 'single')
  assert.equal(p.id, 'id1')
  const r = decode(p.json)
  assert.equal(r.ok, true)
  assert.equal(r.msg.type, 'lyrics')
  assert.equal(r.msg.count, 2)
})

test('planSend 长歌词走分片', () => {
  const lines = []
  for (let i = 0; i < 2000; i++) lines.push('第' + i + '行歌词内容')
  const p = planSend('长歌', lines, 'id2')
  assert.equal(p.mode, 'chunk')
  assert.equal(p.total, p.chunks.length)
  assert.ok(p.total > 1)
  const rejoined = p.chunks.join('\n')
  assert.equal(rejoined, lines.join('\n'))
})

test('chunkMessage 字段正确', () => {
  const json = chunkMessage('id3', 0, 2, '标题', '内容')
  const r = decode(json)
  assert.equal(r.ok, true)
  assert.equal(r.msg.type, 'chunk')
  assert.equal(r.msg.seq, 0)
  assert.equal(r.msg.total, 2)
  assert.equal(r.msg.title, '标题')
  assert.equal(r.msg.data, '内容')
})

test('hello 消息', () => {
  const r = decode(hello('h1'))
  assert.equal(r.msg.type, 'hello')
  assert.equal(r.msg.id, 'h1')
})

test('makeId 唯一且带前缀', () => {
  const a = makeId('ly')
  const b = makeId('ly')
  assert.ok(a.startsWith('ly-'))
  assert.notEqual(a, b)
})

test('describeReply 解释各类回执', () => {
  assert.equal(describeReply({ type: 'ack', name: '歌' }).state, 'sent')
  assert.equal(describeReply({ type: 'err', reason: 'not-armed' }).state, 'failed')
  assert.match(describeReply({ type: 'err', reason: 'not-armed' }).text, /从手机传输/)
  assert.equal(describeReply({ type: 'pong' }).state, 'pong')
  assert.equal(describeReply({ type: 'ready' }).state, 'ready')
  assert.equal(describeReply({ type: 'progress', received: 1, total: 3 }).state, 'progress')
})

test('describeReply 对未知回执安全', () => {
  assert.equal(describeReply(null).state, 'unknown')
  assert.equal(describeReply({ type: 'zzz' }).state, 'unknown')
})
