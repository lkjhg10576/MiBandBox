import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..', '..')
const pluginSrc = path.resolve(here, '..', 'src')

const sha = (p) => crypto.createHash('sha256').update(readFileSync(p, 'utf8')).digest('hex')

test('qrProtocol.js 双端 SHA-256 逐字一致', () => {
  assert.equal(
    sha(path.join(repoRoot, 'src/utils/qrProtocol.js')),
    sha(path.join(pluginSrc, 'qrProtocol.js'))
  )
})

test('qrProtocol：常量与错误码两端一致', async () => {
  const w = (await import(path.join(repoRoot, 'src/utils/qrProtocol.js'))).default
  const p = (await import(path.join(pluginSrc, 'qrProtocol.js'))).default
  for (const k of ['APP_ID', 'VERSION', 'TARGET_PKG', 'MAX_TEXT_BYTES']) {
    assert.equal(w[k], p[k], k)
  }
  assert.deepEqual(w.ERRORS, p.ERRORS)
  assert.deepEqual(w.ERROR_TEXT, p.ERROR_TEXT)
})

test('qrProtocol：encode 两端产出同一份 JSON', async () => {
  const w = (await import(path.join(repoRoot, 'src/utils/qrProtocol.js'))).default
  const p = (await import(path.join(pluginSrc, 'qrProtocol.js'))).default
  const cases = [
    { type: 'qr_import', payload: { id: 'qi-1', text: 'https://example.com' } },
    { type: 'qr_ack', payload: { id: 'qi-1', ok: true, duplicate: false } },
    { type: 'qr_ack', payload: { id: 'qi-2', ok: true, duplicate: true } },
    { type: 'qr_err', payload: { id: 'qi-1', reason: 'too-large' } }
  ]
  for (const c of cases) {
    assert.equal(p.encode(c.type, c.payload), w.encode(c.type, c.payload), c.type)
  }
})

test('qrProtocol：parse 两端判定一致', async () => {
  const w = (await import(path.join(repoRoot, 'src/utils/qrProtocol.js'))).default
  const p = (await import(path.join(pluginSrc, 'qrProtocol.js'))).default
  const raws = [
    '{"app":"bandbox-qr","v":1,"type":"qr_import","id":"qi-1","text":"hi"}',
    '{"app":"bandbox-qr","v":1,"type":"qr_ack","id":"qi-1","ok":true,"duplicate":true}',
    'garbage',
    '{"app":"bandbox-lyrics","v":1,"type":"hello"}',
    '{"app":"bandbox-qr","v":2,"type":"qr_import"}',
    '{"app":"bandbox-qr","v":1}'
  ]
  for (const raw of raws) {
    const wp = w.parse(raw)
    const pp = p.parse(raw)
    assert.equal(pp.ok, wp.ok, raw)
    if (wp.ok) {
      assert.equal(JSON.stringify(pp.msg), JSON.stringify(wp.msg), raw)
    } else {
      assert.equal(pp.reason, wp.reason, raw)
    }
  }
})

test('qrProtocol：byteLength / describeReply 两端一致', async () => {
  const w = (await import(path.join(repoRoot, 'src/utils/qrProtocol.js'))).default
  const p = (await import(path.join(pluginSrc, 'qrProtocol.js'))).default
  for (const s of ['', 'abc', '中文', '😀', 'WIFI:T:WPA;S:家;P:密码;;']) {
    assert.equal(p.byteLength(s), w.byteLength(s), s)
  }
  const msgs = [
    { type: 'qr_ack', duplicate: false },
    { type: 'qr_ack', duplicate: true },
    { type: 'qr_err', reason: 'write-failed' }
  ]
  for (const m of msgs) {
    assert.deepEqual(p.describeReply(m), w.describeReply(m), JSON.stringify(m))
  }
})
