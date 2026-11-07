#!/usr/bin/env node
/**
 * gen-keyframes —— 生成荧光棒的 @keyframes（36 色循环）
 *
 * 用法：
 *   node tools/gen-keyframes.mjs           # 打印 @keyframes 片段
 *   node tools/gen-keyframes.mjs --write   # 写回 src/pages/fluorescence/play/play.ux 的标记区间
 *
 * 颜色取自 src/utils/fluoroPalette.js（与播放页共用同一份调色板），
 * 避免手写 36 帧错位。关键帧在 CSS 中的位置：第 i 色落在 i * (100/36)%。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PALETTE_FILE = path.join(ROOT, 'src/utils/fluoroPalette.js')
const TARGET = path.join(ROOT, 'src/pages/fluorescence/play/play.ux')
const START = '/* @keyframes fc:start'
const END = '/* @keyframes fc:end'

// src/utils/*.js 是 ESM 源文件（Vela 侧为 ESM），但仓库 package.json 未声明 type:module，
// 这里用 data: URL 动态导入，保证与播放页共用同一份调色板源码。
const src = fs.readFileSync(PALETTE_FILE, 'utf8')
const mod = await import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'))
const PALETTE = mod.PALETTE

if (!PALETTE || PALETTE.length !== 36) {
  console.error('调色板异常：期望 36 色，实际 ' + (PALETTE ? PALETTE.length : 'undefined'))
  process.exit(1)
}

const step = 100 / PALETTE.length
const lines = []
lines.push('@keyframes fc {')
PALETTE.forEach((color, i) => {
  // 时间点取整：Vela 运行时的关键帧时间必须是整数百分比（小数会让原生侧越界崩溃）
  const pct = Math.round(i * step)
  lines.push(`  ${pct}% { background-color: ${color}; }`)
})
// 末帧回到第一色，循环边界无跳变
lines.push(`  100% { background-color: ${PALETTE[0]}; }`)
lines.push('}')
const css = lines.join('\n')

if (process.argv.includes('--write')) {
  const text = fs.readFileSync(TARGET, 'utf8')
  const s = text.indexOf(START)
  const e = text.indexOf(END)
  if (s < 0 || e < 0 || e < s) {
    console.error('目标文件里找不到标记区间：' + START + ' / ' + END)
    process.exit(1)
  }
  // 标记区间 = START 行结束之后 → END 行开始之前
  const lineEnd = text.indexOf('\n', s)
  const out = text.slice(0, lineEnd + 1) + css + '\n' + text.slice(e)
  fs.writeFileSync(TARGET, out)
  console.log('已写入 ' + path.relative(ROOT, TARGET) + '（' + PALETTE.length + ' 帧）')
} else {
  console.log(css)
}
