#!/usr/bin/env node
/**
 * 手环端协议单测（零依赖）。
 * 运行：node tools/test-protocol.mjs
 *
 * 覆盖 lyricsTransfer.js 的消息解析、字段校验、分片切分与重组、ACK/err 文案。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

// lyricsTransfer.js 是纯 JS（无任何 @system.* 依赖），可直接作为 ESM 导入。
const T = (await import(pathToFileURL(path.join(root, 'src/utils/lyricsTransfer.js')).href)).default

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

console.log('bandbox-lyrics 协议单测')

// ---------- 协议头 ----------
test('message() 带上 app/v/type', () => {
  const m = T.message('lyrics', { id: 'x1' })
  assert.equal(m.app, 'bandbox-lyrics')
  assert.equal(m.v, 1)
  assert.equal(m.type, 'lyrics')
  assert.equal(m.id, 'x1')
})

test('parse() 接受合法 JSON 字符串', () => {
  const r = T.parse(JSON.stringify(T.message('hello', { id: 'a' })))
  assert.equal(r.ok, true)
  assert.equal(r.msg.type, 'hello')
})

test('parse() 拒绝坏 JSON', () => {
  const r = T.parse('{not json')
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'bad-json')
})

test('parse() 拒绝非对象', () => {
  assert.equal(T.parse('123').reason, 'bad-json')
  assert.equal(T.parse('[1,2]').reason, 'bad-json')
  assert.equal(T.parse(null).reason, 'bad-json')
})

test('parse() 拒绝错误的 app 标识', () => {
  const r = T.parse(JSON.stringify({ app: 'other-app', v: 1, type: 'hello' }))
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'bad-app')
})

test('parse() 拒绝不识别的版本号', () => {
  const r = T.parse(JSON.stringify({ app: 'bandbox-lyrics', v: 99, type: 'hello' }))
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'version')
})

test('parse() 拒绝缺少 type 的消息', () => {
  const r = T.parse(JSON.stringify({ app: 'bandbox-lyrics', v: 1 }))
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'bad-type')
})

// ---------- 落盘文本组装 ----------
test('buildText() 首行标题 + 其余正文', () => {
  assert.equal(T.buildText('起风了', ['一', '二']), '起风了\n一\n二')
})

test('toLyricsPayload() 正常歌词', () => {
  const r = T.toLyricsPayload({ title: '歌', lines: ['a', 'b'] })
  assert.equal(r.ok, true)
  assert.equal(r.text, '歌\na\nb')
  assert.deepEqual(r.lines, ['a', 'b'])
})

test('toLyricsPayload() 拒绝空标题 / 空行', () => {
  assert.equal(T.toLyricsPayload({ title: '', lines: ['a'] }).reason, 'empty')
  assert.equal(T.toLyricsPayload({ title: 'x', lines: [] }).reason, 'empty')
  assert.equal(T.toLyricsPayload({ title: 'x' }).reason, 'empty')
})

// ---------- 分片切分 ----------
test('splitChunks() 短文本只有一片', () => {
  const { chunks, total } = T.splitChunks('a\nb\nc')
  assert.equal(total, 1)
  assert.equal(chunks[0], 'a\nb\nc')
})

test('splitChunks() 长文本按行切分且不丢行', () => {
  const lines = []
  for (let i = 0; i < 500; i++) lines.push('line-' + i + '-' + 'x'.repeat(30))
  const text = lines.join('\n')
  const { chunks, total } = T.splitChunks(text, 1024)
  assert.ok(total > 1, '应该被切成多片')
  for (const c of chunks) assert.ok(c.length <= 1024, '单片不应超过限制: ' + c.length)
  assert.equal(chunks.join('\n'), text, '重组后应与原文一致')
})

test('splitChunks() 单行超长时该行独占一片', () => {
  const long = 'y'.repeat(5000)
  const { chunks, total } = T.splitChunks(long, 1024)
  assert.equal(total, 1)
  assert.equal(chunks[0], long)
})

test('splitChunks() 空文本仍产生一片', () => {
  const { chunks, total } = T.splitChunks('')
  assert.equal(total, 1)
  assert.equal(chunks[0], '')
})

// ---------- 分片重组 ----------
test('acceptChunk() 顺序收齐后完成', () => {
  const s = T.createSession()
  const r1 = T.acceptChunk(s, { id: 'c1', seq: 0, total: 2, title: 'T', data: '第一片' })
  assert.equal(r1.ok, true)
  assert.equal(r1.done, false)
  assert.equal(r1.received, 1)
  const r2 = T.acceptChunk(s, { id: 'c1', seq: 1, total: 2, title: 'T', data: '第二片' })
  assert.equal(r2.ok, true)
  assert.equal(r2.done, true)
  assert.equal(r2.text, '第一片\n第二片')
  assert.equal(r2.title, 'T')
})

test('acceptChunk() 缺片报错 bad-seq', () => {
  const s = T.createSession()
  T.acceptChunk(s, { id: 'c1', seq: 0, total: 3, title: 'T', data: 'a' })
  const r = T.acceptChunk(s, { id: 'c1', seq: 2, total: 3, title: 'T', data: 'c' })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'bad-seq')
})

test('acceptChunk() 序号越界报错 bad-seq', () => {
  const s = T.createSession()
  assert.equal(T.acceptChunk(s, { id: 'x', seq: -1, total: 2 }).reason, 'bad-seq')
  assert.equal(T.acceptChunk(s, { id: 'x', seq: 5, total: 2 }).reason, 'bad-seq')
  assert.equal(T.acceptChunk(s, { id: 'x', seq: 0, total: 0 }).reason, 'bad-seq')
  assert.equal(T.acceptChunk(s, { id: 'x' }).reason, 'bad-seq')
})

test('acceptChunk() 新 id 会重置会话', () => {
  const s = T.createSession()
  T.acceptChunk(s, { id: 'c1', seq: 0, total: 2, title: 'T', data: 'a' })
  const r = T.acceptChunk(s, { id: 'c2', seq: 0, total: 1, title: 'U', data: 'z' })
  assert.equal(r.ok, true)
  assert.equal(r.done, true)
  assert.equal(r.text, 'z')
  assert.equal(r.title, 'U')
})

// ---------- 回执文案 ----------
test('ack() 文案', () => {
  const a = T.ack('id1', '起风了')
  assert.equal(a.type, 'ack')
  assert.equal(a.ok, true)
  assert.equal(a.name, '起风了')
  assert.equal(a.id, 'id1')
})

test('err() 文案', () => {
  const e = T.err('id1', 'not-armed')
  assert.equal(e.type, 'err')
  assert.equal(e.reason, 'not-armed')
  assert.equal(e.id, 'id1')
})

test('progress() 文案', () => {
  const p = T.progress('id1', 2, 5)
  assert.equal(p.type, 'progress')
  assert.equal(p.received, 2)
  assert.equal(p.total, 5)
})

test('ready() 文案', () => {
  const r = T.ready()
  assert.equal(r.type, 'ready')
  assert.equal(r.app, 'bandbox-lyrics')
  assert.equal(r.v, 1)
})

// ---------- 端到端：分片 -> 重组 -> 落盘文本 ----------
test('端到端：分片传输后可还原成落盘文本', () => {
  const lines = []
  for (let i = 0; i < 300; i++) lines.push('歌词第 ' + i + ' 行')
  const title = '测试歌曲'
  // 分片只承载正文，标题随 chunk 元数据单独传递
  const body = lines.join('\n')
  const { chunks, total } = T.splitChunks(body, 512)
  const s = T.createSession()
  let last = null
  for (let i = 0; i < chunks.length; i++) {
    last = T.acceptChunk(s, {
      id: 'e2e',
      seq: i,
      total,
      title,
      data: chunks[i]
    })
  }
  assert.equal(last.done, true)
  assert.equal(last.title, title)
  // 分片重组出的正文应与原文一致，拼上标题即为落盘内容
  assert.equal(last.text, body)
  assert.equal(T.buildText(title, last.text), T.buildText(title, lines))
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
