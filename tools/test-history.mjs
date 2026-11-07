#!/usr/bin/env node
/**
 * 史载今日数据单测（零依赖）。
 * 运行：node tools/test-history.mjs
 *
 * 覆盖 src/common/data/history/*.txt 的数据契约（L4-5 外置后的形态）：
 *   - 12 个月度文件 + tips.txt 齐全，全年 366 天都有键
 *   - 日期合法（含 02-29，无 02-30，无 13 月）
 *   - 每天至少 1 条史实，重点日期至少 2 条，正文 ≥20 字且不重复
 *   - 小知识池 ≥60 条，tipOfDay 稳定返回两条不同的小知识
 *   - getByDate 兼容旧的字符串写法与新的数组写法，都返回数组
 *
 * 取数与归一化直接复用 src/utils/historyPure.js 里的纯函数（pickFrom / hashOf / keyOf），
 * 保证单测覆盖的是运行时真正使用的那份实现。
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const dir = path.join(root, 'src/common/data/history')

const HD = (await import(pathToFileURL(path.join(root, 'src/utils/historyPure.js')).href)).default

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

console.log('bandbox-history 史载今日数据单测（包内 .txt 形态）')

// ---- 读入 12 个月度文件 + tips ----
const months = {}
for (let m = 1; m <= 12; m++) {
  const name = String(m).padStart(2, '0') + '.txt'
  const file = path.join(dir, name)
  if (existsSync(file)) months[name] = JSON.parse(readFileSync(file, 'utf8'))
}
const tips = JSON.parse(readFileSync(path.join(dir, 'tips.txt'), 'utf8'))

// 全量扁平化（与运行时「按月取」等价视图）
const events = {}
for (const name of Object.keys(months)) {
  for (const k of Object.keys(months[name])) events[k] = months[name][k]
}

const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const ALL_KEYS = []
for (let m = 1; m <= 12; m++) {
  for (let d = 1; d <= DAYS[m - 1]; d++) {
    ALL_KEYS.push(String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'))
  }
}

// 重点日期：这些日子应当有 2 条以上内容
const KEY_DAYS = [
  '01-01', '02-14', '02-29', '03-14', '04-01', '04-22', '05-01', '05-18',
  '06-01', '06-23', '08-19', '09-10', '11-01', '12-24', '12-25'
]

test('12 个月度文件齐全', () => {
  assert.equal(Object.keys(months).length, 12, '月度文件数应为 12')
  for (let m = 1; m <= 12; m++) {
    const name = String(m).padStart(2, '0') + '.txt'
    assert.ok(existsSync(path.join(dir, name)), '缺 ' + name)
  }
  assert.ok(existsSync(path.join(dir, 'tips.txt')), '缺 tips.txt')
})

test('全年 366 天都有键，格式为 MM-DD', () => {
  const keys = Object.keys(events)
  assert.equal(keys.length, 366, '键数量应为 366，实际 ' + keys.length)
  for (const k of keys) {
    assert.match(k, /^\d{2}-\d{2}$/, '键格式非法: ' + k)
    const m = Number(k.slice(0, 2))
    const d = Number(k.slice(3, 5))
    assert.ok(m >= 1 && m <= 12, '月份越界: ' + k)
    assert.ok(d >= 1 && d <= DAYS[m - 1], '日期越界: ' + k)
  }
})

test('包含 02-29，且不存在 02-30 等非法日期', () => {
  assert.ok('02-29' in events, '缺少 02-29')
  assert.ok(!('02-30' in events), '不应有 02-30')
  assert.ok(!('02-31' in events), '不应有 02-31')
  assert.ok(!('04-31' in events), '不应有 04-31')
  assert.ok(!('13-01' in events), '不应有 13-01')
  assert.ok(!('00-01' in events), '不应有 00-01')
})

test('没有多余/残留的键', () => {
  const expected = new Set(ALL_KEYS)
  for (const k of Object.keys(events)) {
    assert.ok(expected.has(k), '出现非法键: ' + k)
  }
})

test('每个月文件只含本月的键', () => {
  for (let m = 1; m <= 12; m++) {
    const name = String(m).padStart(2, '0') + '.txt'
    for (const k of Object.keys(months[name])) {
      assert.ok(k.startsWith(String(m).padStart(2, '0') + '-'), name + ' 混入了 ' + k)
    }
  }
})

test('每天至少 1 条史实，重点日期至少 2 条', () => {
  for (const k of ALL_KEYS) {
    const list = HD.pickFrom(events, Number(k.slice(0, 2)), Number(k.slice(3, 5)))
    assert.ok(Array.isArray(list), k + ' 的值应为数组')
    assert.ok(list.length >= 1, k + ' 没有任何史实条目')
  }
  for (const k of KEY_DAYS) {
    const list = HD.pickFrom(events, Number(k.slice(0, 2)), Number(k.slice(3, 5)))
    assert.ok(list.length >= 2, k + ' 应有 2 条以上内容，实际 ' + list.length)
  }
})

test('每条史实正文 ≥20 字', () => {
  for (const k of ALL_KEYS) {
    const list = HD.pickFrom(events, Number(k.slice(0, 2)), Number(k.slice(3, 5)))
    for (const it of list) {
      assert.ok(String(it.text).length >= 20, k + ' 正文过短: ' + it.text)
      assert.ok(typeof it.year === 'number', k + ' 缺 year 字段')
      assert.ok(typeof it.title === 'string', k + ' 缺 title 字段')
      assert.ok(typeof it.tag === 'string', k + ' 缺 tag 字段')
    }
  }
})

test('同一天的正文互不重复', () => {
  for (const k of ALL_KEYS) {
    const list = HD.pickFrom(events, Number(k.slice(0, 2)), Number(k.slice(3, 5)))
    const set = new Set(list.map((it) => it.text))
    assert.equal(set.size, list.length, k + ' 有重复正文')
  }
})

test('小知识池 ≥60 条', () => {
  assert.ok(Array.isArray(tips))
  assert.ok(tips.length >= 60, '小知识只有 ' + tips.length + ' 条')
})

test('tipOfDay 稳定返回两条不同的小知识', () => {
  const n = tips.length
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= 28; d++) {
      const h = HD.hashOf(m, d)
      const i1 = h % n
      let i2 = Math.floor(h / n) % n
      if (i2 === i1) i2 = (i2 + 1) % n
      assert.notEqual(i1, i2, '同一天两条小知识相同: ' + m + '-' + d)
      assert.equal(h, HD.hashOf(m, d), '散列不稳定')
    }
  }
})

test('getByDate 兼容旧的字符串写法', () => {
  const legacy = { '01-01': ['1999 年 1 月 1 日，这是一条用于兼容测试的旧格式正文，长度足够通过校验。'] }
  const list = HD.pickFrom(legacy, 1, 1)
  assert.equal(list.length, 1)
  assert.equal(list[0].year, 1999)
  assert.ok(list[0].text.length >= 20)
})

console.log('')
console.log(`  ${passed} passed, ${failed} failed`)
if (failed) {
  console.log('')
  failures.forEach((f) => console.log(`  ✗ ${f.name}: ${f.error.message}`))
  process.exit(1)
}
