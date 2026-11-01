#!/usr/bin/env node
/**
 * 原生输入工具单测（零依赖）。
 * 运行：node tools/test-input.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const T = (await import(pathToFileURL(path.join(root, 'src/utils/textInput.js')).href)).default

let passed = 0
let failed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    failures.push({ name, error: e })
    console.log(`  ✗ ${name}`)
    console.log(`      ${e.message}`)
  }
}

console.log('原生输入工具单测')

test('eventValue 兼容 input 的 value', () => {
  assert.equal(T.eventValue({ value: 'abc' }), 'abc')
})

test('eventValue 兼容 textarea 的 text', () => {
  assert.equal(T.eventValue({ text: 'abc' }), 'abc')
})

test('eventValue 兼容 detail 包装', () => {
  assert.equal(T.eventValue({ detail: { value: 'abc' } }), 'abc')
  assert.equal(T.eventValue({ detail: { text: 'abc' } }), 'abc')
})

test('eventValue 空事件返回空串', () => {
  assert.equal(T.eventValue(null), '')
  assert.equal(T.eventValue({}), '')
})

test('normalize 统一 CRLF', () => {
  assert.equal(T.normalize('a\r\nb\rc', true), 'a\nb\nc')
})

test('normalize 单行把换行转空格', () => {
  assert.equal(T.normalize('a\nb', false), 'a b')
})

test('clamp 按字符截断中文', () => {
  assert.equal(T.clamp('妈妈妈妈妈妈', 3, false), '妈妈妈')
})

test('clamp 保留多行换行', () => {
  assert.equal(T.clamp('第一行\n第二行', 100, true), '第一行\n第二行')
})

test('clamp 单行吃掉换行', () => {
  assert.equal(T.clamp('第一行\n第二行', 100, false), '第一行 第二行')
})

test('clamp 非法上限不截断', () => {
  assert.equal(T.clamp('abc', '', false), 'abc')
  assert.equal(T.clamp('abc', 0, false), 'abc')
})

test('sanitizeMorse 保留字母数字和常用符号', () => {
  assert.equal(T.sanitizeMorse('sos 123!?'), 'SOS 123!?')
})

test('sanitizeMorse 去掉中文', () => {
  assert.equal(T.sanitizeMorse('你好SOS'), 'SOS')
})

test('sanitizeMorse 去掉不支持的符号', () => {
  assert.equal(T.sanitizeMorse('a#b'), 'AB')
})

test('focus/blur 在没有 $element 时静默失败', () => {
  T.focus({}, 'x')
  T.blur({}, 'x')
  T.focus(null, 'x')
})

test('focus/blur 调用组件 focus 方法', () => {
  const calls = []
  const vm = {
    $element: (id) => ({
      focus: (arg) => calls.push({ id, arg })
    })
  }
  T.focus(vm, 'editor')
  T.blur(vm, 'editor')
  assert.deepEqual(calls, [
    { id: 'editor', arg: { focus: true } },
    { id: 'editor', arg: { focus: false } }
  ])
})

console.log('')
console.log(`${passed} passed, ${failed} failed`)
if (failed) {
  failures.forEach((f) => console.log(`${f.name}: ${f.error.stack}`))
  process.exitCode = 1
}
