import { test } from 'node:test'
import assert from 'node:assert/strict'
import proto from '../src/qrProtocol.js'

test('encode("qr_import") → parse 往返', () => {
  const json = proto.encode('qr_import', { id: 'qi-1', text: 'https://example.com' })
  const parsed = proto.parse(json)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.msg.app, proto.APP_ID)
  assert.equal(parsed.msg.v, proto.VERSION)
  assert.equal(parsed.msg.type, 'qr_import')
  assert.equal(parsed.msg.id, 'qi-1')
  assert.equal(parsed.msg.text, 'https://example.com')
})

test('qrImportMessage：字段与默认 id', () => {
  const msg = proto.parse(proto.qrImportMessage('hello', 'qi-9')).msg
  assert.equal(msg.type, 'qr_import')
  assert.equal(msg.id, 'qi-9')
  assert.equal(msg.text, 'hello')
  assert.equal(typeof msg.ts, 'number')

  const auto = proto.parse(proto.qrImportMessage('hello')).msg
  assert.ok(auto.id, '未指定 id 时应自动生成')
  assert.ok(auto.id.indexOf('qi-') === 0, '默认 id 前缀应为 qi-，实际：' + auto.id)
})

test('qrAckMessage / qrErrMessage：字段与默认值', () => {
  const ack = proto.parse(proto.qrAckMessage('qi-2', true)).msg
  assert.equal(ack.type, 'qr_ack')
  assert.equal(ack.id, 'qi-2')
  assert.equal(ack.ok, true)
  assert.equal(ack.duplicate, true)

  const ackNoDup = proto.parse(proto.qrAckMessage('qi-3')).msg
  assert.equal(ackNoDup.duplicate, false)

  const err = proto.parse(proto.qrErrMessage('qi-4', 'too-large')).msg
  assert.equal(err.type, 'qr_err')
  assert.equal(err.id, 'qi-4')
  assert.equal(err.reason, 'too-large')

  const errDefault = proto.parse(proto.qrErrMessage()).msg
  assert.equal(errDefault.id, '')
  assert.equal(errDefault.reason, proto.ERRORS.WRITE_FAILED)
})

test('parse：拒绝非法消息', () => {
  assert.equal(proto.parse('garbage').reason, proto.ERRORS.BAD_JSON)
  assert.equal(proto.parse('').reason, proto.ERRORS.BAD_JSON)
  assert.equal(proto.parse(null).reason, proto.ERRORS.BAD_JSON)
  assert.equal(proto.parse('[]').reason, proto.ERRORS.BAD_JSON)
  assert.equal(
    proto.parse('{"app":"bandbox-lyrics","v":1,"type":"hello"}').reason,
    proto.ERRORS.BAD_APP
  )
  assert.equal(
    proto.parse('{"app":"bandbox-otp","v":1,"type":"hello"}').reason,
    proto.ERRORS.BAD_APP
  )
  assert.equal(
    proto.parse('{"app":"bandbox-qr","v":2,"type":"qr_import"}').reason,
    proto.ERRORS.VERSION
  )
  assert.equal(
    proto.parse('{"app":"bandbox-qr","v":1}').reason,
    proto.ERRORS.BAD_TYPE
  )
})

test('byteLength：ASCII / 中文 / emoji', () => {
  assert.equal(proto.byteLength(''), 0)
  assert.equal(proto.byteLength('abc'), 3)
  assert.equal(proto.byteLength('中文'), 6)
  assert.equal(proto.byteLength('😀'), 4)
  assert.equal(proto.byteLength('a中😀'), 8)
  assert.equal(proto.byteLength(null), 0)
})

test('describeReply：qr_ack 的 duplicate 两种文案', () => {
  const fresh = proto.describeReply({ type: 'qr_ack', duplicate: false })
  assert.equal(fresh.state, 'sent')
  assert.equal(fresh.text, '手环已保存，可在「我的收藏」查看')

  const dup = proto.describeReply({ type: 'qr_ack', duplicate: true })
  assert.equal(dup.state, 'sent')
  assert.equal(dup.text, '手环已收藏过该内容')

  const err = proto.describeReply({ type: 'qr_err', reason: 'too-large' })
  assert.equal(err.state, 'failed')
  assert.equal(err.text, proto.ERROR_TEXT['too-large'])

  const unknown = proto.describeReply({ type: 'qr_xxx' })
  assert.equal(unknown.state, 'unknown')
})

test('MAX_TEXT_BYTES 上限为 512 字节', () => {
  assert.equal(proto.MAX_TEXT_BYTES, 512)
})
