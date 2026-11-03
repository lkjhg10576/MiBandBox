#!/usr/bin/env node
/**
 * 剩余时间倒计时纯逻辑单测（零依赖）。
 * 运行：node tools/test-time.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const time = (await import(pathToFileURL(path.join(root, 'src/utils/time.js')).href)).default

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

console.log('剩余时间倒计时单测')

test('本分钟：xx:yy:30 时剩 30 秒（含 +1 收尾）', () => {
  const now = new Date(2026, 10, 3, 12, 30, 30, 0)
  assert.equal(time.countdownEndOfMinute(now), 30)
})

test('本分钟：整分第 0 秒剩 60 秒', () => {
  const now = new Date(2026, 10, 3, 12, 30, 0, 0)
  assert.equal(time.countdownEndOfMinute(now), 60)
})

test('本小时：12:30:30 剩 1770 秒（29 分 30 秒）', () => {
  const now = new Date(2026, 10, 3, 12, 30, 30, 0)
  assert.equal(time.countdownEndOfHour(now), 1770)
})

test('本小时：跨小时边界（12:59:59 剩 1 秒）', () => {
  const now = new Date(2026, 10, 3, 12, 59, 59, 0)
  assert.equal(time.countdownEndOfHour(now), 1)
})

test('今天：与 countdownToEndOfDay 口径一致', () => {
  const now = new Date(2026, 10, 3, 12, 30, 30, 0)
  assert.equal(time.countdownEndOfMinute(now) <= 60, true)
  assert.equal(time.countdownToEndOfDay(now), 41370)
})

test('本周：周日当天当天截止', () => {
  // 2026-11-01 是周日
  const sun = new Date(2026, 10, 1, 10, 0, 0, 0)
  const sec = time.countdownEndOfWeek(sun)
  const d = time.splitDuration(sec)
  assert.equal(d.days, 0)
  assert.equal(d.hours, 14)
  assert.equal(d.minutes, 0)
  assert.equal(d.seconds, 0)
})

test('本周：周一还剩到下周日 23:59:59', () => {
  // 2026-11-02 是周一
  const mon = new Date(2026, 10, 2, 12, 0, 0, 0)
  const sec = time.countdownEndOfWeek(mon)
  const d = time.splitDuration(sec)
  assert.equal(d.days, 6)
  assert.equal(d.hours, 12)
  assert.equal(d.minutes, 0)
  assert.equal(d.seconds, 0)
})

test('本周：周六还剩 1 天多一点', () => {
  // 2026-11-07 是周六
  const sat = new Date(2026, 10, 7, 12, 0, 0, 0)
  const sec = time.countdownEndOfWeek(sat)
  const d = time.splitDuration(sec)
  assert.equal(d.days, 1)
  assert.equal(d.hours, 12)
})

test('本周：每天 23:59:59 恰好剩 1 秒（周日）', () => {
  const sun = new Date(2026, 10, 1, 23, 59, 59, 0)
  assert.equal(time.countdownEndOfWeek(sun), 1)
})

test('splitDuration 与 dhms 页面口径一致', () => {
  const d = time.splitDuration(6 * 86400 + 3661)
  assert.equal(d.days, 6)
  assert.equal(d.hours, 1)
  assert.equal(d.minutes, 1)
  assert.equal(d.seconds, 1)
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  failures.forEach((f) => console.log(`FAIL: ${f.name}\n  ${f.error.stack}`))
  process.exit(1)
}
