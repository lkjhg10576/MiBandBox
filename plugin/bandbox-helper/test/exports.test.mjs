import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pluginSrc = readFileSync(new URL('../src/plugin.js', import.meta.url), 'utf8')
const lrcSrc = readFileSync(new URL('../src/lrc.js', import.meta.url), 'utf8')

test('plugin.js 以 lifecycle / event 接口对象导出', () => {
  assert.match(pluginSrc, /export\s+const\s+lifecycle\s*=\s*\{/)
  assert.match(pluginSrc, /export\s+const\s+event\s*=\s*\{/)
  assert.doesNotMatch(pluginSrc, /export\s+function\s+onLoad/)
})

test('API Level 4 导出方法必须声明为 async', () => {
  for (const name of ['onLoad', 'onEvent', 'onUiEvent', 'onUiRender', 'onCardRender']) {
    assert.match(
      pluginSrc,
      new RegExp(`async\\s+${name}\\s*\\(`),
      `${name} 必须声明为 async，否则 async lift 会 trap`
    )
  }
})

test('不使用 QuickJS 运行时缺失的浏览器 API', () => {
  assert.doesNotMatch(pluginSrc, /\bconsole\s*\./)
  assert.doesNotMatch(pluginSrc, /\bsetTimeout\s*\(/)
  assert.doesNotMatch(pluginSrc, /\bclearTimeout\s*\(/)
  assert.doesNotMatch(lrcSrc, /new\s+TextDecoder/)
})
