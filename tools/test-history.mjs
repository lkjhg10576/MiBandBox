#!/usr/bin/env node
/**
 * 史载今日数据单测（零依赖）。
 * 运行：node tools/test-history.mjs
 *
 * 覆盖 src/data/history.js 的数据契约：
 *   - 全年 366 天都有键，日期合法（含 02-29，无 02-30）
 *   - 每天至少 1 条史实，重点日期至少 2 条，正文 ≥20 字且不重复
 *   - 小知识池 ≥60 条，tipOfDay 稳定返回两条不同的小知识
 *   - getByDate 兼容旧的字符串写法与新的数组写法，都返回数组
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'
import { statSync } from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

// history.js 是纯 JS（无任何 @system.* 依赖），可直接作为 ESM 导入。
const H = (await import(pathToFileURL(path.join(root, 'src/data/history.js')).href)).default

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

console.log('bandbox-history 史载今日数据单测')

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

// ---------- 键覆盖 ----------
test('全年 366 天都有键，格式为 MM-DD', () => {
  const keys = Object.keys(H.events)
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
  assert.ok('02-29' in H.events, '缺少 02-29')
  assert.ok(!('02-30' in H.events), '不应有 02-30')
  assert.ok(!('02-31' in H.events), '不应有 02-31')
  assert.ok(!('04-31' in H.events), '不应有 04-31')
  assert.ok(!('13-01' in H.events), '不应有 13-01')
  assert.ok(!('00-01' in H.events), '不应有 00-01')
})

test('没有多余/残留的键', () => {
  const expected = new Set(ALL_KEYS)
  for (const k of Object.keys(H.events)) {
    assert.ok(expected.has(k), '出现非法键: ' + k)
  }
})

// ---------- 条目内容 ----------
test('每天至少 1 条史实，重点日期至少 2 条', () => {
  for (const k of ALL_KEYS) {
    const list = H.events[k]
    assert.ok(Array.isArray(list), k + ' 的值应为数组')
    assert.ok(list.length >= 1, k + ' 没有任何史实条目')
  }
  for (const k of KEY_DAYS) {
    assert.ok(H.events[k].length >= 2, k + ' 应有 2 条以上内容，实际 ' + H.events[k].length)
  }
})

test('每条史实结构完整，正文 ≥20 字且含年份', () => {
  for (const k of ALL_KEYS) {
    for (const it of H.events[k]) {
      assert.equal(typeof it.year, 'number', k + ' year 应为数字')
      // 远古建筑落成等条目可能是公元前的世纪数（例：圣索菲亚大教堂 537 年）
      assert.ok(it.year > 100 && it.year < 2100, k + ' 年份不合理: ' + it.year)
      assert.equal(typeof it.title, 'string', k + ' title 应为字符串')
      assert.ok(it.title.length > 0 && it.title.length <= 20, k + ' 标题长度异常: ' + it.title)
      assert.equal(typeof it.text, 'string', k + ' text 应为字符串')
      assert.ok(it.text.length >= 20, k + ' 正文不足 20 字: ' + it.text)
      assert.ok(/\d{4}/.test(it.text), k + ' 正文缺少年份: ' + it.text)
      assert.equal(typeof it.tag, 'string', k + ' tag 应为字符串')
      assert.ok(it.tag.length > 0, k + ' 分类为空')
    }
  }
})

test('分类都在白名单内', () => {
  const allow = new Set(H.tags)
  for (const k of ALL_KEYS) {
    for (const it of H.events[k]) {
      assert.ok(allow.has(it.tag), k + ' 未知分类: ' + it.tag)
    }
  }
})

test('全库正文无重复（同一件事不重复出现）', () => {
  const seen = new Map()
  for (const k of ALL_KEYS) {
    for (const it of H.events[k]) {
      const prev = seen.get(it.text)
      assert.equal(prev, undefined, '正文重复出现在 ' + prev + ' 与 ' + k + '：' + it.text)
      seen.set(it.text, k)
    }
  }
})

// ---------- 小知识池 ----------
test('tips 至少 60 条且互不重复', () => {
  assert.ok(H.tips.length >= 60, 'tips 数量不足 60，实际 ' + H.tips.length)
  assert.equal(new Set(H.tips).size, H.tips.length, 'tips 存在重复')
  for (const t of H.tips) {
    assert.ok(t.length >= 20, '小知识过短: ' + t)
  }
})

test('tipOfDay 对任意 (m,d) 返回两条不同且不越界的小知识', () => {
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= DAYS[m - 1]; d++) {
      const r = H.tipOfDay(m, d)
      assert.ok(Array.isArray(r), 'tipOfDay 应返回数组')
      assert.equal(r.length, 2, m + '-' + d + ' 应返回两条')
      assert.notEqual(r[0], r[1], m + '-' + d + ' 两条小知识相同')
      for (const t of r) {
        assert.ok(H.tips.includes(t), m + '-' + d + ' 返回了池外的小知识')
      }
    }
  }
})

test('tipOfDay 对同一日期稳定（多次调用结果一致）', () => {
  for (const [m, d] of [[1, 1], [6, 15], [12, 31], [2, 29], [3, 3]]) {
    const a = H.tipOfDay(m, d)
    const b = H.tipOfDay(m, d)
    assert.deepEqual(a, b, m + '-' + d + ' 结果不稳定')
  }
})

// ---------- getByDate ----------
test('getByDate 返回数组，元素结构完整', () => {
  for (const k of ALL_KEYS) {
    const list = H.getByDate(Number(k.slice(0, 2)), Number(k.slice(3, 5)))
    assert.ok(Array.isArray(list), k + ' getByDate 应返回数组')
    assert.ok(list.length >= 1, k + ' getByDate 结果为空')
    for (const it of list) {
      assert.ok(typeof it.text === 'string' && it.text.length > 0, k + ' 条目缺少正文')
    }
  }
})

test('getByDate 兼容旧的字符串写法（迁移期）', () => {
  H.events['06-15'] = '测试用旧格式条目，1999 年 6 月 15 日，用于验证字符串写法能被归一成数组。'
  try {
    const list = H.getByDate(6, 15)
    assert.ok(Array.isArray(list), '旧格式应归一成数组')
    assert.equal(list.length, 1)
    assert.equal(list[0].year, 1999, '旧格式应从正文里解析出年份')
    assert.ok(list[0].text.includes('旧格式'))
  } finally {
    delete H.events['06-15']
  }
})

test('getByDate 兼容新的数组写法', () => {
  H.events['06-16'] = [{ year: 2001, title: '测试标题', text: '测试正文，内容长度足够通过校验。', tag: '科技' }]
  try {
    const list = H.getByDate(6, 16)
    assert.equal(list.length, 1)
    assert.equal(list[0].title, '测试标题')
    assert.equal(list[0].tag, '科技')
  } finally {
    delete H.events['06-16']
  }
})

test('getByDate 对随机 20 天结果稳定且与 events 一致', () => {
  const picks = []
  for (let i = 0; i < 20; i++) {
    const idx = Math.floor((i * 37) % ALL_KEYS.length)
    picks.push(ALL_KEYS[idx])
  }
  for (const k of picks) {
    const m = Number(k.slice(0, 2))
    const d = Number(k.slice(3, 5))
    const a = H.getByDate(m, d)
    const b = H.getByDate(m, d)
    assert.deepEqual(a, b, k + ' 两次读取结果不一致')
    assert.equal(a.length, H.events[k].length, k + ' 返回条数与数据不一致')
  }
})

test('getByDate 对不存在的日期返回空数组', () => {
  assert.deepEqual(H.getByDate(2, 30), [])
  assert.deepEqual(H.getByDate(13, 1), [])
})

// ---------- 体积预算 ----------
test('数据文件体积在预算内（< 200 KB）', () => {
  const size = statSync(path.join(root, 'src/data/history.js')).size
  assert.ok(size < 200 * 1024, '数据文件过大: ' + Math.round(size / 1024) + ' KB')
  console.log(`      数据文件大小: ${Math.round(size / 1024)} KB`)
})

// ---------- 清理 ----------
console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
if (failed > 0) {
  console.log('\n失败详情：')
  for (const f of failures) {
    console.log(`- ${f.name}: ${f.error.stack || f.error.message}`)
  }
  process.exit(1)
}
