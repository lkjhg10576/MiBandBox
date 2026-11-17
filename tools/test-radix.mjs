#!/usr/bin/env node
/**
 * 进制转换内核单测（零依赖）。
 * 运行：node tools/test-radix.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const R = await import(pathToFileURL(path.join(root, 'src/utils/radix.js')).href)
const { MAX_VALUE, BASES, base, parse, format, pushKey, convertAll, grouped, splitLines, draftLines } = R

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

// 字面抄自 InputMethod.ux keys.sign 的第 2、3 行；进制不接受负数，'-' 也在拒绝之列
const SIGN_GLYPHS = ['~', '!', '@', '#', '%', '“', '”', '*', '?', '/', '(', ')', '-', '_', ':', ';', '，', '。', '.']

console.log('进制转换内核单测')

test('结构：BASES 顺序与常量', () => {
  assert.equal(BASES.length, 4)
  assert.deepEqual(BASES.map((b) => b.id), ['bin', 'oct', 'dec', 'hex'])
  assert.deepEqual(BASES.map((b) => b.radix), [2, 8, 10, 16])
  assert.deepEqual(BASES.map((b) => b.maxChars), [32, 11, 10, 8])
  assert.deepEqual(BASES.map((b) => b.symbol), ['BIN', 'OCT', 'DEC', 'HEX'])
  assert.deepEqual(BASES.map((b) => b.group), [4, 3, 3, 4])
  assert.equal(MAX_VALUE, 4294967295)
  assert.equal(base('bin').name, '二进制')
  assert.equal(base('nope'), null)
  assert.equal(base(undefined), null)
})

test('已知互转：0 与 1', () => {
  for (const b of BASES) {
    assert.equal(format(0, b.id), '0', `0 -> ${b.id}`)
    assert.equal(format(1, b.id), '1', `1 -> ${b.id}`)
    assert.equal(parse('0', b.id), 0, `${b.id} -> 0`)
    assert.equal(parse('1', b.id), 1, `${b.id} -> 1`)
  }
})

test('已知互转：固定值表', () => {
  assert.equal(format(10, 'bin'), '1010')
  assert.equal(format(10, 'oct'), '12')
  assert.equal(format(10, 'dec'), '10')
  assert.equal(format(10, 'hex'), 'A')
  assert.equal(format(255, 'bin'), '11111111')
  assert.equal(format(255, 'oct'), '377')
  assert.equal(format(255, 'hex'), 'FF')
  assert.equal(format(65535, 'hex'), 'FFFF')
  assert.equal(format(65535, 'oct'), '177777')
  assert.equal(format(3405691582, 'hex'), 'CAFEBABE')
  assert.equal(format(4294967295, 'bin'), '1'.repeat(32))
  assert.equal(format(4294967295, 'oct'), '37777777777')
  assert.equal(format(4294967295, 'dec'), '4294967295')
  assert.equal(format(4294967295, 'hex'), 'FFFFFFFF')
})

test('parse 边界：非法字符与越界', () => {
  assert.equal(parse('', 'dec'), null)
  assert.equal(parse('2', 'bin'), null)
  assert.equal(parse('8', 'oct'), null)
  assert.equal(parse('A', 'dec'), null)
  assert.equal(parse('G', 'hex'), null)
  assert.equal(parse('ff', 'hex'), 255)
  assert.equal(parse('000ff', 'hex'), 255)
  assert.equal(parse('4294967296', 'dec'), null)
  assert.equal(parse('100000000', 'hex'), null) // 9 字符 > maxChars 8
  assert.equal(parse('40000000000', 'oct'), null) // 4×8^10 超过 MAX
  assert.equal(parse('1'.repeat(33), 'bin'), null)
  assert.equal(parse('0'.repeat(33), 'bin'), null)
  assert.equal(parse('0x10', 'hex'), null)
  assert.equal(parse('0b1', 'bin'), null)
  assert.equal(parse(42, 'dec'), null)
  assert.equal(parse(null, 'dec'), null)
  assert.equal(parse('10', 'nope'), null)
})

test('format：大写与拒绝', () => {
  assert.equal(format(255, 'hex'), 'FF')
  assert.equal(format(-1, 'dec'), null)
  assert.equal(format(4294967296, 'dec'), null)
  assert.equal(format(1.5, 'dec'), null)
  assert.equal(format(NaN, 'dec'), null)
  assert.equal(format(Infinity, 'dec'), null)
  assert.equal(format('42', 'dec'), null)
  assert.equal(format(42, 'nope'), null)
})

test('pushKey 过滤：各进制拒非法字符', () => {
  assert.deepEqual(pushKey('11', '2', 'bin'), { draft: '11', reason: 'char' })
  assert.deepEqual(pushKey('7', '8', 'oct'), { draft: '7', reason: 'char' })
  assert.deepEqual(pushKey('9', 'A', 'dec'), { draft: '9', reason: 'char' })
  assert.deepEqual(pushKey('F', 'G', 'hex'), { draft: 'F', reason: 'char' })
  assert.deepEqual(pushKey('F', 'g', 'hex'), { draft: 'F', reason: 'char' })
  assert.deepEqual(pushKey('1', ' ', 'dec'), { draft: '1', reason: 'char' })
  assert.deepEqual(pushKey('1', 'AB', 'dec'), { draft: '1', reason: 'char' })
  assert.deepEqual(pushKey('1', '', 'dec'), { draft: '1', reason: 'char' })
  assert.deepEqual(pushKey('1', '5', 'nope'), { draft: '1', reason: 'char' })
})

test('pushKey 过滤：sign 行 19 个字形四进制全拒', () => {
  assert.equal(SIGN_GLYPHS.length, 19)
  for (const b of BASES) {
    for (const ch of SIGN_GLYPHS) {
      const r = pushKey('50', ch, b.id)
      assert.equal(r.reason, 'char', `${b.id} 字形 ${ch} 应判为 char`)
      assert.equal(r.draft, '50', `${b.id} 字形 ${ch} 不应改动草稿`)
    }
  }
})

test('pushKey：hex 小写归一大写', () => {
  assert.deepEqual(pushKey('', 'a', 'hex'), { draft: 'A', reason: '' })
  assert.deepEqual(pushKey('FF', 'e', 'hex'), { draft: 'FFE', reason: '' })
})

test('pushKey 前导零归一', () => {
  assert.deepEqual(pushKey('0', '5', 'dec'), { draft: '5', reason: '' })
  assert.deepEqual(pushKey('0', '0', 'dec'), { draft: '0', reason: '' })
  assert.deepEqual(pushKey('', '0', 'dec'), { draft: '0', reason: '' })
  assert.deepEqual(pushKey('000', '7', 'dec'), { draft: '7', reason: '' })
  assert.deepEqual(pushKey('0', 'F', 'hex'), { draft: 'F', reason: '' })
})

test('pushKey 上限：dec 临界', () => {
  assert.deepEqual(pushKey('429496729', '5', 'dec'), { draft: '4294967295', reason: '' })
  assert.deepEqual(pushKey('4294967295', '6', 'dec'), { draft: '4294967295', reason: 'limit' })
  assert.deepEqual(pushKey('4294967295', '0', 'dec'), { draft: '4294967295', reason: 'limit' })
  // 长度未超但值超：10 位 dec 可到 9999999999
  assert.deepEqual(pushKey('500000000', '0', 'dec'), { draft: '500000000', reason: 'limit' })
})

test('pushKey 上限：oct 临界', () => {
  assert.deepEqual(pushKey('3777777777', '7', 'oct'), { draft: '37777777777', reason: '' })
  assert.deepEqual(pushKey('37777777777', '7', 'oct'), { draft: '37777777777', reason: 'limit' })
  // 11 位 oct 值超：4×8^10 > MAX
  assert.deepEqual(pushKey('4000000000', '0', 'oct'), { draft: '4000000000', reason: 'limit' })
})

test('pushKey 上限：bin / hex 临界', () => {
  assert.deepEqual(pushKey('1'.repeat(31), '1', 'bin'), { draft: '1'.repeat(32), reason: '' })
  assert.deepEqual(pushKey('1'.repeat(32), '1', 'bin'), { draft: '1'.repeat(32), reason: 'limit' })
  assert.deepEqual(pushKey('1'.repeat(32), '0', 'bin'), { draft: '1'.repeat(32), reason: 'limit' })
  assert.deepEqual(pushKey('FFFFFFF', 'F', 'hex'), { draft: 'FFFFFFFF', reason: '' })
  assert.deepEqual(pushKey('FFFFFFFF', 'F', 'hex'), { draft: 'FFFFFFFF', reason: 'limit' })
})

test('convertAll：四进制齐全且可过滤', () => {
  const rows = convertAll(255)
  assert.deepEqual(rows.map((r) => r.id), ['bin', 'oct', 'dec', 'hex'])
  assert.deepEqual(rows.map((r) => r.text), ['11111111', '377', '255', 'FF'])
  assert.equal(convertAll(4294967296)[2].text, null)
  assert.equal(rows.filter((r) => r.id !== 'dec').length, 3)
})

test('grouped：从右往左分组', () => {
  assert.equal(grouped('11111111', 'bin'), '1111 1111')
  assert.equal(grouped('FFFFFFFF', 'hex'), 'FFFF FFFF')
  assert.equal(grouped('4294967295', 'dec'), '4 294 967 295')
  assert.equal(grouped('37777777777', 'oct'), '37 777 777 777')
  assert.equal(grouped('7', 'dec'), '7')
  assert.equal(grouped('', 'dec'), '')
})

test('splitLines：满 32 位 bin 切两行', () => {
  assert.deepEqual(splitLines(format(MAX_VALUE, 'bin'), 'bin'), ['1111 1111 1111 1111', '1111 1111 1111 1111'])
  // ≤19 字符单行
  assert.deepEqual(splitLines('11111111', 'bin'), ['1111 1111', ''])
  assert.deepEqual(splitLines('FFFF FFFF'.replace(' ', ''), 'hex'), ['FFFF FFFF', ''])
  // 17 位 bin：5 组在中间空格处切分（ceil 取前 3 组），每组完整
  const [l1, l2] = splitLines('1'.repeat(17), 'bin')
  assert.equal(l1, '1 1111 1111')
  assert.equal(l2, '1111 1111')
  for (const line of [l1, l2]) {
    for (const g of line.split(' ')) assert.ok(g.length > 0, '不应有空组')
  }
})

test('draftLines：按 chunk 原样切分', () => {
  assert.deepEqual(draftLines('12345678', 3), ['123', '45678'])
  assert.deepEqual(draftLines('12', 5), ['12', ''])
  assert.deepEqual(draftLines('', 16), ['', ''])
})

test('往返回归：固定值 + 200 随机数四进制逐一', () => {
  const fixed = [0, 1, 2, 7, 8, 10, 255, 256, 65535, 65536, 1048576, 3405691582, 4294967295]
  let seed = 20261118
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const values = fixed.slice()
  for (let i = 0; i < 200; i++) values.push(Math.floor(rnd() * (MAX_VALUE + 1)))
  for (const v of values) {
    for (const b of BASES) {
      const s = format(v, b.id)
      assert.equal(parse(s, b.id), v, `${v} -> ${b.id} '${s}' 往返失败`)
    }
  }
})

test('随机按键 500 轮不变量', () => {
  const POOL = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F',
    'a', 'b', 'c', 'd', 'e', 'f', '-', '.', '~', ' ', 'AB', '']
  let seed = 42
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  let draft = ''
  let baseId = 'dec'
  for (let i = 0; i < 500; i++) {
    baseId = BASES[Math.floor(rnd() * BASES.length)].id
    const r = pushKey(draft, POOL[Math.floor(rnd() * POOL.length)], baseId)
    assert.ok(['', 'char', 'limit'].includes(r.reason), `第 ${i} 轮 reason 非法`)
    draft = r.draft
    const b = base(baseId)
    assert.ok(draft.length <= b.maxChars, `第 ${i} 轮超长: ${draft}`)
    if (r.reason === '') {
      assert.notEqual(parse(draft, baseId), null, `第 ${i} 轮接受但 parse 失败: ${draft}`)
    }
    assert.equal(draft, draft.toUpperCase(), `第 ${i} 轮含小写: ${draft}`)
    assert.ok(draft === '0' || draft.charAt(0) !== '0', `第 ${i} 轮前导零: ${draft}`)
  }
})

test('默认导出聚合', () => {
  assert.equal(typeof R.default.pushKey, 'function')
  assert.equal(typeof R.default.parse, 'function')
  assert.equal(R.default.MAX_VALUE, 4294967295)
  assert.equal(R.default.BASES.length, 4)
})

console.log('')
console.log(`${passed} passed, ${failed} failed`)
if (failed) {
  failures.forEach((f) => console.log(`${f.name}: ${f.error.stack}`))
  process.exitCode = 1
}
