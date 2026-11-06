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

test('otp.js 双端 SHA-256 逐字一致', () => {
  assert.equal(
    sha(path.join(repoRoot, 'src/utils/otp.js')),
    sha(path.join(pluginSrc, 'otp.js'))
  )
})

test('otpAccounts.js 双端 SHA-256 逐字一致', () => {
  assert.equal(
    sha(path.join(repoRoot, 'src/utils/otpAccounts.js')),
    sha(path.join(pluginSrc, 'otpAccounts.js'))
  )
})

test('otpProtocol：常量与错误码两端一致', async () => {
  const w = (await import(path.join(repoRoot, 'src/utils/otpProtocol.js'))).default
  const p = (await import(path.join(pluginSrc, 'otpProtocol.js'))).default
  for (const k of ['APP_ID', 'VERSION', 'TARGET_PKG', 'CHUNK_LIMIT', 'ENVELOPE_RESERVE']) {
    assert.equal(w[k], p[k], k)
  }
  assert.deepEqual(w.ERRORS, p.ERRORS)
  assert.deepEqual(w.ERROR_TEXT, p.ERROR_TEXT)
})
