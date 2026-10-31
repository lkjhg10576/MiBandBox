#!/usr/bin/env node
/**
 * 生成 src/gbk-table.js。
 *
 * QuickJS 运行时没有 TextDecoder，插件的 LRC 解码需要自带 GBK 表。
 * 表用 Node 的 TextDecoder('gbk') 生成，保证与浏览器/WebView 的 WHATWG
 * GBK 解码结果一致（Node 只用于生成，插件运行时不需要它）。
 *
 * GBK 双字节区：lead 0x81-0xFE，trail 0x40-0xFE（跳过 0x7F），
 * 共 126 × 190 = 23940 项。索引公式见 src/lrc.js 的 decodeGbk()。
 *
 * 用法：node scripts/gen-gbk-table.mjs
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const out = path.join(root, 'src', 'gbk-table.js')

const decoder = new TextDecoder('gbk')
const chars = []

for (let lead = 0x81; lead <= 0xfe; lead++) {
  for (let trail = 0x40; trail <= 0xfe; trail++) {
    if (trail === 0x7f) continue
    let ch = decoder.decode(Uint8Array.of(lead, trail))
    if (ch.length !== 1) ch = '\ufffd'
    chars.push(ch)
  }
}

const table = chars.join('')
if (table.length !== 23940) {
  throw new Error('GBK 表长度异常：' + table.length)
}

let literal = JSON.stringify(table)
// JS 字符串里 U+2028/U+2029 在老引擎上会被当成换行，显式转义。
literal = literal.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

const content =
  '// 本文件由 scripts/gen-gbk-table.mjs 生成，请勿手工修改。\n' +
  '// GBK 双字节表：lead 0x81-0xFE × trail 0x40-0xFE（跳过 0x7F），共 23940 项。\n' +
  'export const GBK_TABLE = ' +
  literal +
  '\n'

writeFileSync(out, content, 'utf8')
console.log('[gbk] written', out, '(' + Buffer.byteLength(content) + ' bytes)')
