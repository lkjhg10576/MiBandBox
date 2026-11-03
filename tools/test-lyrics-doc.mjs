#!/usr/bin/env node
/**
 * 歌词文档解析单测（零依赖）。
 * 运行：node tools/test-lyrics-doc.mjs
 *
 * 覆盖 lyricsDoc.js 的标题识别规则：
 *   - 「首行标题 + 正文」的契约格式
 *   - 分片导入产出的「没有标题行」的文件（首行不能被吃掉）
 *   - 标题归一化后与文件名一致才算标题
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

// lyricsDoc.js 是纯 JS（无任何 @system.* 依赖），可直接作为 ESM 导入。
const D = (await import(pathToFileURL(path.join(root, 'src/utils/lyricsDoc.js')).href)).default

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

console.log('bandbox-lyrics 文档解析单测')

// ---------- 归一化 ----------
test('normalizeTitle() 去非法字符、折叠空白、截断 24 字', () => {
  assert.equal(D.normalizeTitle('a/b:c*d?e"f<g>h|i'), 'a b c d e f g h i')
  // 空白折叠成单个空格（与落盘文件名规则一致，不是直接删掉）
  assert.equal(D.normalizeTitle('  稻   香  '), '稻 香')
  assert.equal(D.normalizeTitle('x'.repeat(40)), 'x'.repeat(24))
  assert.equal(D.normalizeTitle(''), '')
  assert.equal(D.normalizeTitle(null), '')
  assert.equal(D.normalizeTitle(undefined), '')
})

test('normalizeTitle() 与旧版 docs.safeName 行为一致', () => {
  // 旧实现（docs.js 里被替换掉的那份），逐字对拍
  const legacy = (name) =>
    String(name || '')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 24)
  const samples = [
    '稻香',
    ' 稻 香 ',
    'a/b',
    'a\\b',
    'a:b*c?d"e<f>g|h',
    'x'.repeat(30),
    '',
    '   ',
    null,
    undefined,
    0,
    false
  ]
  for (const s of samples) {
    assert.equal(D.normalizeTitle(s), legacy(s), 'normalizeTitle 与旧实现不一致: ' + String(s))
  }
})

// ---------- 契约格式：首行标题 + 正文 ----------
test('首行与文件名一致 → 正确切分标题与正文', () => {
  const doc = D.parseLyricsDoc('稻香\n第一句\n第二句', '稻香')
  assert.equal(doc.ok, true)
  assert.equal(doc.title, '稻香')
  assert.equal(doc.body, '第一句\n第二句')
  assert.equal(doc.lineCount, 2)
})

test('标题被截断到 24 字 → 仍被识别为标题', () => {
  const long = '歌'.repeat(30)
  const fileName = long.slice(0, 24)
  const doc = D.parseLyricsDoc(fileName + '\n正文第一行', fileName)
  assert.equal(doc.ok, true)
  assert.equal(doc.title, fileName)
  assert.equal(doc.body, '正文第一行')
})

test('标题含多余空白 / 非法字符 → 归一化后仍被识别为标题', () => {
  // 文件名就是 safeName(标题) 的产物，所以比较要用归一化后的形式
  const doc = D.parseLyricsDoc('稻 / 香\n正文', '稻 香')
  assert.equal(doc.ok, true)
  assert.equal(doc.title, '稻 / 香')
  assert.equal(doc.body, '正文')

  // 首尾多余空白
  const doc2 = D.parseLyricsDoc('  稻香  \n正文', '稻香')
  assert.equal(doc2.ok, true)
  assert.equal(doc2.title, '  稻香  ')
  assert.equal(doc2.body, '正文')
})

// ---------- 分片导入：没有标题行 ----------
test('分片风格文件（无标题行）→ 首行属于正文，不被吃掉', () => {
  const doc = D.parseLyricsDoc('Hello First Lyric Line\nSecond line\nThird line', 'ChunkStyle')
  assert.equal(doc.ok, true)
  assert.equal(doc.title, 'ChunkStyle')
  assert.equal(doc.body, 'Hello First Lyric Line\nSecond line\nThird line')
  assert.equal(doc.body.split('\n')[0], 'Hello First Lyric Line')
})

test('分片风格文件 → 正文逐行与原始内容相等', () => {
  const lines = ['第一句', '第二句', '第三句']
  const doc = D.parseLyricsDoc(lines.join('\n'), '某首歌')
  assert.deepEqual(doc.body.split('\n'), lines)
  assert.equal(doc.title, '某首歌')
})

// ---------- 其它输入 ----------
test('单行文件 → 整行都是正文', () => {
  const doc = D.parseLyricsDoc('只有一行', '某首歌')
  assert.equal(doc.ok, true)
  assert.equal(doc.title, '某首歌')
  assert.equal(doc.body, '只有一行')
  assert.equal(doc.lineCount, 1)
})

test('空文件 → ok:false reason:empty', () => {
  const doc = D.parseLyricsDoc('', '某首歌')
  assert.equal(doc.ok, false)
  assert.equal(doc.reason, 'empty')
  assert.equal(doc.title, '某首歌')
  assert.equal(doc.body, '')
})

test('非字符串 → ok:false reason:empty', () => {
  assert.equal(D.parseLyricsDoc(null, '某首歌').reason, 'empty')
  assert.equal(D.parseLyricsDoc(undefined, '某首歌').reason, 'empty')
  assert.equal(D.parseLyricsDoc(123, '某首歌').reason, 'empty')
})

test('文件名与首行无关 → 首行保留在正文', () => {
  const doc = D.parseLyricsDoc('完全不同的标题\n正文第一行', '文件名')
  assert.equal(doc.ok, true)
  assert.equal(doc.title, '文件名')
  assert.equal(doc.body, '完全不同的标题\n正文第一行')
})

test('首行为空行 → 不当作标题，整篇都是正文', () => {
  const doc = D.parseLyricsDoc('\n正文第一行', '某首歌')
  assert.equal(doc.ok, true)
  assert.equal(doc.title, '某首歌')
  assert.equal(doc.body, '\n正文第一行')
})

test('只有标题没有正文 → 正文为空串（由调用方显示占位）', () => {
  const doc = D.parseLyricsDoc('稻香\n', '稻香')
  assert.equal(doc.ok, true)
  assert.equal(doc.title, '稻香')
  assert.equal(doc.body, '')
  assert.equal(doc.lineCount, 0)
})

test('文件名为空 → 不剥离首行', () => {
  const doc = D.parseLyricsDoc('\n第一行\n第二行', '')
  assert.equal(doc.ok, true)
  assert.equal(doc.body, '\n第一行\n第二行')
})

// ---------- 往返：分片传输 → 落盘 → 解析 ----------
test('端到端往返：分片重组 → buildText 落盘 → 解析，正文逐行不丢', async () => {
  const T = (await import(pathToFileURL(path.join(root, 'src/utils/lyricsTransfer.js')).href)).default
  const title = '稻香'
  const lines = ['对这个世界如果你有太多的抱怨', '跌倒了就不敢继续往前走', 'HELLO WORLD']
  const { chunks, total } = T.splitChunks(lines.join('\n'), 8)
  const session = T.createSession()
  let last = null
  for (let i = 0; i < chunks.length; i++) {
    last = T.acceptChunk(session, { id: 'e2e', seq: i, total, title, data: chunks[i] })
  }
  assert.equal(last.done, true)
  // 写入端拼上标题后落盘
  const onDisk = T.buildText(title, last.text)
  // 读取端解析
  const doc = D.parseLyricsDoc(onDisk, title)
  assert.equal(doc.title, title)
  assert.deepEqual(doc.body.split('\n'), lines)
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
