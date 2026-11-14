import { test } from 'node:test'
import assert from 'node:assert/strict'
import qrImport from '../src/qrImport.js'
import proto from '../src/qrProtocol.js'

test('clean：去掉所有换行并 trim', () => {
  const res = qrImport.clean('  https://example.com\n/abc\r\n  ')
  assert.equal(res.ok, true)
  assert.equal(res.text, 'https://example.com/abc')
})

test('clean：换行被拼接而不是保留', () => {
  const res = qrImport.clean('WIFI:T:WPA;\nS:家;\r\nP:密码;;')
  assert.equal(res.ok, true)
  assert.equal(res.text, 'WIFI:T:WPA;S:家;P:密码;;')
  assert.equal(res.text.indexOf('\n'), -1)
  assert.equal(res.text.indexOf('\r'), -1)
})

test('clean：空内容返回 empty', () => {
  assert.deepEqual(qrImport.clean(''), { ok: false, reason: 'empty' })
  assert.deepEqual(qrImport.clean('   \n\r  '), { ok: false, reason: 'empty' })
  assert.deepEqual(qrImport.clean(null), { ok: false, reason: 'empty' })
  assert.deepEqual(qrImport.clean(undefined), { ok: false, reason: 'empty' })
})

test('clean：超过 512 字节返回 too-large，512 字节通过', () => {
  const ok512 = 'a'.repeat(512)
  const res512 = qrImport.clean(ok512)
  assert.equal(res512.ok, true)
  assert.equal(res512.text, ok512)

  const res513 = qrImport.clean('a'.repeat(513))
  assert.equal(res513.ok, false)
  assert.equal(res513.reason, 'too-large')
})

test('clean：按 UTF-8 字节计长（中文 / emoji）', () => {
  // 170 个中文 = 510 字节，通过
  const cn = '中'.repeat(170)
  assert.equal(proto.byteLength(cn), 510)
  assert.equal(qrImport.clean(cn).ok, true)

  // 171 个中文 = 513 字节，拒绝
  const cn2 = '中'.repeat(171)
  assert.equal(proto.byteLength(cn2), 513)
  assert.deepEqual(qrImport.clean(cn2), { ok: false, reason: 'too-large' })

  // emoji 占 4 字节
  assert.equal(proto.byteLength('😀'), 4)
  assert.equal(qrImport.clean('😀'.repeat(128)).ok, true)
  assert.equal(qrImport.clean('😀'.repeat(129)).reason, 'too-large')
})

test('clean：正常文本原样通过', () => {
  const res = qrImport.clean('https://bandbox.example/qr?x=1')
  assert.equal(res.ok, true)
  assert.equal(res.text, 'https://bandbox.example/qr?x=1')
})
