#!/usr/bin/env node
/**
 * perf-audit —— BandBox 性能基线扫描器（只读，不改任何业务文件）
 *
 * 用法：
 *   node tools/perf-audit.mjs                 # 输出 Markdown 报告 + 与 docs/perf-baseline.md 的 delta
 *   node tools/perf-audit.mjs --write         # 把当前值写成 docs/perf-baseline.md
 *   node tools/perf-audit.mjs --json          # 输出机器可读 JSON
 *
 * 采集口径与 docs/quantum-cascade-curie-plan.md 第 1 节一致；
 * 本工具只读 src/ build/ dist/，不写入（除 --write 外）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePNG, uniqueColors } from './pnglib.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')
const BUILD = path.join(ROOT, 'build')
const DIST = path.join(ROOT, 'dist')
const BASELINE = path.join(ROOT, 'docs', 'perf-baseline.md')

/** 模块副本特征串：每个出现在 bundle 里就算一份副本 */
const FINGERPRINTS = {
  router: 'system.router',
  file: 'system.file',
  kv: 'internal://files/bandbox/store.json',
  sensor: 'system.sensor'
}

function walk(dir, filter, out = []) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, filter, out)
    else if (!filter || filter(p)) out.push(p)
  }
  return out
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/')
}

// ---------------------------------------------------------------- 包体 / bundle
function collectBundles() {
  const files = walk(BUILD, (p) => p.endsWith('.js'))
  const rows = files.map((p) => ({ file: rel(p), size: fs.statSync(p).size }))
  rows.sort((a, b) => b.size - a.size)
  const sizes = rows.map((r) => r.size).sort((a, b) => a - b)
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0
  return { rows, count: rows.length, total: rows.reduce((s, r) => s + r.size, 0), median, max: rows[0] || null }
}

function collectCopies(bundles) {
  const counts = {}
  const where = {}
  for (const key of Object.keys(FINGERPRINTS)) {
    const fp = FINGERPRINTS[key]
    const hits = []
    for (const r of bundles.rows) {
      const abs = path.join(ROOT, r.file)
      let text = ''
      try {
        text = fs.readFileSync(abs, 'utf8')
      } catch (e) {
        continue
      }
      if (text.indexOf(fp) >= 0) hits.push(r.file)
    }
    counts[key] = hits.length
    where[key] = hits
  }
  return { counts, where }
}

function collectRpk() {
  const rpks = walk(DIST, (p) => p.endsWith('.rpk'))
  if (!rpks.length) return null
  const newest = rpks.map((p) => ({ p, m: fs.statSync(p).mtimeMs })).sort((a, b) => b.m - a.m)[0]
  return { file: rel(newest.p), size: fs.statSync(newest.p).size }
}

// ---------------------------------------------------------------- 源码计数
/** 统计 setTimeout 的回调里带 router 跳转的调用点（按括号配平，避免跨方法误判） */
function countTimeoutRouter(text) {
  let count = 0
  let idx = 0
  while (true) {
    const i = text.indexOf('setTimeout(', idx)
    if (i < 0) break
    idx = i + 10
    let depth = 1
    let j = i + 10
    let arg = ''
    while (j < text.length && depth > 0) {
      const c = text[j]
      if (c === '(') depth++
      else if (c === ')') {
        depth--
        if (depth === 0) break
      }
      arg += c
      j++
    }
    // 只看第一个参数（回调体）
    const firstArg = arg.split(',')[0]
    if (/router\s*\.\s*(push|replace|back)/.test(firstArg)) count++
  }
  return count
}

function collectSource() {
  const uxFiles = walk(SRC, (p) => p.endsWith('.ux'))
  const jsFiles = walk(SRC, (p) => p.endsWith('.js'))
  let setIntervalCalls = 0
  let setTimeoutCalls = 0
  let setTimeoutJump = 0
  let clockPages = 0
  const clockPageFiles = []
  const leakPages = []

  for (const f of [...uxFiles, ...jsFiles]) {
    const text = fs.readFileSync(f, 'utf8')
    setIntervalCalls += (text.match(/[^.\w]setInterval\s*\(/g) || []).length
    setTimeoutCalls += (text.match(/[^.\w]setTimeout\s*\(/g) || []).length
    setTimeoutJump += countTimeoutRouter(text)

    const hasClock = /setInterval\s*\([\s\S]{0,200}?,\s*20000\s*\)/.test(text)
    if (hasClock) {
      clockPages++
      clockPageFiles.push(rel(f))
      const onHide = extractBlock(text, 'onHide')
      // 判定口径：onHide 未清时钟 = 页面隐藏后定时器仍在跑（onDestroy 才清不算）
      // 注：src/utils/clock.js 是全局单例时钟本身，不算「页面泄漏」
      if (rel(f) === 'src/utils/clock.js') continue
      if (!onHide || !hidesClearInterval(text, clockTimerVar(text))) leakPages.push(rel(f))
    }
  }

  return {
    uxPages: uxFiles.length,
    setIntervalCalls,
    setTimeoutCalls,
    setTimeoutJump,
    clockPages,
    clockPageFiles,
    leakPages
  }
}

/** 取 `onHide() { ... }` 的大括号块 */
function extractBlock(text, name) {
  const re = new RegExp(name + '\\s*\\(\\)\\s*\\{')
  const m = re.exec(text)
  if (!m) return null
  let i = m.index + m[0].length
  let depth = 1
  while (i < text.length && depth > 0) {
    const c = text[i]
    if (c === '{') depth++
    else if (c === '}') depth--
    i++
  }
  return text.slice(m.index + m[0].length, i - 1)
}

/**
 * onHide（含其直接调用的方法）里是否清掉了「时钟定时器」那个句柄。
 * 判定必须针对具体变量：业务定时器清了不算时钟清了。
 */
function hidesClearInterval(text, clockVar) {
  const target = clockVar ? 'this\\.' + clockVar + '\\b' : null
  const onHide = extractBlock(text, 'onHide')
  if (!onHide) return false
  const bodies = [onHide]
  const re = /this\.([A-Za-z0-9_]+)\s*\(/g
  let m
  while ((m = re.exec(onHide))) {
    const body = extractBlock(text, m[1])
    if (body) bodies.push(body)
  }
  for (const body of bodies) {
    if (target) {
      if (new RegExp('clearInterval\\s*\\(\\s*' + target).test(body)) return true
    } else if (/clearInterval/.test(body)) {
      return true
    }
  }
  return false
}

/** 找出 20s 时钟用的定时器变量名（如 this.clockTimer / this.timer） */
function clockTimerVar(text) {
  const m = /this\.([A-Za-z0-9_]+)\s*=\s*setInterval\s*\([\s\S]{0,200}?,\s*20000\s*\)/.exec(text)
  return m ? m[1] : null
}

// ---------------------------------------------------------------- PNG
function collectPng() {
  const files = walk(SRC, (p) => p.toLowerCase().endsWith('.png'))
  const refs = collectImageRefs()
  const rows = []
  let total = 0
  let rgba8 = 0
  let over256 = 0
  let palette8 = 0
  for (const f of files) {
    const buf = fs.readFileSync(f)
    const size = buf.length
    total += size
    let info = null
    try {
      const img = decodePNG(buf)
      const colors = uniqueColors(img.pixels)
      info = { width: img.width, height: img.height, colorType: img.colorType, bitDepth: img.bitDepth, colors }
      if (img.colorType === 6 && img.bitDepth === 8) rgba8++
      if (img.colorType === 3) palette8++
      if (colors > 256) over256++
    } catch (e) {
      info = { error: e.message }
    }
    const name = path.basename(f)
    const key = Object.keys(refs).find((k) => k.endsWith(name))
    const rendered = key ? refs[key] : null
    const ratio =
      rendered && rendered.w && rendered.h && info && info.width
        ? Math.max(info.width / rendered.w, info.height / rendered.h)
        : null
    rows.push({ file: rel(f), size, ...info, rendered, ratio })
  }
  rows.sort((a, b) => b.size - a.size)
  return { rows, count: files.length, total, rgba8, over256, palette8 }
}

/** 收集「图片文件 → 渲染尺寸」的近似映射（CSS 类宽高） */
function collectImageRefs() {
  const cssClasses = new Map()
  const cssFiles = walk(path.join(SRC, 'common', 'styles'), (p) => p.endsWith('.css'))
  const uxFiles = walk(SRC, (p) => p.endsWith('.ux'))
  const styleBlocks = []
  for (const f of cssFiles) styleBlocks.push(fs.readFileSync(f, 'utf8'))
  for (const f of uxFiles) {
    const text = fs.readFileSync(f, 'utf8')
    const m = /<style>([\s\S]*?)<\/style>/.exec(text)
    if (m) styleBlocks.push(m[1])
  }
  for (const block of styleBlocks) {
    const re = /\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g
    let m
    while ((m = re.exec(block))) {
      const cls = m[1]
      const body = m[2]
      const w = /width\s*:\s*(\d+(?:\.\d+)?)px/.exec(body)
      const h = /height\s*:\s*(\d+(?:\.\d+)?)px/.exec(body)
      if (!w && !h) continue
      const cur = cssClasses.get(cls) || {}
      cssClasses.set(cls, { w: w ? parseFloat(w[1]) : cur.w, h: h ? parseFloat(h[1]) : cur.h })
    }
  }
  const refs = {}
  for (const f of uxFiles) {
    const text = fs.readFileSync(f, 'utf8')
    const re = /<img\b[^>]*>/g
    let m
    while ((m = re.exec(text))) {
      const tag = m[0]
      const src = /src\s*=\s*"([^"]+)"/.exec(tag)
      if (!src) continue
      if (src[1].indexOf('{{') >= 0) continue // 变量拼接，忽略
      const cls = /class\s*=\s*"([^"]*)"/.exec(tag)
      const clsName = cls ? cls[1].trim().split(/\s+/)[0] : null
      const size = clsName ? cssClasses.get(clsName) : null
      if (!size) continue
      const cur = refs[src[1]]
      const w = Math.max(cur ? cur.w || 0 : 0, size.w || 0)
      const h = Math.max(cur ? cur.h || 0 : 0, size.h || 0)
      refs[src[1]] = { w, h }
    }
  }
  return refs
}

// ---------------------------------------------------------------- 首页规模
function collectHome() {
  const appsFile = path.join(SRC, 'data', 'apps.js')
  let cells = 0
  if (fs.existsSync(appsFile)) {
    const text = fs.readFileSync(appsFile, 'utf8')
    cells = (text.match(/\bid\s*:/g) || []).length + 1 // +1 = 设置磁贴
  }
  return { cells, gridNodes: cells, gridImages: cells, listNodes: cells * 2 + 1, listImages: cells }
}

// ---------------------------------------------------------------- kv 序列化次数
function collectKv() {
  const kvFile = path.join(SRC, 'utils', 'kv.js')
  if (!fs.existsSync(kvFile)) return { serializations: 0, readWindowMs: 0 }
  const text = fs.readFileSync(kvFile, 'utf8')
  const win = /READ_WINDOW_MS\s*=\s*(\d+)/.exec(text)
  // 统计代码里的序列化次数（去掉注释，避免把说明文字算进去）
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  return {
    serializations: (code.match(/JSON\.stringify/g) || []).length,
    readWindowMs: win ? Number(win[1]) : 0
  }
}

// ---------------------------------------------------------------- 违规检查
/**
 * 静态检查会直接让页面加载失败的写法。
 * Vela 运行时：页面对象里 data 与 private/public/protected 不能共存
 * （运行时会 throw，页面表现为黑屏）。
 */
function checkViolations() {
  const issues = []
  const uxFiles = walk(SRC, (p) => p.endsWith('.ux'))
  for (const f of uxFiles) {
    const text = fs.readFileSync(f, 'utf8')
    const hasData = /^\s{2}data\s*:/m.test(text)
    const hasPriv = /^\s{2}private\s*:/m.test(text)
    if (hasData && hasPriv) {
      issues.push({ file: rel(f), kind: 'data+private 共存', detail: 'Vela 运行时会在页面加载时抛错，页面黑屏' })
    }
  }
  return issues
}

// ---------------------------------------------------------------- 汇总
function audit() {
  const bundles = collectBundles()
  const copies = collectCopies(bundles)
  const source = collectSource()
  const png = collectPng()
  const home = collectHome()
  const kv = collectKv()
  const rpk = collectRpk()
  return {
    rpk,
    bundles: { count: bundles.count, total: bundles.total, median: bundles.median, max: bundles.max },
    copies: copies.counts,
    source: {
      uxPages: source.uxPages,
      setIntervalCalls: source.setIntervalCalls,
      setTimeoutCalls: source.setTimeoutCalls,
      setTimeoutJump: source.setTimeoutJump,
      clockPages: source.clockPages,
      leakPages: source.leakPages
    },
    png: { count: png.count, total: png.total, rgba8: png.rgba8, over256: png.over256, palette8: png.palette8 },
    home,
    kv,
    issues: checkViolations(),
    _detail: { bundles: bundles.rows, pngRows: png.rows, leakPages: source.leakPages, copyWhere: copies.where }
  }
}

function fmt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function buildReport(a) {
  const L = []
  L.push('# BandBox 性能审计报告')
  L.push('')
  L.push(`> 生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')} ｜ 扫描器：tools/perf-audit.mjs`)
  L.push('')
  L.push('## 包体')
  L.push('')
  L.push('| 指标 | 值 |')
  L.push('|---|---|')
  L.push(`| rpk 大小 | ${a.rpk ? fmt(a.rpk.size) + ' B（' + a.rpk.file + '）' : '未找到 dist/*.rpk'} |`)
  L.push(`| rpk 条目数 | ${a.rpk ? '见 tools/perf-audit --json' : '-'} |`)
  L.push(`| bundle 数量 | ${a.bundles.count} |`)
  L.push(`| bundle 原始总量 | ${fmt(a.bundles.total)} B |`)
  L.push(`| bundle 中位体积 | ${fmt(a.bundles.median)} B |`)
  L.push(`| 最大 bundle | ${a.bundles.max ? fmt(a.bundles.max.size) + ' B（' + a.bundles.max.file + '）' : '-'} |`)
  L.push('')
  L.push('## 模块副本（build/*.js 中含特征串的 bundle 数）')
  L.push('')
  L.push('| 模块 | 特征串 | 副本数 |')
  L.push('|---|---|---|')
  for (const k of Object.keys(FINGERPRINTS)) {
    L.push(`| ${k} | \`${FINGERPRINTS[k]}\` | ${a.copies[k]} |`)
  }
  L.push('')
  L.push('## 源码计数')
  L.push('')
  L.push('| 指标 | 值 |')
  L.push('|---|---|')
  L.push(`| .ux 页面数 | ${a.source.uxPages} |`)
  L.push(`| setInterval 调用点 | ${a.source.setIntervalCalls} |`)
  L.push(`| setTimeout 调用点 | ${a.source.setTimeoutCalls} |`)
  L.push(`| setTimeout→router 跳转 | ${a.source.setTimeoutJump} |`)
  L.push(`| 20s 时钟页数 | ${a.source.clockPages} |`)
  L.push(`| onHide/onDestroy 未清时钟页数 | ${a.source.leakPages.length} |`)
  L.push(`| kv JSON.stringify 次数 | ${a.kv.serializations} |`)
  L.push(`| kv 读盘合并窗口 | ${a.kv.readWindowMs} ms |`)
  L.push('')
  if (a.source.leakPages.length) {
    L.push('未清时钟页面：')
    a.source.leakPages.forEach((p) => L.push(`- \`${p}\``))
    L.push('')
  }
  L.push('## 首页规模')
  L.push('')
  L.push('| 指标 | 值 |')
  L.push('|---|---|')
  L.push(`| 磁贴数 | ${a.home.cells} |`)
  L.push(`| grid 常驻节点 | ${a.home.gridNodes} |`)
  L.push(`| grid 常驻图片 | ${a.home.gridImages} |`)
  L.push(`| list 常驻节点 | ${a.home.listNodes} |`)
  L.push(`| list 常驻图片 | ${a.home.listImages} |`)
  L.push('')
  L.push('## 图片')
  L.push('')
  L.push('| 指标 | 值 |')
  L.push('|---|---|')
  L.push(`| PNG 数量 | ${a.png.count} |`)
  L.push(`| PNG 原始总量 | ${fmt(a.png.total)} B |`)
  L.push(`| 其中 RGBA8 | ${a.png.rgba8} |`)
  L.push(`| 其中已是 PNG8 | ${a.png.palette8} |`)
  L.push(`| 唯一色 > 256（需量化） | ${a.png.over256} |`)
  L.push('')
  const overs = a._detail.pngRows.filter((r) => r.ratio && r.ratio > 1.2)
  L.push(`超采样（源尺寸/渲染尺寸 > 1.2）图片 ${overs.length} 张：`)
  L.push('')
  L.push('| 文件 | 源尺寸 | 渲染尺寸 | 比值 | 字节 |')
  L.push('|---|---|---|---|---|')
  overs.slice(0, 40).forEach((r) => {
    L.push(`| \`${r.file}\` | ${r.width}×${r.height} | ${r.rendered.w}×${r.rendered.h} | ${r.ratio.toFixed(2)} | ${fmt(r.size)} |`)
  })
  L.push('')
  L.push('## 静态违规检查')
  L.push('')
  if (!a.issues.length) {
    L.push('未发现 data/private 共存等致命写法。')
  } else {
    L.push('| 文件 | 问题 | 说明 |')
    L.push('|---|---|---|')
    a.issues.forEach((i) => L.push(`| \`${i.file}\` | ${i.kind} | ${i.detail} |`))
  }
  L.push('')
  L.push('## 最大的 12 个 bundle')
  L.push('')
  L.push('| bundle | 原始字节 |')
  L.push('|---|---|')
  a._detail.bundles.slice(0, 12).forEach((r) => L.push(`| \`${r.file}\` | ${fmt(r.size)} |`))
  L.push('')
  L.push('## 最大的 12 张图片')
  L.push('')
  L.push('| 文件 | 字节 | 尺寸 | 唯一色 |')
  L.push('|---|---|---|---|')
  a._detail.pngRows.slice(0, 12).forEach((r) => {
    L.push(`| \`${r.file}\` | ${fmt(r.size)} | ${r.width || '?'}×${r.height || '?'} | ${r.colors || '?'} |`)
  })
  L.push('')
  return L.join('\n')
}

function flatten(a) {
  return {
    rpkBytes: a.rpk ? a.rpk.size : 0,
    bundleCount: a.bundles.count,
    bundleTotalBytes: a.bundles.total,
    bundleMedianBytes: a.bundles.median,
    copiesRouter: a.copies.router,
    copiesFile: a.copies.file,
    copiesKv: a.copies.kv,
    copiesSensor: a.copies.sensor,
    setIntervalCalls: a.source.setIntervalCalls,
    clockPages: a.source.clockPages,
    leakPages: a.source.leakPages.length,
    setTimeoutJump: a.source.setTimeoutJump,
    pngCount: a.png.count,
    pngTotalBytes: a.png.total,
    pngRgba8: a.png.rgba8,
    pngPalette8: a.png.palette8,
    pngOver256: a.png.over256,
    kvSerializations: a.kv.serializations,
    kvReadWindowMs: a.kv.readWindowMs,
    homeCells: a.home.cells
  }
}

function parseBaseline(text) {
  const out = {}
  const re = /^\|\s*([^|]+?)\s*\|\s*([\d,]+)\s*\|/gm
  let m
  while ((m = re.exec(text))) {
    const key = m[1].trim()
    const val = parseInt(m[2].replace(/,/g, ''), 10)
    if (!isNaN(val)) out[key] = val
  }
  return out
}

const KEYMAP = {
  rpkBytes: 'rpk 大小(B)',
  bundleCount: 'bundle 数量',
  bundleTotalBytes: 'bundle 原始总量(B)',
  bundleMedianBytes: 'bundle 中位体积(B)',
  copiesRouter: '副本 router',
  copiesFile: '副本 file',
  copiesKv: '副本 kv',
  copiesSensor: '副本 sensor',
  setIntervalCalls: 'setInterval 调用点',
  clockPages: '20s 时钟页数',
  leakPages: '未清时钟页数',
  setTimeoutJump: 'setTimeout→router',
  pngCount: 'PNG 数量',
  pngTotalBytes: 'PNG 总量(B)',
  pngRgba8: 'PNG RGBA8',
  pngPalette8: 'PNG8 数量',
  pngOver256: 'PNG >256色',
  kvSerializations: 'kv 序列化次数',
  kvReadWindowMs: 'kv 读盘窗口(ms)',
  homeCells: '首页磁贴数'
}

const argv = process.argv.slice(2)
const a = audit()

if (argv.includes('--check')) {
  // 只跑静态违规检查（构建前置门禁）：data/private 共存等会让页面加载失败的写法
  if (a.issues.length) {
    console.error('静态检查未通过：')
    a.issues.forEach((i) => console.error(`  ${i.file} → ${i.kind}：${i.detail}`))
    process.exit(1)
  }
  console.log('静态检查通过')
  process.exit(0)
}

if (argv.includes('--json')) {
  console.log(JSON.stringify({ flat: flatten(a), detail: a._detail }, null, 2))
  process.exit(0)
}

if (argv.includes('--write')) {
  const flat = flatten(a)
  const L = []
  L.push('# BandBox 性能基线')
  L.push('')
  L.push(`> 由 \`node tools/perf-audit.mjs --write\` 生成于 ${new Date().toISOString().slice(0, 19).replace('T', ' ')}。`)
  L.push('> 每层改动后重跑审计脚本，delta 见工具输出。')
  L.push('')
  L.push('| 指标 | 值 |')
  L.push('|---|---|')
  for (const k of Object.keys(KEYMAP)) L.push(`| ${KEYMAP[k]} | ${fmt(flat[k])} |`)
  L.push('')
  fs.writeFileSync(BASELINE, L.join('\n'))
  console.log('已写入 ' + rel(BASELINE))
  process.exit(0)
}

console.log(buildReport(a))

if (fs.existsSync(BASELINE)) {
  const base = parseBaseline(fs.readFileSync(BASELINE, 'utf8'))
  const cur = flatten(a)
  const rows = []
  for (const k of Object.keys(KEYMAP)) {
    const b = base[KEYMAP[k]]
    if (b === undefined) continue
    const c = cur[k]
    const d = c - b
    rows.push(`| ${KEYMAP[k]} | ${fmt(b)} | ${fmt(c)} | ${d === 0 ? '—' : (d > 0 ? '+' : '') + fmt(d)} |`)
  }
  if (rows.length) {
    console.log('\n## 与 docs/perf-baseline.md 的 delta\n')
    console.log('| 指标 | 基线 | 当前 | 变化 |')
    console.log('|---|---|---|---|')
    rows.forEach((r) => console.log(r))
  }
}
