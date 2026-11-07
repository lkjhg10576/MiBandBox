#!/usr/bin/env node
/**
 * release-gate —— 发行前静态门禁（0.4.1 起接入 make-release.sh / npm run gate）
 *
 * 规则都对应一次真实事故，不做风格检查。
 *
 *   R1 PNG 完整性            0.4.0 的 pnglib 漏了 IEND，47 张图是截断文件；手环开机解码
 *                            应用图标时拿不到 IEND，系统起不来，连续启动失败进 Recovery
 *   R2 perf 埋点必须关闭      0.4.0 带着 ENABLED=true 发版，启动路径持续写 1008 B 日志缓冲
 *   R3 启动路径不得有 FMP 打点 home.ux onReady 的 $element().getBoundingClientRect() 只在模拟器验过
 *   R4 禁止 data/private 共存  Vela 运行时直接抛错、页面黑屏（docs/perf-result.md §4.1）
 *   R5 路由与页面文件必须对齐   缺页 = 启动/跳转黑屏
 *   R6 版本号三处一致          manifest / package.json / README
 *
 * 用法：
 *   node tools/release-gate.mjs          # 检查，失败退出码 1
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const errors = []
const warnings = []

function fail(rule, file, msg) {
  errors.push({ rule, file, msg })
}
function warn(rule, file, msg) {
  warnings.push({ rule, file, msg })
}
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}
/** 去掉注释后再做模式匹配：说明性注释里出现被禁写法不算违规 */
function code(rel) {
  return read(rel)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}
function walk(dir, ext, out = []) {
  const abs = path.join(ROOT, dir)
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) walk(rel, ext, out)
    else if (e.name.endsWith(ext)) out.push(rel)
  }
  return out
}

// ---------- R1 PNG 完整性 ----------
{
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const table = (() => {
    const t = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c
    }
    return t
  })()
  const crc32 = (buf) => {
    let c = -1
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }

  const files = walk('src', '.png')
  if (!files.length) fail('R1', 'src', '没有找到任何 PNG')
  for (const f of files) {
    const buf = fs.readFileSync(path.join(ROOT, f))
    if (!buf.subarray(0, 8).equals(PNG_SIG)) {
      fail('R1', f, '不是 PNG（签名错误）')
      continue
    }
    const types = []
    let off = 8
    let broken = false
    while (off + 8 <= buf.length) {
      const len = buf.readUInt32BE(off)
      const type = buf.toString('ascii', off + 4, off + 8)
      if (off + 12 + len > buf.length) {
        fail('R1', f, `${type} chunk 超出文件末尾（文件被截断）`)
        broken = true
        break
      }
      if (crc32(buf.subarray(off + 4, off + 8 + len)) !== buf.readUInt32BE(off + 8 + len)) {
        fail('R1', f, `${type} chunk CRC 错误`)
        broken = true
        break
      }
      types.push(type)
      off += 12 + len
    }
    if (broken) continue
    if (types[0] !== 'IHDR') fail('R1', f, '首块不是 IHDR')
    if (types[types.length - 1] !== 'IEND') {
      fail('R1', f, `末块是 ${types[types.length - 1] || '(空)'}，缺少 IEND（0.4.0 事故原样）`)
      continue
    }
    const idat = types.indexOf('IDAT')
    const plte = types.indexOf('PLTE')
    const trns = types.indexOf('tRNS')
    if (idat < 0) fail('R1', f, '没有 IDAT')
    if (plte >= 0 && idat >= 0 && plte > idat) fail('R1', f, 'PLTE 出现在 IDAT 之后')
    if (trns >= 0 && idat >= 0 && trns > idat) fail('R1', f, 'tRNS 出现在 IDAT 之后')
  }
}

// ---------- R2 埋点开关 ----------
{
  const src = read('src/utils/perf.js')
  if (!/const\s+ENABLED\s*=\s*false/.test(src)) {
    fail('R2', 'src/utils/perf.js', 'ENABLED 不是 false：发行包不允许带性能埋点')
  }
  if (/utils\/perf/.test(read('src/app.ux'))) {
    fail('R2', 'src/app.ux', '启动路径（app.ux）不得 import 埋点模块')
  }
}

// ---------- R3 启动路径打点 ----------
{
  const src = code('src/pages/home/home.ux')
  if (/getBoundingClientRect/.test(src)) {
    fail('R3', 'src/pages/home/home.ux', 'home 里仍有 getBoundingClientRect 打点（真机未验证的测量 API）')
  }
  if (/\bonReady\s*\(/.test(src) && /perf\./.test(src)) {
    fail('R3', 'src/pages/home/home.ux', 'home 的 onReady 里仍有埋点')
  }
  for (const f of walk('src', '.ux')) {
    const t = code(f)
    if (/getBoundingClientRect/.test(t)) {
      warn('R3', f, '使用了 getBoundingClientRect，确认目标固件支持该节点类型')
    }
    if (/@keyframes/.test(t)) {
      warn('R3', f, '页面含 @keyframes：真机是软件渲染的满帧重绘，长亮页面注意发热')
    }
  }
}

// ---------- R4 data/private ----------
for (const f of walk('src', '.ux')) {
  const t = code(f)
  if (/\bdata\s*:\s*\{/.test(t) && /\bprivate\s*:\s*\{/.test(t)) {
    fail('R4', f, '页面对象同时含 data 与 private：Vela 运行时抛错、页面黑屏')
  }
}

// ---------- R5 路由对齐 ----------
{
  const manifest = JSON.parse(read('src/manifest.json'))
  const pages = manifest.router && manifest.router.pages
  if (!pages) fail('R5', 'src/manifest.json', '缺少 router.pages')
  else {
    for (const [route, def] of Object.entries(pages)) {
      const comp = def && def.component
      if (!comp) {
        fail('R5', route, '路由缺少 component')
        continue
      }
      const file = `src/${route}/${comp}.ux`
      if (!fs.existsSync(path.join(ROOT, file))) {
        fail('R5', route, `找不到页面文件 ${file}`)
      }
    }
    const entry = manifest.router.entry
    if (entry && !pages[entry]) fail('R5', 'src/manifest.json', `entry ${entry} 不在 router.pages 里`)
  }
}

// ---------- R6 版本一致 ----------
{
  const m = JSON.parse(read('src/manifest.json'))
  const p = JSON.parse(read('package.json'))
  if (m.versionName !== p.version) {
    fail('R6', 'package.json', `版本不一致：manifest ${m.versionName} / package.json ${p.version}`)
  }
  const readmePath = path.join(ROOT, 'README.md')
  const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : ''
  if (!readme.includes(m.versionName)) {
    warn('R6', 'README.md', `README 未提及当前版本 ${m.versionName}`)
  }
  if (!Number.isInteger(m.versionCode) || m.versionCode <= 0) {
    fail('R6', 'src/manifest.json', 'versionCode 非法')
  }
}

// ---------- 输出 ----------
console.log('release-gate：' + (errors.length ? `${errors.length} 个阻断项` : '通过') + `，${warnings.length} 个提醒`)
for (const w of warnings) console.log(`  ⚠ ${w.rule} ${w.file}\n     ${w.msg}`)
for (const e of errors) console.log(`  ✗ ${e.rule} ${e.file}\n     ${e.msg}`)
if (errors.length) process.exit(1)
