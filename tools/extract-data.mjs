#!/usr/bin/env node
/**
 * extract-data —— 把 src/data/*.js 里的内联大数组导出为包内 .txt 资源
 *
 * 用法：
 *   node tools/extract-data.mjs quotes     # src/data/quotes.js  → src/common/data/quotes.txt
 *   node tools/extract-data.mjs history    # src/data/history.js → src/common/data/history/01.txt … 12.txt
 *
 * 为什么要外置（计划 L4-5）：
 *   页面首开不再「物化」整份数据（1000 条一言 / 366 天史载），
 *   JS bundle 随之变小；包体总量变化不大（txt 与 js 的压缩率接近）。
 *
 * 注意：包内资源必须用 .txt（老版本 Vela file API 会拒绝打包的 .json）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

function loadModule(file) {
  const src = fs.readFileSync(file, 'utf8')
  return import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'))
}

const which = process.argv[2]

if (which === 'quotes') {
  const mod = await loadModule(path.join(ROOT, 'src/data/quotes.js'))
  const quotes = mod.default
  const outDir = path.join(ROOT, 'src/common/data')
  fs.mkdirSync(outDir, { recursive: true })
  const text = quotes.map((q) => String(q).replace(/\r?\n/g, ' ')).join('\n') + '\n'
  fs.writeFileSync(path.join(outDir, 'quotes.txt'), text, 'utf8')
  console.log(`quotes.txt 写入 ${quotes.length} 条，${Buffer.byteLength(text)} 字节`)
} else if (which === 'history') {
  const mod = await loadModule(path.join(ROOT, 'src/data/history.js'))
  const history = mod.default
  const outDir = path.join(ROOT, 'src/common/data/history')
  fs.mkdirSync(outDir, { recursive: true })
  const buckets = Array.from({ length: 12 }, () => ({}))
  let count = 0
  for (const key of Object.keys(history.events || {})) {
    const item = history.events[key]
    if (!item || typeof item !== 'object') continue
    const mm = /^(\d{2})-(\d{2})$/.exec(key)
    if (!mm) continue
    buckets[parseInt(mm[1], 10) - 1][key] = item
    count++
  }
  buckets.forEach((bucket, i) => {
    const name = String(i + 1).padStart(2, '0') + '.txt'
    fs.writeFileSync(path.join(outDir, name), JSON.stringify(bucket), 'utf8')
  })
  // 小知识池单独一个文件
  fs.writeFileSync(path.join(outDir, 'tips.txt'), JSON.stringify(history.tips || []), 'utf8')
  console.log(`history/01.txt … 12.txt 写入 ${count} 条；tips.txt 写入 ${(history.tips || []).length} 条`)
} else {
  console.log('用法：node tools/extract-data.mjs [quotes|history]')
  process.exit(1)
}
