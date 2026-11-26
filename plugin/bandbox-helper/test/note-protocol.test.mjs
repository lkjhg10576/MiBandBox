import { test } from 'node:test'
import assert from 'node:assert/strict'
import proto from '../src/noteProtocol.js'

test('encode("note_push") → parse 往返', () => {
  const json = proto.notePushMessage({
    id: 'np-1',
    title: '待办',
    body: '第一行\n第二行',
    conflict: 'overwrite',
    ts: 100
  })
  const parsed = proto.parse(json)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.msg.app, proto.APP_ID)
  assert.equal(parsed.msg.type, 'note_push')
  assert.equal(parsed.msg.title, '待办')
  assert.equal(parsed.msg.body, '第一行\n第二行')
  assert.equal(parsed.msg.conflict, 'overwrite')
})

test('validateNoteInput 校验空值与配额上限', () => {
  assert.equal(proto.validateNoteInput('', '').reason, proto.ERRORS.EMPTY)
  assert.equal(proto.validateNoteInput('x'.repeat(25), 'a').reason, proto.ERRORS.TITLE_TOO_LONG)
  assert.equal(proto.validateNoteInput('ok', 'a'.repeat(1001)).reason, proto.ERRORS.BODY_TOO_LONG)
  assert.equal(proto.byteLength('😀'), 4)
  assert.equal(proto.validateNoteInput('ok', '字'.repeat(1000)).bytes, 3000)
  const ok = proto.validateNoteInput('', '这是正文标题\r\n第二行')
  assert.equal(ok.ok, true)
  assert.equal(ok.title, '这是正文标题')
  assert.equal(ok.body, '这是正文标题\n第二行')
})

test('describeReply 返回准确文案', () => {
  assert.equal(proto.describeReply({ type: 'note_ack', name: 'A', overwritten: false }).text, '已保存到手表笔记本「A」')
  assert.equal(proto.describeReply({ type: 'note_ack', name: 'A', overwritten: true }).text, '已覆盖手表笔记「A」')
  assert.equal(proto.describeReply({ type: 'note_err', reason: 'write-failed' }).state, 'failed')
})
