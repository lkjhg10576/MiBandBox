import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLrc, parseLrcBytes, decodeText, titleFromFileName } from '../src/lrc.js'

test('单个时间戳', () => {
  const r = parseLrc('[00:12.00]第一行\n[00:15.30]第二行')
  assert.equal(r.ok, true)
  assert.deepEqual(r.lines, ['第一行', '第二行'])
  assert.equal(r.format, 'line')
})

test('多个时间戳的同一行展开为多行', () => {
  const r = parseLrc('[00:01.00][00:05.00]重复的词')
  assert.deepEqual(r.lines, ['重复的词', '重复的词'])
  assert.equal(r.format, 'line')
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
  assert.equal(r.format, 'enhanced')
})

test('常规逐字歌词的行内时间标签被剥离', () => {
  const r = parseLrc(
    '[00:00.000]浮[00:00.105]舟[00:00.210] - [00:00.315]铁[00:00.421]痕[00:00.526]电[00:00.631]台[00:00.736]-[00:00.841]MSR/'
  )
  assert.equal(r.ok, true)
  assert.deepEqual(r.lines, ['浮舟 - 铁痕电台-MSR/'])
  assert.equal(r.format, 'word')
  assert.equal(r.hasTimestamp, true)
})

test('增强逐字歌词的逐字标签被剥离', () => {
  const r = parseLrc(
    '[00:00.000] <00:00.000>浮<00:00.105>舟<00:00.210> - <00:00.315>铁<00:00.421>痕<00:00.526>电<00:00.631>台<00:00.736>-<00:00.841>MSR/'
  )
  assert.deepEqual(r.lines, ['浮舟 - 铁痕电台-MSR/'])
  assert.equal(r.format, 'enhanced')
  assert.equal(r.hasTimestamp, true)
})

test('同一段歌词的逐行、逐字、增强逐字输出完全一致', () => {
  const word = parseLrc(
    '[00:01.157]词[00:01.262] [00:01.367]Lyricist：[00:01.472]生[00:01.577]生[00:01.682]'
  )
  const enhanced = parseLrc(
    '[00:01.157] <00:01.157>词<00:01.262> <00:01.367>Lyricist：<00:01.472>生<00:01.577>生<00:01.682>'
  )
  const line = parseLrc('[00:01.157]词 Lyricist：生生')
  assert.deepEqual(word.lines, ['词 Lyricist：生生'])
  assert.deepEqual(enhanced.lines, word.lines)
  assert.deepEqual(line.lines, word.lines)
  assert.equal(word.format, 'word')
  assert.equal(enhanced.format, 'enhanced')
  assert.equal(line.format, 'line')
})

test('逐字歌词保留英文单词之间的空格', () => {
  const r = parseLrc('[00:02.313]Sound [00:02.418]Growth [00:02.523]Studios[00:02.628]')
  assert.deepEqual(r.lines, ['Sound Growth Studios'])
})

test('逐字歌词末尾只有时间标签时不会丢行', () => {
  const r = parseLrc('[00:01.000]一[00:02.000]\n[00:03.000]二[00:04.000]')
  assert.deepEqual(r.lines, ['一', '二'])
})

test('增强逐字歌词无空格也能拼接', () => {
  const r = parseLrc('[00:01.000]<00:01.000>你<00:01.500>好<00:02.000>')
  assert.deepEqual(r.lines, ['你好'])
})

test('逐字与增强逐字标签可以混用', () => {
  const r = parseLrc('[00:01.000]你[00:01.200]<00:01.400>好<00:02.000>')
  assert.deepEqual(r.lines, ['你好'])
  assert.equal(r.format, 'enhanced')
})

test('非时间方括号原样保留', () => {
  const r = parseLrc('[00:01.00][Chorus] 一起唱\n[00:02.00][Verse 1] 第一段')
  assert.deepEqual(r.lines, ['[Chorus] 一起唱', '[Verse 1] 第一段'])
  assert.equal(r.format, 'line')
})

test('同一时间戳的多行参照歌词按文件顺序保留', () => {
  const r = parseLrc('[00:01.00]Hello\n[00:01.00]你好\n[00:02.00]World')
  assert.deepEqual(r.lines, ['Hello', '你好', 'World'])
})

test('只有时间标签没有文本的行被丢弃', () => {
  const r = parseLrc('[00:01.00]\n[00:02.00][00:02.50]')
  assert.equal(r.ok, false)
})

test('行首多个标签且行内仍有逐字标签时只输出一次', () => {
  const r = parseLrc('[00:01.00][00:01.10]Hello[00:02.00]')
  assert.deepEqual(r.lines, ['Hello'])
  assert.equal(r.format, 'word')
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
  assert.equal(r.format, 'plain')
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
