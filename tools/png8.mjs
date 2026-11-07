#!/usr/bin/env node
/**
 * png8 —— PNG8 转换 + 尺寸重采样（零依赖，用 tools/pnglib.mjs）
 *
 * 用法：
 *   node tools/png8.mjs --scan                      # 只扫描：列出每张图的尺寸/色数/可省体积
 *   node tools/png8.mjs --convert src/common        # 转换目录下的所有 PNG（原地覆盖，带备份）
 *   node tools/png8.mjs --convert src/common --resize 28x28   # 同时把源图重采样到 28×28
 *   node tools/png8.mjs --convert src/common --max 256        # 最多保留多少色（调色板上限）
 *
 * 规则：
 *   - 唯一色 ≤ 256：转 colortype 3 + tRNS（无损，颜色一个不差）
 *   - 唯一色 > 256：中位切分量化到 256 色，逐张在报告里标出（可能有色带）
 *   - --resize NxN：先做盒式降采样再量化（重采样会引入混色，随后仍按上面的规则处理）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePNG, encodePNG, encodePNG8, uniqueColors, resizeBox, quantize } from './pnglib.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

function walk(dir, out = []) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (p.toLowerCase().endsWith('.png')) out.push(p)
  }
  return out
}

const argv = process.argv.slice(2)
const mode = argv.includes('--convert') ? 'convert' : 'scan'
const target = argv[argv.indexOf(mode === 'convert' ? '--convert' : '--scan') + 1] || 'src'
const absTarget = path.resolve(ROOT, target)
const resizeArg = argv.includes('--resize') ? argv[argv.indexOf('--resize') + 1] : null
const maxColors = argv.includes('--max') ? parseInt(argv[argv.indexOf('--max') + 1], 10) : 256
const noBackup = argv.includes('--no-backup')

let resizeTo = null
if (resizeArg) {
  const m = /^(\d+)x(\d+)$/.exec(resizeArg)
  if (!m) {
    console.error('--resize 需要 WxH 形式，例如 --resize 28x28')
    process.exit(1)
  }
  resizeTo = { w: parseInt(m[1], 10), h: parseInt(m[2], 10) }
}

const files = fs.statSync(absTarget).isDirectory() ? walk(absTarget) : [absTarget]
let totalBefore = 0
let totalAfter = 0
const rows = []

for (const f of files) {
  const buf = fs.readFileSync(f)
  totalBefore += buf.length
  let img
  try {
    img = decodePNG(buf)
  } catch (e) {
    rows.push({ file: path.relative(ROOT, f), before: buf.length, after: buf.length, note: '解码失败：' + e.message })
    continue
  }
  const colorsBefore = uniqueColors(img.pixels)
  let work = img
  let resized = false
  if (resizeTo && (img.width !== resizeTo.w || img.height !== resizeTo.h)) {
    work = resizeBox(img, resizeTo.w, resizeTo.h)
    resized = true
  }
  const colors = uniqueColors(work.pixels)
  const lossy = colors > maxColors
  const q = quantize(work, maxColors)
  const out = encodePNG8({ width: work.width, height: work.height, palette: q.palette, indices: q.indices })
  totalAfter += out.length
  rows.push({
    file: path.relative(ROOT, f),
    before: buf.length,
    after: out.length,
    size: `${work.width}x${work.height}`,
    colors: colorsBefore,
    quantized: lossy,
    resized
  })
}

rows.sort((a, b) => b.before - a.before)
console.log('| 文件 | 尺寸 | 原始色数 | 原始字节 | PNG8 字节 | 节省 | 备注 |')
console.log('|---|---|---|---|---|---|---|')
for (const r of rows) {
  const save = r.before ? Math.round(((r.before - r.after) / r.before) * 100) : 0
  const notes = []
  if (r.resized) notes.push('已重采样')
  if (r.quantized) notes.push('量化(可能有色带)')
  if (r.note) notes.push(r.note)
  console.log(`| ${r.file} | ${r.size || '-'} | ${r.colors || '-'} | ${r.before} | ${r.after} | ${save}% | ${notes.join(' / ')} |`)
}
console.log('')
console.log(`合计：${totalBefore} B → ${totalAfter} B（${totalBefore ? Math.round(((totalBefore - totalAfter) / totalBefore) * 100) : 0}%）`)

if (mode === 'convert') {
  for (const f of files) {
    const buf = fs.readFileSync(f)
    let img
    try {
      img = decodePNG(buf)
    } catch (e) {
      continue
    }
    let work = img
    if (resizeTo && (img.width !== resizeTo.w || img.height !== resizeTo.h)) {
      work = resizeBox(img, resizeTo.w, resizeTo.h)
    }
    const q = quantize(work, maxColors)
    const out = encodePNG8({ width: work.width, height: work.height, palette: q.palette, indices: q.indices })
    if (out.length >= buf.length && !(resizeTo && (img.width !== resizeTo.w || img.height !== resizeTo.h))) {
      continue // 没省体积就不动（除非要求重采样）
    }
    if (!noBackup && !fs.existsSync(f + '.orig')) fs.copyFileSync(f, f + '.orig')
    fs.writeFileSync(f, out)
  }
  console.log('已写回（备份为 *.png.orig，可用 --no-backup 关闭）')
}
