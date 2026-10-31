import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLrc, parseLrcBytes, decodeText, titleFromFileName } from '../src/lrc.js'

test('单个时间戳', () => {
  const r = parseLrc('[00:12.00]第一行\n[00:15.30]第二行')
  assert.equal(r.ok, true)
  assert.deepEqual(r.lines, ['第一行', '第二行'])
})

test('多个时间戳的同一行展开为多行', () => {
  const r = parseLrc('[00:01.00][00:05.00]重复的词')
  assert.deepEqual(r.lines, ['重复的词', '重复的词'])
})

test('[ti:] 作为标题，优先于文件名', () => {
  const r = parseLrc('[ti:起风了]\n[ar:买辣椒也用券]\n[00:01.00]歌词', 'song.lrc')
  assert.equal(r.title, '起风了')
  assert.deepEqual(r.lines, ['歌词'])
})

test('缺少 [ti:] 时用文件名', () => {
  const r = parseLrc('[00:01.00]歌词', 'my-song.lrc')
  assert.equal(r.title, 'my-song')
})

test('元数据标签全部丢弃', () => {
  const r = parseLrc('[ar:A]\n[al:B]\n[by:C]\n[length:03:20]\n[offset:+200]\n[00:01.00]歌词')
  assert.deepEqual(r.lines, ['歌词'])
  assert.equal(r.title, '')
})

test('[offset:] 不影响结果', () => {
  const withOffset = parseLrc('[offset:-500]\n[00:01.00]歌词')
  assert.deepEqual(withOffset.lines, ['歌词'])
})

test('增强 LRC 的逐字标签被去掉并拼接', () => {
  const r = parseLrc('[00:01.00]<00:01.00>你<00:01.50>好<00:02.00>呀')
  assert.deepEqual(r.lines, ['你好呀'])
})

test('空行被丢弃', () => {
  const r = parseLrc('[00:01.00]一\n\n\n[00:02.00]二\n   \n')
  assert.deepEqual(r.lines, ['一', '二'])
})

test('行内空格保留', () => {
  const r = parseLrc('[00:01.00]hello   world')
  assert.deepEqual(r.lines, ['hello   world'])
})

test('无时间轴的纯文本按行保留', () => {
  const r = parseLrc('第一行\n第二行\n第三行')
  assert.equal(r.ok, true)
  assert.deepEqual(r.lines, ['第一行', '第二行', '第三行'])
  assert.equal(r.hasTimestamp, false)
})

test('空文件返回失败', () => {
  const r = parseLrc('')
  assert.equal(r.ok, false)
  assert.match(r.reason, /没有可用的歌词行/)
})

test('只有时间轴没有文本时返回失败', () => {
  const r = parseLrc('[00:01.00]\n[00:02.00]')
  assert.equal(r.ok, false)
})

test('1000 行大文件', () => {
  const lines = []
  for (let i = 0; i < 1000; i++) {
    lines.push('[00:' + String(i % 60).padStart(2, '0') + '.' + String(i % 100).padStart(2, '0') + ']第' + i + '行')
  }
  const r = parseLrc(lines.join('\n'))
  assert.equal(r.ok, true)
  assert.equal(r.lines.length, 1000)
  assert.equal(r.lines[0], '第0行')
  assert.equal(r.lines[999], '第999行')
})

test('GBK 编码的 LRC 能正确解码', () => {
  // 「中文歌词」的 GBK 字节
  const gbk = new Uint8Array([
    0xd6, 0xd0, 0xce, 0xc4, 0xb8, 0xe8, 0xb4, 0xca
  ])
  const r = parseLrcBytes(gbk, 'x.lrc')
  assert.equal(r.ok, true)
  assert.deepEqual(r.lines, ['中文歌词'])
})

test('GBK 编码且带时间轴', () => {
  // "[00:01.00]中文歌词" 的 GBK 字节
  const gbk = new Uint8Array([
    0x5b, 0x30, 0x30, 0x3a, 0x30, 0x31, 0x2e, 0x30, 0x30, 0x5d,
    0xd6, 0xd0, 0xce, 0xc4, 0xb8, 0xe8, 0xb4, 0xca
  ])
  const r = parseLrcBytes(gbk, 'x.lrc')
  assert.equal(r.ok, true)
  assert.deepEqual(r.lines, ['中文歌词'])
})

test('UTF-8 BOM 被去掉', () => {
  const bytes = new Uint8Array([
    0xef, 0xbb, 0xbf,
    0x5b, 0x30, 0x30, 0x3a, 0x30, 0x31, 0x2e, 0x30, 0x30, 0x5d,
    0xe4, 0xb8, 0xad, 0xe6, 0x96, 0x87
  ])
  const r = parseLrcBytes(bytes, 'x.lrc')
  assert.deepEqual(r.lines, ['中文'])
})

test('CRLF 换行被正确处理', () => {
  const r = parseLrc('[00:01.00]一\r\n[00:02.00]二\r\n')
  assert.deepEqual(r.lines, ['一', '二'])
})

test('titleFromFileName 去掉扩展名', () => {
  assert.equal(titleFromFileName('a.lrc'), 'a')
  assert.equal(titleFromFileName('a.b.lrc'), 'a.b')
  assert.equal(titleFromFileName(''), '')
})

test('decodeText 对空输入返回空串', () => {
  assert.equal(decodeText(null), '')
  assert.equal(decodeText(new Uint8Array(0)), '')
})
