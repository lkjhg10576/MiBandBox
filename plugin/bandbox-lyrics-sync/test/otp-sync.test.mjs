import { test } from 'node:test'
import assert from 'node:assert/strict'
import otpSync from '../src/otpSync.js'
import acc from '../src/otpAccounts.js'

const mk = (name) => acc.newAccount({ name, secret: 'JBSWY3DPEHPK3PXP' })

test('replaceAll 后三态一致、无待同步', () => {
  const sync = otpSync.createOtpSync()
  const a = mk('a')
  const b = mk('b')
  otpSync.replaceAll(sync, [a, b])
  assert.equal(sync.loaded, true)
  assert.equal(otpSync.hasPending(sync), false)
  const d = otpSync.getSyncDelta(sync)
  assert.equal(d.upsert.length, 0)
  assert.equal(d.remove.length, 0)
})

test('本地编辑 → delta 只包含变更项', () => {
  const sync = otpSync.createOtpSync()
  const a = mk('a')
  const b = mk('b')
  otpSync.replaceAll(sync, [a, b])
  // 编辑 a 的名称
  otpSync.applyLocalUpsert(sync, [{ ...a, name: 'a2' }])
  // 新增 c
  const c = mk('c')
  otpSync.applyLocalUpsert(sync, [c])
  const d = otpSync.getSyncDelta(sync)
  assert.equal(d.upsert.length, 2)
  assert.ok(d.upsert.some((x) => x.id === a.id && x.name === 'a2'))
  assert.ok(d.upsert.some((x) => x.id === c.id))
  assert.equal(d.remove.length, 0)
})

test('本地删除 → remove + deletedIds，且删除不进 upsert', () => {
  const sync = otpSync.createOtpSync()
  const a = mk('a')
  otpSync.replaceAll(sync, [a])
  otpSync.applyLocalRemove(sync, a.id)
  const d = otpSync.getSyncDelta(sync)
  assert.deepEqual(d.remove, [a.id])
  assert.equal(d.upsert.length, 0)
})

test('同凭据重复导入复用已有 id（不产生克隆）', () => {
  const sync = otpSync.createOtpSync()
  const a = mk('a')
  otpSync.replaceAll(sync, [a])
  otpSync.applyLocalUpsert(sync, [acc.newAccount({ name: 'a', secret: 'JBSWY3DPEHPK3PXP' })])
  assert.equal(sync.local.length, 1)
  assert.equal(sync.local[0].id, a.id)
})

test('commitSuccess 推进 baseline；discardLocal 回滚', () => {
  const sync = otpSync.createOtpSync()
  const a = mk('a')
  otpSync.replaceAll(sync, [a])
  otpSync.applyLocalUpsert(sync, [{ ...a, name: 'edited' }])
  otpSync.commitSuccess(sync)
  assert.equal(otpSync.hasPending(sync), false)
  assert.equal(sync.baseline[0].name, 'edited')
  otpSync.applyLocalUpsert(sync, [{ ...a, name: 'more' }])
  otpSync.discardLocal(sync)
  assert.equal(sync.local[0].name, 'edited')
  assert.equal(otpSync.hasPending(sync), false)
})

test('未拉取时（loaded=false）替换为空列表', () => {
  const sync = otpSync.createOtpSync()
  otpSync.replaceAll(sync, [])
  assert.equal(sync.loaded, true)
  assert.equal(sync.local.length, 0)
})
