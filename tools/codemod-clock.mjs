#!/usr/bin/env node
/**
 * codemod-clock —— 把各页面的 20s 时钟定时器换成全局单例订阅（计划 L4-3）
 *
 * 用法：
 *   node tools/codemod-clock.mjs           # 改写
 *   node tools/codemod-clock.mjs --dry     # 只报告
 *
 * 改写前：
 *     if (this.timer) clearInterval(this.timer)
 *     this.timer = setInterval(() => {
 *       this.clock = time.formatClock(new Date())
 *     }, 20000)
 *   onHide() { if (this.timer) clearInterval(this.timer); this.timer = null }
 *
 * 改写后：
 *     const page = this
 *     this._ck = (s) => { if (page.$valid) page.clock = s }
 *     g.clock.sub(this._ck)
 *   onHide() { if (this._ck) { g.clock.unsub(this._ck); this._ck = null } }
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')
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

// 匹配：<可选的 clear 行> + this.<var> = setInterval(() => { this.clock = X.formatClock(new Date()) }, 20000)
const RE_BLOCK =
  /([ \t]*)if \(this\.(\w+)\) clearInterval\(this\.\2\)\n[ \t]*this\.\2 = setInterval\(\(\) => \{\n[ \t]*this\.clock = ([\w.]+)\.formatClock\(new Date\(\)\)\n[ \t]*\}, 20000\)\n/
const RE_ONE =
  /([ \t]*)if \(this\.(\w+)\) clearInterval\(this\.\2\)\n[ \t]*this\.\2 = setInterval\(\(\) => this\.clock = ([\w.]+)\.formatClock\(new Date\(\)\), 20000\)\n/
const RE_ONE_NOCLEAR = /([ \t]*)this\.(\w+) = setInterval\(\(\) => this\.clock = ([\w.]+)\.formatClock\(new Date\(\)\), 20000\)\n/

const SUB = (indent) =>
  `${indent}const page = this\n` +
  `${indent}this._ck = (s) => { if (page.$valid) page.clock = s }\n` +
  `${indent}g.clock.sub(this._ck)\n`

const files = walk(SRC)
const report = []

for (const file of files) {
  let text = fs.readFileSync(file, 'utf8')
  if (!/setInterval/.test(text)) continue
  if (!/formatClock\(new Date\(\)\)/.test(text)) continue

  let m = text.match(RE_BLOCK) || text.match(RE_ONE) || text.match(RE_ONE_NOCLEAR)
  if (!m) {
    report.push({ file: path.relative(ROOT, file), note: '未匹配到标准时钟写法（需人工处理）' })
    continue
  }
  const indent = m[1]
  const varName = m[2]
  const before = text
  text = text.replace(m[0], SUB(indent))

  // onHide / onDestroy 里对该定时器的清理 → 换成退订
  const clearRe = new RegExp(
    '[ \\t]*if \\(this\\.' + varName + '\\) clearInterval\\(this\\.' + varName + '\\)\\n[ \\t]*this\\.' + varName + ' = null\\n',
    'g'
  )
  const unsub =
    `${indent}if (this._ck) { g.clock.unsub(this._ck); this._ck = null }\n`
  text = text.replace(clearRe, unsub)
  // 有些页面只写了 clearInterval，没有置 null
  const clearRe2 = new RegExp('[ \\t]*if \\(this\\.' + varName + '\\) clearInterval\\(this\\.' + varName + '\\)\\n', 'g')
  text = text.replace(clearRe2, unsub)

  // 声明 _ck
  if (!/this\._ck = /.test(text)) {
    report.push({ file: path.relative(ROOT, file), note: '未替换' })
    continue
  }
  if (!/^\s*_ck\s*:/m.test(text)) {
    if (/^\s{2}data\s*:/m.test(text)) {
      text = text.replace(/^(\s{2}data\s*:\s*\{\n)/m, '$1    _ck: null,\n')
    } else if (/^\s{2}private\s*:/m.test(text)) {
      text = text.replace(/^(\s{2}private\s*:\s*\{\n)/m, '$1    _ck: null,\n')
    }
  }

  if (text !== before) {
    if (!dry) fs.writeFileSync(file, text)
    report.push({ file: path.relative(ROOT, file), note: '时钟变量 ' + varName + ' → g.clock 订阅' })
  }
}

report.forEach((r) => console.log(r.file + '  ' + r.note))
console.log('')
console.log((dry ? '（dry-run）' : '已改写 ') + report.length + ' 个文件')
