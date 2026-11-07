#!/usr/bin/env node
/**
 * perf-fmp —— 解析 logcat 里的 [perf] 埋点，算首屏渲染完成时间 FMP
 *
 * 用法：
 *   .venv-emu/bin/python tools/emu.py logcat -n 4000 > /tmp/logcat.txt
 *   node tools/perf-fmp.mjs /tmp/logcat.txt
 *   node tools/perf-fmp.mjs            # 从 stdin 读
 *
 * 埋点位置见 docs/quantum-cascade-curie-plan.md 第 1 节 B 类：
 *   app.create → kv.ready → home.show → home.ready → home.layout(≈FMP) → home.events
 *
 * FMP = home.layout - app.create；连跑多次取中位数。
 */
import fs from 'node:fs'

const path = process.argv[2]
let text = ''
if (path && fs.existsSync(path)) {
  text = fs.readFileSync(path, 'utf8')
} else {
  try {
    text = fs.readFileSync(0, 'utf8')
  } catch (e) {
    text = ''
  }
}

const RE = /\[perf\]\s+([A-Za-z0-9_.:-]+)\s+t=(\d+)/g
const RE_SUM = /\[perf\]\s+SUMMARY\s+(.*)$/gm
const marks = []
const summaries = []
let m
while ((m = RE.exec(text))) marks.push({ name: m[1], t: parseInt(m[2], 10) })
while ((m = RE_SUM.exec(text))) {
  const obj = {}
  const parts = m[1].trim().split(/\s+/)
  parts.forEach((p) => {
    const kv = p.split('=')
    if (kv.length === 2 && /^\d+$/.test(kv[1])) obj[kv[0]] = parseInt(kv[1], 10)
  })
  if (Object.keys(obj).length) summaries.push(obj)
}

if (!marks.length && !summaries.length) {
  console.log('未找到 [perf] 埋点。请确认：')
  console.log('  1) src/utils/perf.js 的 ENABLED 为 true')
  console.log('  2) logcat 中包含 [perf] 行（adb logcat -d）')
  process.exit(0)
}

// 汇总行优先：设备端日志缓冲只有 1KB，逐条埋点容易被挤掉
const runs = summaries.length ? summaries.map((s) => Object.keys(s).map((k) => ({ name: k, t: s[k] }))) : []
if (!runs.length) {
  let cur = []
  for (const mk of marks) {
    if (mk.name === 'app.create' && cur.length) {
      runs.push(cur)
      cur = []
    }
    cur.push(mk)
  }
  if (cur.length) runs.push(cur)
}

function pick(run, name) {
  const hit = run.find((x) => x.name === name)
  return hit ? hit.t : null
}

function median(list) {
  if (!list.length) return 0
  const s = list.slice().sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

const fmps = []
console.log('# FMP 埋点解析')
console.log('')
console.log('| # | app.create | kv.ready | home.show | home.ready | home.layout | home.events | FMP(ms) |')
console.log('|---|---|---|---|---|---|---|---|')
runs.forEach((run, i) => {
  const a = pick(run, 'app.create')
  const kv = pick(run, 'kv.ready')
  const hs = pick(run, 'home.show')
  const hr = pick(run, 'home.ready')
  const hl = pick(run, 'home.layout')
  const he = pick(run, 'home.events')
  let fmp = null
  if (a !== null && hl !== null) {
    fmp = hl - a
    fmps.push(fmp)
  }
  const rel = (v) => (v === null || a === null ? '-' : v - a)
  console.log(
    `| ${i + 1} | ${a === null ? '-' : a} | ${rel(kv)} | ${rel(hs)} | ${rel(hr)} | ${rel(hl)} | ${rel(he)} | ${fmp === null ? '-' : fmp} |`
  )
})

console.log('')
if (fmps.length) {
  console.log(`- 运行次数：${fmps.length}`)
  console.log(`- FMP 中位数：**${median(fmps)} ms**（官方门槛 2000 ms）`)
  console.log(`- FMP 最小/最大：${Math.min(...fmps)} / ${Math.max(...fmps)} ms`)
  console.log(`- 判定：${median(fmps) <= 2000 ? '通过' : '未达标'}`)
} else {
  console.log('- 未取到完整的 app.create → home.layout 区间')
}
