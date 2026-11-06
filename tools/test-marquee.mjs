#!/usr/bin/env node
/**
 * 跑马灯配置与文字宽度估算单测（零依赖）。
 * 运行：node tools/test-marquee.mjs
 *
 * 覆盖 src/utils/marqueeState.js：
 *   - 跨页状态读写（globalThis 上的独立 key）
 *   - 文字宽度估算（全角 / 西文 / 混合）
 *   - 内容块宽度 = 滚动周期，必须能装下正文且不小于最小宽度
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

// marqueeState.js 是纯 JS（无任何 @system.* 依赖），可直接作为 ESM 导入。
const M = (await import(pathToFileURL(path.join(root, 'src/utils/marqueeState.js')).href)).default

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

console.log('bandbox-marquee 跑马灯单测')

// ---------- 跨页状态 ----------
test('cfg 读写走 globalThis，读写同步', () => {
  M.cfg = { text: 'BandBox', size: 30, speed: 6, color: '#FFFFFF', bg: '#0D6EFF', mode: 'v' }
  assert.deepEqual(M.cfg.text, 'BandBox')
  assert.equal(M.cfg.mode, 'v')
})

test('cfg 未设置时返回 null，置 null 后也返回 null', () => {
  M.cfg = null
  assert.equal(M.cfg, null)
})

test('cfg 存在独立 key，不污染其他全局状态', () => {
  globalThis.__bandboxOtherProbe = 'keep'
  M.cfg = { text: 'x' }
  assert.equal(globalThis.__bandboxOtherProbe, 'keep')
  assert.equal(globalThis.__bandboxMarqueeCfg.text, 'x')
  delete globalThis.__bandboxOtherProbe
  M.cfg = null
})

// ---------- 宽度估算 ----------
test('全角文字按 1em 估算', () => {
  // 8 个汉字 @30px = 240px，再乘安全系数与加粗系数
  const w = M.estimateTextWidth('中文中文中文中文', 30)
  assert.ok(w >= 240, '全角估算应不小于 240px，实际 ' + w)
  assert.ok(w < 340, '全角估算明显偏大，实际 ' + w)
})

test('西文明显窄于同字数全角', () => {
  const cn = M.estimateTextWidth('中文中文中文中文', 30)
  const en = M.estimateTextWidth('abcdabcdabcd', 30)
  assert.ok(en < cn, '西文估算应窄于全角')
})

test('字号越大估算越宽', () => {
  const a = M.estimateTextWidth('BandBox 手环', 24)
  const b = M.estimateTextWidth('BandBox 手环', 38)
  assert.ok(b > a, '字号 38 应比 24 宽')
})

test('空文本估算为 0，不抛异常', () => {
  assert.equal(M.estimateTextWidth('', 30), 0)
  assert.equal(M.estimateTextWidth(null, 30), 0)
  assert.equal(M.estimateTextWidth(undefined, 30), 0)
})

// ---------- 内容块宽度（滚动周期） ----------
test('copyWidth 不小于最小宽度 240', () => {
  assert.ok(M.copyWidth('BandBox', 30) >= 240)
  assert.ok(M.copyWidth('', 30) >= 240)
})

test('copyWidth 随文字变长而变大', () => {
  const short = M.copyWidth('你好', 30)
  const long = M.copyWidth('这是一段很长的需要滚动显示的跑马灯文字内容测试', 30)
  assert.ok(long > short, '长文字的内容块应更宽')
})

test('copyWidth 至少能装下估算出的正文宽度（周期内不溢出）', () => {
  const samples = ['BandBox', 'BandBox · 手腕上的百宝箱', '这是一段很长的需要滚动显示的跑马灯文字内容测试', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '中英mix混合文字测试']
  for (const s of samples) {
    for (const size of [24, 30, 38]) {
      const w = M.copyWidth(s, size)
      const need = M.estimateTextWidth(s, size)
      assert.ok(w >= need, '内容块宽度 ' + w + ' 装不下正文 ' + need + '（' + s + ' @' + size + '）')
    }
  }
})

test('copyWidth 取 10 的整数倍，便于按像素步进', () => {
  for (const s of ['a', 'BandBox', '中文测试文字']) {
    assert.equal(M.copyWidth(s, 30) % 10, 0)
  }
})

test('copyWidth 在字号 <30 时按 30px 兜底（首帧默认字号）', () => {
  // 24px 与 30px 估算相同 → 内容块相同，首帧字号回落到 30px 也不会撑破
  assert.equal(M.copyWidth('BandBox', 24), M.copyWidth('BandBox', 30))
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
