import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const srcDir = new URL('../src/', import.meta.url)

const srcFiles = readdirSync(srcDir).filter((f) => f.endsWith('.js'))
const sources = srcFiles.map((f) => ({
  file: f,
  code: readFileSync(new URL(f, srcDir), 'utf8')
}))

/**
 * Level 4 宿主接口里属于 `async func` 的那些。
 * 它们在 JS 侧返回 Promise，不 await 就拿不到值。
 */
const ASYNC_HOST_FUNCS = [
  'pickFile',
  'platform',
  'sendQaicMessage',
  'registerInterconnectRecv',
  'getConnectedDeviceList',
  'getDeviceList'
]

/**
 * 同步的宿主接口（timer），不需要 await。
 */
const SYNC_HOST_FUNCS = ['setHostTimeout', 'setHostInterval', 'clearTimer']

/**
 * 取某次调用之前的「当前语句」片段：截到最近的 ; { } 为止。
 */
function statementBefore(code, index) {
  const head = code.slice(0, index)
  const cut = Math.max(
    head.lastIndexOf(';'),
    head.lastIndexOf('{'),
    head.lastIndexOf('}')
  )
  return head.slice(cut + 1)
}

function callSites(code, name) {
  const out = []
  const re = new RegExp(`(?<![\\w.$])${name}\\s*\\(`, 'g')
  let m
  while ((m = re.exec(code)) !== null) out.push(m.index)
  return out
}

test('所有 async 宿主接口调用都被 await（或包在 hostCall 里）', () => {
  for (const { file, code } of sources) {
    for (const name of ASYNC_HOST_FUNCS) {
      for (const index of callSites(code, name)) {
        const stmt = statementBefore(code, index)
        const awaited = /\bawait\b/.test(stmt)
        const wrapped = /hostCall\(/.test(stmt)
        assert.ok(
          awaited || wrapped,
          `${file}: 「${name}(...)」没有被 await，也没有包在 hostCall() 里。\n` +
            `Level 4 的 async func 在 JS 侧返回 Promise，不 await 的话拿到的是 Promise 对象。\n` +
            `上下文：${stmt.trim().slice(-120)}`
        )
      }
    }
  }
})

test('同步宿主接口（timer）不被误加 await', () => {
  for (const { file, code } of sources) {
    for (const name of SYNC_HOST_FUNCS) {
      for (const index of callSites(code, name)) {
        const stmt = statementBefore(code, index)
        assert.doesNotMatch(
          stmt,
          /\bawait\b/,
          `${file}: 「${name}(...)」是同步接口（func，不是 async func），不需要 await`
        )
      }
    }
  }
})

test('device.list() 的结果被 await', () => {
  const plugin = sources.find((s) => s.file === 'plugin.js')
  assert.ok(plugin, '找不到 plugin.js')
  assert.match(
    plugin.code,
    /await\s+device\.list\(\)/,
    'device.list() 是 async，必须 await 才能拿到设备数组'
  )
})

test('pick-file 的 option<string> 参数用 null 表示 none', () => {
  const plugin = sources.find((s) => s.file === 'plugin.js')
  assert.ok(plugin, '找不到 plugin.js')
  assert.match(plugin.code, /copyTo:\s*null/, 'option<string> 的 none 必须传 null，不能传 undefined')
  assert.doesNotMatch(plugin.code, /copyTo:\s*undefined/)
})

test('宿主调用统一走 hostCall，失败转成 { ok:false }', () => {
  const plugin = sources.find((s) => s.file === 'plugin.js')
  assert.ok(plugin, '找不到 plugin.js')
  assert.match(plugin.code, /async\s+function\s+hostCall\(/)
  assert.match(plugin.code, /catch\s*\(e\)/, '顶层 result 失败是抛错，必须 catch')
})
