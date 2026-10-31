#!/usr/bin/env node
/**
 * 农历 / 日历纯逻辑单测（零依赖）。
 * 运行：node tools/test-calendar.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const lunar = (await import(pathToFileURL(path.join(root, 'src/utils/lunar.js')).href)).default
const cal = (await import(pathToFileURL(path.join(root, 'src/utils/calendar.js')).href)).default

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

console.log('日历 / 农历单测')

test('2026-11-18 = 丙午年 十月 初十', () => {
  const r = lunar.solarToLunar(2026, 11, 18)
  assert.equal(r.year, 2026)
  assert.equal(r.month, 10)
  assert.equal(r.day, 10)
  assert.equal(r.isLeap, false)
  assert.equal(r.ganZhi, '丙午')
  assert.equal(r.text, '丙午年 十月 初十')
})

test('春节：2024-02-10 / 2026-02-17', () => {
  assert.equal(lunar.solarToLunar(2024, 2, 10).text, '甲辰年 正月 初一')
  assert.equal(lunar.solarToLunar(2026, 2, 17).text, '丙午年 正月 初一')
})

test('闰月：2020 闰四月 / 2023 闰二月', () => {
  assert.equal(lunar.solarToLunar(2020, 5, 23).text, '庚子年 闰四月 初一')
  assert.equal(lunar.solarToLunar(2023, 3, 22).text, '癸卯年 闰二月 初一')
})

test('2033 问题：闰冬月', () => {
  const r = lunar.solarToLunar(2033, 12, 22)
  assert.equal(r.month, 11)
  assert.equal(r.isLeap, true)
  assert.equal(r.text, '癸丑年 闰冬月 初一')
})

test('表边界：1900-01-31 / 2100-12-31', () => {
  assert.equal(lunar.solarToLunar(1900, 1, 31).text, '庚子年 正月 初一')
  const end = lunar.solarToLunar(2100, 12, 31)
  assert.equal(end.year, 2100)
  assert.equal(end.month, 12)
  assert.equal(end.day, 1)
})

test('1900-2100 全量农历→公历往返一致', () => {
  let cur = new Date(Date.UTC(1900, 0, 31))
  const end = new Date(Date.UTC(2100, 11, 31))
  let count = 0
  while (cur <= end) {
    const y = cur.getUTCFullYear()
    const m = cur.getUTCMonth() + 1
    const d = cur.getUTCDate()
    const l = lunar.solarToLunar(y, m, d)
    assert.ok(l, `${y}-${m}-${d} 无农历`)
    const back = lunar.lunarToSolar(l.year, l.month, l.day, l.isLeap)
    assert.deepEqual(back, { year: y, month: m, day: d }, `${y}-${m}-${d} 往返失败`)
    count++
    cur = new Date(cur.getTime() + 86400000)
  }
  assert.equal(count, 73384)
})

test('ISO 周数', () => {
  assert.equal(cal.isoWeek(new Date(2026, 10, 18)), 47)
  assert.equal(cal.isoWeek(new Date(2026, 0, 1)), 1)
  assert.equal(cal.isoWeek(new Date(2020, 11, 31)), 53)
  assert.equal(cal.isoWeek(new Date(2021, 0, 1)), 53)
  assert.equal(cal.isoWeek(new Date(2024, 11, 30)), 1)
  assert.equal(cal.isoWeek(new Date(2027, 0, 1)), 53)
})

test('月网格：2026 年 11 月从周日开始，30 天', () => {
  const cells = cal.buildMonthCells(2026, 10, 18, new Date(2026, 10, 1))
  assert.equal(cells.length, 42)
  assert.equal(cells[0].d, 1)
  assert.equal(cells[0].cls, 'today')
  assert.equal(cells[17].d, 18)
  assert.equal(cells[17].cls, 'sel')
  assert.equal(cells[29].d, 30)
  assert.equal(cells[30].d, 0)
})

test('月网格：2026 年 8 月从周六开始，需要 6 行', () => {
  const cells = cal.buildMonthCells(2026, 7, 1, new Date(2026, 7, 1))
  assert.equal(cells[6].d, 1)
  assert.equal(cells[36].d, 31)
  assert.equal(cells[41].d, 0)
})

test('切月跨年', () => {
  assert.deepEqual(cal.shiftMonth(2026, 11, 1), { year: 2027, month: 0 })
  assert.deepEqual(cal.shiftMonth(2026, 0, -1), { year: 2025, month: 11 })
})

console.log(`\n通过 ${passed}，失败 ${failed}`)
if (failed) {
  failures.forEach((f) => console.log(`- ${f.name}: ${f.error.message}`))
  process.exit(1)
}
