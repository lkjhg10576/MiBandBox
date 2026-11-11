import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  APP_ID, VERSION, CHUNK_LIMIT, ENVELOPE_RESERVE, ERRORS, encode, decode,
  unwrapInterconnectPayload, jsonTextCost, chunkBudget, splitChunks, checkTransferable, needsChunk,
  byteLength, makeId, planSend, chunkMessage, hello, pong, describeReply, message
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
  for (const c of chunks) {
    assert.ok(jsonTextCost(c) <= 256, '单片 JSON 字节成本不应超过限制: ' + jsonTextCost(c))
  }
  assert.equal(chunks.join('\n'), body)
})

test('splitChunks 按 UTF-8 字节切分（中文）', () => {
  const lines = []
  for (let i = 0; i < 400; i++) {
    lines.push('第' + i + '行：明月几时有，把酒问青天，不知天上宫阙。')
  }
  const body = lines.join('\n')
  assert.ok(byteLength(body) > CHUNK_LIMIT, '中文正文 UTF-8 字节应超过 12 KB 才会触发分片')
  const { chunks, total } = splitChunks(body)
  assert.ok(total >= 2, '中文长歌词应被切成多片，实际 ' + total + ' 片')
  for (const c of chunks) {
    assert.ok(jsonTextCost(c) <= CHUNK_LIMIT, '单片 JSON 字节成本不应超过 12 KB: ' + jsonTextCost(c))
  }
  assert.equal(chunks.join('\n'), body)
})

test('splitChunks 保留前导空行', () => {
  const { chunks } = splitChunks('\nabc\ndef')
  assert.equal(chunks.join('\n'), '\nabc\ndef')
})

test('splitChunks 空文本仍产生一片', () => {
  const { chunks, total } = splitChunks('')
  assert.equal(total, 1)
  assert.equal(chunks[0], '')
})

test('splitChunks 单行超长时该行独占一片（插件端由 checkTransferable 先行拒绝）', () => {
  const long = '长'.repeat(30000)
  const { chunks, total } = splitChunks(long, 1024)
  assert.equal(total, 1)
  assert.equal(chunks[0], long)
})

test('chunkBudget 与 jsonTextCost 口径一致', () => {
  assert.equal(chunkBudget(''), CHUNK_LIMIT - ENVELOPE_RESERVE)
  assert.equal(chunkBudget('abc'), CHUNK_LIMIT - ENVELOPE_RESERVE - 3)
  assert.equal(chunkBudget('标题'), CHUNK_LIMIT - ENVELOPE_RESERVE - 6)
  assert.equal(jsonTextCost(''), 0)
  assert.equal(jsonTextCost('abc'), 3)
  assert.equal(jsonTextCost('中'), 3)
  assert.equal(jsonTextCost('😀'), 4)
  assert.equal(jsonTextCost('"'), 2) // 转义成 \" 占 2 字节
  assert.equal(jsonTextCost('\n'), 2) // 转义成 \n 占 2 字节
  assert.equal(jsonTextCost('\\'), 2)
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

test('planSend 每片上线消息不超 CHUNK_LIMIT（核心断言）', () => {
  const lines = []
  for (let i = 0; i < 2000; i++) lines.push('第' + i + '行歌词内容，验证按字节切分。')
  const title = '长歌'
  const p = planSend(title, lines, 'id-byte')
  assert.equal(p.mode, 'chunk')
  for (let i = 0; i < p.chunks.length; i++) {
    const json = chunkMessage(p.id, i, p.total, title, p.chunks[i])
    assert.ok(
      byteLength(json) <= CHUNK_LIMIT,
      '上线消息应 ≤ ' + CHUNK_LIMIT + ' 字节，实际 ' + byteLength(json)
    )
  }
  assert.equal(p.chunks.join('\n'), lines.join('\n'))
})

test('checkTransferable 拒绝超长单行', () => {
  const lines = ['第一行', '长'.repeat(30000), '第三行']
  const r = checkTransferable('歌', lines)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'line-too-long')
  assert.equal(r.lineIndex, 1)
  assert.ok(r.bytes > r.limit)
})

test('checkTransferable 拒绝超长标题', () => {
  const r = checkTransferable('标'.repeat(6000), ['a'])
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'title-too-long')
  assert.ok(r.bytes > r.limit)
})

test('checkTransferable 接受普通中文长歌词', () => {
  const lines = []
  for (let i = 0; i < 400; i++) lines.push('第' + i + '行：明月几时有，把酒问青天。')
  const r = checkTransferable('水调歌头', lines)
  assert.deepEqual(r, { ok: true })
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

test('pong 可构造并解码', () => {
  const raw = pong('p-1')
  const r = decode(raw)
  assert.equal(r.ok, true)
  assert.equal(r.msg.type, 'pong')
  assert.equal(r.msg.id, 'p-1')
})

test('unwrapInterconnectPayload 保留裸协议消息', () => {
  const raw = encode('ack', { id: 'x', ok: true, name: '歌' })
  const env = unwrapInterconnectPayload(raw)
  assert.equal(env.data, raw)
  assert.equal(env.addr, '')
  assert.equal(env.pkgName, '')
})

test('unwrapInterconnectPayload 解析 payloadText 信封', () => {
  const raw = encode('ready', { id: 'r-1' })
  const env = unwrapInterconnectPayload(JSON.stringify({
    addr: 'AA:BB:CC',
    pkgName: 'com.miband.bandbox',
    payloadText: raw,
    payloadHex: '00ff'
  }))
  assert.equal(env.addr, 'AA:BB:CC')
  assert.equal(env.pkgName, 'com.miband.bandbox')
  assert.equal(env.data, raw)
})

test('unwrapInterconnectPayload 解析 payload 对象', () => {
  const inner = { app: APP_ID, v: VERSION, type: 'ping', id: 'p-1' }
  const env = unwrapInterconnectPayload(JSON.stringify({
    addr: 'AA:BB:CC',
    payload: inner
  }))
  assert.equal(env.addr, 'AA:BB:CC')
  assert.deepEqual(JSON.parse(env.data), inner)
})

test('unwrapInterconnectPayload 解析 payloadHex', () => {
  const raw = encode('pong', { id: 'p-1' })
  const hex = Buffer.from(raw, 'utf8').toString('hex')
  const env = unwrapInterconnectPayload(JSON.stringify({ addr: 'AA', payloadHex: hex }))
  assert.equal(env.addr, 'AA')
  assert.equal(env.data, raw)
})

test('unwrapInterconnectPayload 对坏 JSON 回退原文', () => {
  const env = unwrapInterconnectPayload('{oops')
  assert.equal(env.data, '{oops')
})
