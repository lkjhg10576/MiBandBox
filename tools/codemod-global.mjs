#!/usr/bin/env node
/**
 * codemod-global —— 把页面里对公共工具模块的直接 import 改成走全局单例 shim
 *
 * 用法：
 *   node tools/codemod-global.mjs            # 改写（幂等）
 *   node tools/codemod-global.mjs --dry      # 只报告不改
 *
 * 改写规则（对应计划 L4-1 / L4-2）：
 *   import router from '../../utils/router'  →  import g from '../../utils/g'
 *   router.push(x)                           →  g.router.push(x)
 *
 * 只处理 src/pages/**.ux 与 src/components/**.ux；
 * src/utils/* 与 src/app.ux 不动（app.ux 通过 import './global' 挂全局单例）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')

// 要走全局单例的模块（顺序即替换顺序）
const MODULES = ['router', 'time', 'haptic', 'kv', 'fs', 'screen']

const dry = process.argv.includes('--dry')

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
    else if (p.endsWith('.ux')) out.push(p)
  }
  return out
}

const files = [...walk(path.join(SRC, 'pages')), ...walk(path.join(SRC, 'components'))]
const report = []

for (const file of files) {
  let text = fs.readFileSync(file, 'utf8')
  const original = text
  const imports = []
  const re = /^[ \t]*import\s+([A-Za-z0-9_$]+)\s+from\s+['"]([^'"]+)['"][ \t]*\r?\n/gm
  let m
  while ((m = re.exec(text))) {
    const local = m[1]
    const spec = m[2]
    const mm = new RegExp('/utils/(' + MODULES.join('|') + ')$').exec(spec)
    if (!mm) continue
    imports.push({ local, mod: mm[1], spec, full: m[0] })
  }
  if (!imports.length) continue

  // 计算 utils 目录的相对路径（用于 import g from '.../utils/g'）
  const anySpec = imports[0].spec
  const utilsDir = anySpec.slice(0, anySpec.lastIndexOf('/') + 1)

  // 删除这些 import 行
  for (const imp of imports) {
    text = text.replace(imp.full, '')
  }

  // 替换调用点：local. → g.mod.
  for (const imp of imports) {
    const re2 = new RegExp('\\b' + imp.local + '\\s*\\.', 'g')
    text = text.replace(re2, 'g.' + imp.mod + '.')
  }

  // 插入 g 的 import（放在 <script> 之后的第一条 import 位置）
  const gImport = `import g from '${utilsDir}g'\n`
  const scriptIdx = text.indexOf('<script>')
  if (scriptIdx < 0) {
    report.push({ file: path.relative(ROOT, file), note: '找不到 <script>，跳过' })
    continue
  }
  const afterScript = scriptIdx + '<script>'.length
  const rest = text.slice(afterScript)
  const m2 = /^\s*/.exec(rest)
  const insertAt = afterScript + (m2 ? m2[0].length : 0)
  text = text.slice(0, insertAt) + gImport + text.slice(insertAt)

  if (text !== original) {
    if (!dry) fs.writeFileSync(file, text)
    report.push({
      file: path.relative(ROOT, file),
      note: imports.map((i) => i.local + '→g.' + i.mod).join(', ')
    })
  }
}

report.forEach((r) => console.log(r.file + '  ' + r.note))
console.log('')
console.log((dry ? '（dry-run，未写文件）' : '已改写 ') + report.length + ' 个文件')
