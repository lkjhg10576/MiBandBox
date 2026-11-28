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
 *   R7 模板事件不得撞 Node 全局  编译器对 globalThis 上的标识符不加 _vm_. 前缀，点击静默失效
 *   R8 profile 物化一致性        源码树物化状态必须 == BANDBOX_PROFILE（防 band10 包混入 pro 令牌值）
 *   R9 资源尺寸匹配 profile      shadow.png 等随 profile 变尺寸的资源，IHDR 必须等于 profile 要求
 *   R10 计算器几何常量与 CSS 自洽  内容高度（BASE_H/ADV_H）由几何常量累加，常量与 CSS 对不上就拦下构建
 *   R11 包名一致性              源码树必须是基线包名态（渠道包包名只在构建期物化）；包名要符合反向域名规范
 *   R12 发行证书                上架渠道包必须用自签发行证书，且证书 CN 与包名对齐（CN=localhost 是 debug 证书）
 *   R13 AstroBox 资源清单引用完整性  manifest_v2.json 里 item.icon / item.cover / item.preview[] /
 *                            downloads.*.file_name 指向的文件必须在仓库里真实存在。0.1.1 被平台打回
 *                            「icon指向文件不存在」：清单写着 media/icon_astrobox.png，实体文件却不在
 *                            仓库里（控制台移除图标后没同步回来）。另校验图标边长 ≤ 500px
 *                            （Creator Console 实测：864×864 被直接拒收）。
 *   R14 发行产物完整性          release/ 与 beta/ 下每个产物目录里的 rpk 必须是带签名块的正式包，
 *                            且 SHA256SUMS.txt 与磁盘文件对得上。0.1.1 的标准版包就是在签名之后
 *                            被二次改写（包根塞进 .abp 与 Pro 版 rpk），签名块被挤没 —— 手环拒装、
 *                            渠道判「不是 release 包」。这条规则保证下次构建前就能发现产物被动过。
 *   R15 页头命中区不得压住可点元素 页头整条可点返回后，页头右侧的「保存/完成/参考」正好落在
 *                            命中区里 —— 真机上点保存会被页头吞掉。Vela 渲染器丢弃 z-index，
 *                            层序只按文档顺序排，真机/模拟器判定顺序未必一致，只能靠「不重叠」保证。
 *   R16 工具分类表完备性      分类模式（首页「工具分类」开关）的成员真源是 src/data/cats.js。
 *                            新增工具漏挂分类 → 该工具在分类模式里没有入口，且分类模式默认关着，
 *                            运行期毫无症状。所以「成员并集 == 全部工具」必须是构建期硬约束。
 *                            （更详细的诊断脚本是本地工具 tools/test-cats.mjs）
 *   R17 滚动内容高自洽        Vela 的 <scroll> 必须显式给内容高，不给就按视口高裁：卡片被压扁、
 *                            文字挤成一团、整页滚不动；长文本超出视口的部分既滚不到也看不见
 *                            （2026-11-22 用户报的现象：设置项增多后整页挤在一起）。核对
 *                            ① 所有纵向 scroll 的直接子容器都有显式高度；② 卡片列表页的
 *                            几何常量与 CSS 一致、卡片数与模板一致；③ profile 的
 *                            layout.text 宽度令牌与 CSS 文本框宽度一致。已知未修的页面记在
 *                            R17_EXEMPT 表里（逐页收口，修好一页删一行）。
 *   R20 内存卫生              抑制 Vela 系统接口泄漏与每页驻留/回调累计：
 *                            (a) @system.file 只允许在 utils/fs.js、utils/kv.js；
 *                            (b) @system.interconnect 只允许在 utils/interconnect.js；
 *                            (c) 任何含 setInterval( 的文件必须含 clearInterval(；
 *                            (d) pages/lyrics/** 与 pages/notebook/** 禁止直接
 *                                g.fs.writeText/remove/rename（必须走 docs，保 rev 缓存）。
 *
 * 用法：
 *   node tools/release-gate.mjs          # 检查，失败退出码 1
 *
 * 构建期环境变量：
 *   BANDBOX_PROFILE  目标设备 profile（R8/R9 用）
 *   BANDBOX_PKG      本次构建的包名（渠道包构建期物化后的包名）
 *   BANDBOX_SIGN_DIR 本次构建用的签名证书目录（sign/ 或 sign/release/）
 *   BANDBOX_SIGN_CN  期望的证书 CN（渠道包用；给了就强制核对）
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
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

// ---------- R15 页头命中区不得压住可点元素（扫描逻辑，规则本体在文件下方） ----------
// 页头整条（PageHead.phHit，y0..74）是返回命中区，命中区一旦压住动作键，
// 真机上点「保存」会被页头吞掉。Vela 渲染器丢弃 z-index（层序只按文档顺序排），
// 真机与模拟器的点按判定顺序未必一致 —— 只能靠「不重叠」保证。
// 几何从 PageHead.ux 现读，基线态与 pro336 物化态都算得准。
const PAGEHEAD_FILE = 'src/components/PageHead.ux'

/** 解析 .ux 的 <style> 段 → { 类名: 声明 } */
function parseUxStyle(css) {
  const rules = {}
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  css = css.replace(/@import[^;]*;/g, '') // @import 会把后面的选择器吞掉
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const props = {}
    for (const decl of m[2].split(';')) {
      const i = decl.indexOf(':')
      if (i < 0) continue
      const k = decl.slice(0, i).trim()
      const v = decl.slice(i + 1).trim()
      if (k) props[k] = v
    }
    for (const s of m[1].split(',')) {
      const cls = s.trim().replace(/^\./, '')
      if (!cls || cls.includes(' ') || cls.includes('@')) continue
      rules[cls] = Object.assign(rules[cls] || {}, props)
    }
  }
  return rules
}

/** 解析 .ux 的 <template> 段 → 元素树（保留父子关系，用于累加绝对坐标） */
function parseUxTemplate(tpl) {
  const roots = []
  const stack = []
  // 先去掉注释：注释里出现 <text> / <switch> 这类字面量会把标签配对数打乱
  // （calculator.ux / colorcard.ux 的注释里都有），后面的元素树层级全错。
  tpl = tpl.replace(/<!--[\s\S]*?-->/g, '')
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^<>])*?)(\/?)>/g
  let m
  while ((m = re.exec(tpl))) {
    if (m[1] === '/') { stack.pop(); continue }
    const el = { tag: m[2], attrs: m[3] || '', children: [], parent: stack[stack.length - 1] || null }
    if (el.parent) el.parent.children.push(el)
    else roots.push(el)
    if (!m[4]) stack.push(el)
  }
  return roots
}

function uxAttr(attrs, name) {
  const re = new RegExp('(?:^|\\s)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*"([^"]*)"')
  const m = attrs.match(re)
  return m ? m[1] : null
}

function uxClasses(attrs) {
  const c = uxAttr(attrs, 'class')
  if (!c) return []
  return c.split(/\s+/)
    .map((s) => s.replace(/\{\{.*$/, '').trim())
    .filter((s) => s && !s.includes('{{') && !s.includes('}}'))
}

function uxNum(v) {
  if (v == null) return null
  const m = String(v).match(/-?\d+(\.\d+)?/)
  return m ? parseFloat(m[0]) : null
}

/** 元素的定位盒（只认 absolute / fixed 的） */
function uxBox(el, rules) {
  let box = null
  for (const c of uxClasses(el.attrs)) {
    const r = rules[c]
    if (!r) continue
    if (r.position !== undefined || r.top !== undefined || r.left !== undefined ||
        r.width !== undefined || r.height !== undefined) {
      box = Object.assign(box || {}, r)
    }
  }
  if (!box) return null
  if (box.position !== 'absolute' && box.position !== 'fixed') return null
  return { top: uxNum(box.top), left: uxNum(box.left), w: uxNum(box.width), h: uxNum(box.height) }
}

/** 沿祖先链累加出绝对坐标（祖先都是 absolute 容器） */
function uxAbsBox(el, rules) {
  const b = uxBox(el, rules)
  if (!b) return null
  let top = b.top || 0
  let left = b.left || 0
  for (let p = el.parent; p; p = p.parent) {
    const pb = uxBox(p, rules)
    if (pb) { top += pb.top || 0; left += pb.left || 0 }
  }
  const w = b.w == null ? 0 : b.w
  const h = b.h == null ? 0 : b.h
  return { top, left, right: left + w, bottom: top + h }
}

/** 扫出「被页头命中区压住的 @click 元素」；返回可读的问题清单 */
function scanHeaderOverlaps() {
  const problems = []
  let hit
  try {
    const raw = read(PAGEHEAD_FILE)
    const styleM = raw.match(/<style>([\s\S]*?)<\/style>/)
    if (!styleM) return [`${PAGEHEAD_FILE} 找不到 <style> 段`]
    const rules = parseUxStyle(styleM[1])
    const hitRule = rules.phHit
    const phRule = rules.ph || {}
    if (!hitRule) return [`${PAGEHEAD_FILE} 找不到 .phHit 规则`]
    const hLeft = (uxNum(hitRule.left) || 0) + (uxNum(phRule.left) || 0)
    const hTop = (uxNum(hitRule.top) || 0) + (uxNum(phRule.top) || 0)
    const hW = uxNum(hitRule.width) || 0
    const hH = uxNum(hitRule.height) || 0
    hit = { left: hLeft, top: hTop, right: hLeft + hW, bottom: hTop + hH }
  } catch (e) {
    return [`${PAGEHEAD_FILE} 读取失败：${e.message}`]
  }

  for (const rel of walk('src', '.ux')) {
    if (rel === PAGEHEAD_FILE) continue
    let raw
    try {
      raw = read(rel)
    } catch {
      continue
    }
    const tplM = raw.match(/<template>([\s\S]*?)<\/template>/)
    const styleM = raw.match(/<style>([\s\S]*?)<\/style>/)
    if (!tplM || !styleM) continue
    const tpl = tplM[1]
    if (!/<pagehead\b/.test(tpl)) continue
    // noback：命中区不触发返回（首页 / 手速测试 / 节拍测定），压住整屏点按区是有意的
    if (/<pagehead[^>]*\bnoback\b/.test(tpl)) continue
    const rules = parseUxStyle(styleM[1])
    const visit = (el) => {
      const click = uxAttr(el.attrs, '@click') || uxAttr(el.attrs, 'onclick')
      if (click) {
        const b = uxAbsBox(el, rules)
        if (b && b.top < hit.bottom && b.bottom > hit.top && b.right > hit.left && b.left < hit.right) {
          problems.push(
            `${rel}：<${el.tag} class="${uxClasses(el.attrs).join(' ')}" @click=${click}>` +
            ` 落在页头命中区内（x ${b.left}..${b.right}, y ${b.top}..${b.bottom}）—— 真机上点不到`
          )
        }
      }
      for (const c of el.children) visit(c)
    }
    for (const r of parseUxTemplate(tpl)) visit(r)
  }
  return problems
}

// 单独跑 R15（开发自查用）：node tools/release-gate.mjs --only-r15
if (process.argv.includes('--only-r15')) {
  const bad = scanHeaderOverlaps()
  if (bad.length) {
    console.log('R15 不通过：页头命中区压住了可点元素')
    for (const b of bad) console.log('  ✗ ' + b)
    process.exit(1)
  }
  console.log('R15 通过：页头命中区未压住任何可点元素')
  process.exit(0)
}

// ---------- R20 内存卫生（扫描逻辑，规则本体在文件下方） ----------
function scanMemoryHygiene() {
  const problems = []
  const files = walk('src', '.ux').concat(walk('src', '.js'))
  for (const rel of files) {
    const norm = rel.replace(/\\/g, '/')
    const src = code(rel)
    if (/@system\.file\b/.test(src) && norm !== 'src/utils/fs.js' && norm !== 'src/utils/kv.js') {
      problems.push({
        file: rel,
        msg: '禁止直接引入 @system.file（只允许出现在 src/utils/fs.js 与 src/utils/kv.js）'
      })
    }
    if (/@system\.interconnect\b/.test(src) && norm !== 'src/utils/interconnect.js') {
      problems.push({
        file: rel,
        msg: '禁止直接引入 @system.interconnect（只允许出现在 src/utils/interconnect.js）'
      })
    }
    if (/\bsetInterval\s*\(/.test(src) && !/\bclearInterval\s*\(/.test(src)) {
      problems.push({
        file: rel,
        msg: '使用了 setInterval( 但文件内未调用 clearInterval(（必须成对清理，防定时器泄漏）'
      })
    }
    if (
      (norm.startsWith('src/pages/lyrics/') || norm.startsWith('src/pages/notebook/')) &&
      /\bg\.fs\.(?:writeText|remove|rename)\b/.test(src)
    ) {
      problems.push({
        file: rel,
        msg: '歌词/笔记页面禁止直接调用 g.fs.writeText/remove/rename，必须统一走 docs.js（保 __bbDocsRev 缓存不陈旧）'
      })
    }
  }
  return problems
}

// 单独跑 R20（开发自查用）：node tools/release-gate.mjs --only-r20
if (process.argv.includes('--only-r20')) {
  const bad = scanMemoryHygiene()
  if (bad.length) {
    console.log('R20 不通过：内存卫生检查失败')
    for (const b of bad) console.log(`  ✗ ${b.file}: ${b.msg}`)
    process.exit(1)
  }
  console.log('R20 通过：内存卫生检查全部通过')
  process.exit(0)
}

// ---------- R21 页面小睡契约 ----------
const NAP_EXEMPT = new Set(['display', 'flashlight', 'fluorescence/play', 'textShow'])
function scanNapContract() {
  const problems = []
  for (const rel of walk('src/pages', '.ux')) {
    const src = read(rel)
    let route = rel
      .replace(/\\/g, '/')
      .replace(/^src\/pages\//, '')
      .replace(/\.ux$/, '')
    const segs = route.split('/')
    if (segs.length > 1 && segs[segs.length - 1] === segs[segs.length - 2]) {
      segs.pop()
      route = segs.join('/')
    }
    const tplStart = src.indexOf('<template>')
    const tplEnd = src.indexOf('</template>', tplStart)
    const tpl = tplStart >= 0 && tplEnd >= 0 ? src.slice(tplStart, tplEnd) : ''
    const cleaned = tpl.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length))
    const root = /<div\b[^>]*\bclass="page(?:\s[^"]*)?"[^>]*>/.exec(cleaned)
    if (!root) {
      problems.push({ file: rel, msg: '找不到根节点 <div class="page">（R21 需要根节点内部有 napWrap）' })
      continue
    }
    if (/if="\{\{\s*awake\s*\}\}"/.test(root[0])) {
      problems.push({ file: rel, msg: 'if="{{ awake }}" 不能放在页面根节点上（Vela 的 scene root 不能是 DomIfFragment）' })
    }
    if (!NAP_EXEMPT.has(route) && !/class="napWrap"[^>]*if="\{\{\s*awake\s*\}\}"/.test(cleaned)) {
      problems.push({ file: rel, msg: '根节点内部缺少 <div class="napWrap" if="{{ awake }}">（页面被覆盖时无法卸下 UI 树）' })
    }
    if (!/export\s+default\s+life\s*\(\s*\{/.test(src)) {
      problems.push({ file: rel, msg: '页面未用 life({...}) 包装导出，onShow/onHide 不会维护冷热状态' })
    }
    if (!/import\s+life\s+from\s+['"][^'"]*utils\/pageLife['"]/.test(src)) {
      problems.push({ file: rel, msg: '缺少 import life（路径应指向 utils/pageLife）' })
    }
    if (/\bshow="\{\{\s*awake\s*\}\}"/.test(src)) {
      problems.push({ file: rel, msg: 'awake 不能用 show（只隐藏不销毁，不释放 UI 树）' })
    }
  }
  return problems
}

// ---------- R22 导航胶囊/日志契约 ----------
function scanNavStoreContract() {
  const problems = []
  const routerSrc = read('src/utils/router.js')
  if (!/const\s+MAX_STACK\s*=\s*5\b/.test(routerSrc)) {
    problems.push({ file: 'src/utils/router.js', msg: 'MAX_STACK 必须是 5（页面栈上限 + 1 层溢出余量）' })
  }
  if (!/from\s+['"]\.\/navStore['"]/.test(routerSrc) || !/from\s+['"]\.\/pageLife['"]/.test(routerSrc)) {
    problems.push({ file: 'src/utils/router.js', msg: 'router.js 必须接入 navStore 与 pageLife' })
  }
  if (!/freezeCurrent\s*\(/.test(routerSrc) || !/thaw\s*\(/.test(routerSrc)) {
    problems.push({ file: 'src/utils/router.js', msg: 'router.js 未使用 freezeCurrent/thaw（溢出页不会被冻结/恢复）' })
  }
  if (!/preNap\s*\(/.test(routerSrc) || !/wakePrevious\s*\(/.test(routerSrc)) {
    problems.push({ file: 'src/utils/router.js', msg: 'router.js 未使用 preNap/wakePrevious（隐藏页的 awake 更新不生效，必须在离场前卸 UI）' })
  }
  if (!/markBackgrounded\s*\(/.test(read('src/app.ux'))) {
    problems.push({ file: 'src/app.ux', msg: 'app.ux 未在 onShow/onHide 标记导航日志的后台态' })
  }
  for (const rel of walk('src', '.ux').concat(walk('src', '.js'))) {
    const norm = rel.replace(/\\/g, '/')
    const src = code(rel)
    if (/from\s+['"][^'"]*navStore['"]/.test(src) && norm !== 'src/app.ux' && norm !== 'src/utils/router.js') {
      problems.push({ file: rel, msg: 'navStore 只允许 app.ux / router.js 引入；页面经 globalThis.__bbNav 访问（否则每页都打进 fs）' })
    }
    if (/internal:\/\/files\/bandbox\/nav/.test(src) && norm !== 'src/utils/navStore.js') {
      problems.push({ file: rel, msg: '导航日志路径只能出现在 src/utils/navStore.js' })
    }
  }
  if (/from\s+['"][^'"]*navStore['"]/.test(read('src/utils/pageLife.js'))) {
    problems.push({ file: 'src/utils/pageLife.js', msg: 'pageLife 不得直接 import navStore（会让每个页面 bundle 带入 fs）' })
  }
  return problems
}

if (process.argv.includes('--only-r21')) {
  const bad = scanNapContract()
  if (bad.length) {
    console.log('R21 不通过：页面小睡契约检查失败')
    for (const b of bad) console.log(`  ✗ ${b.file}: ${b.msg}`)
    process.exit(1)
  }
  console.log('R21 通过：页面小睡契约完整')
  process.exit(0)
}

if (process.argv.includes('--only-r22')) {
  const bad = scanNavStoreContract()
  if (bad.length) {
    console.log('R22 不通过：导航胶囊/日志契约检查失败')
    for (const b of bad) console.log(`  ✗ ${b.file}: ${b.msg}`)
    process.exit(1)
  }
  console.log('R22 通过：导航胶囊/日志契约完整')
  process.exit(0)
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
// 分发平台只认包内 manifest.json 的版本号（控制台不改已签名包的版本），
// 所以版本号必须处处一致：改了 manifest 忘了改关于页/设置页/README，
// 上架后 App 里显示的版本就会和平台登记的对不上。
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
  // 关于页 / 设置页：AGENTS.md 要求的四处同步，少一处就 fail
  const aboutPath = path.join(ROOT, 'src/pages/about/about.ux')
  if (fs.existsSync(aboutPath)) {
    const t = fs.readFileSync(aboutPath, 'utf8').match(/<text class="f ver">v([^<]*)<\/text>/)
    if (!t) fail('R6', 'src/pages/about/about.ux', '找不到版本号文本（<text class="f ver">v…</text>）')
    else if (t[1] !== m.versionName) {
      fail('R6', 'src/pages/about/about.ux', `关于页显示 v${t[1]}，manifest 是 ${m.versionName}`)
    }
  }
  const setPath = path.join(ROOT, 'src/pages/set/set.ux')
  if (fs.existsSync(setPath)) {
    const t = fs.readFileSync(setPath, 'utf8').match(/<text class="f cSub">版本 ([^<]*)<\/text>/)
    if (!t) fail('R6', 'src/pages/set/set.ux', '找不到版本号文本（<text class="f cSub">版本 …</text>）')
    else if (t[1] !== m.versionName) {
      fail('R6', 'src/pages/set/set.ux', `设置页显示 版本 ${t[1]}，manifest 是 ${m.versionName}`)
    }
  }
  // README 顶部的版本号与 versionCode 都要跟上
  const rm = readme.match(/<code>([^<]*)<\/code>（versionCode (\d+)）/)
  if (rm) {
    if (rm[1] !== m.versionName) {
      fail('R6', 'README.md', `README 显示版本 ${rm[1]}，manifest 是 ${m.versionName}`)
    }
    if (Number(rm[2]) !== m.versionCode) {
      fail('R6', 'README.md', `README 显示 versionCode ${rm[2]}，manifest 是 ${m.versionCode}`)
    }
  }
  // 手机插件与快应用共用同一条版本线（0.1.1 起）：插件侧四处也要一致
  const pluginManifestPath = path.join(ROOT, 'plugin/bandbox-helper/manifest.json')
  if (fs.existsSync(pluginManifestPath)) {
    const pm = JSON.parse(fs.readFileSync(pluginManifestPath, 'utf8'))
    const pp = path.join(ROOT, 'plugin/bandbox-helper/package.json')
    if (fs.existsSync(pp)) {
      const pj = JSON.parse(fs.readFileSync(pp, 'utf8'))
      if (pm.version !== pj.version) {
        fail('R6', 'plugin/bandbox-helper', `插件版本不一致：manifest ${pm.version} / package.json ${pj.version}`)
      }
    }
    const pjs = path.join(ROOT, 'plugin/bandbox-helper/src/plugin.js')
    if (fs.existsSync(pjs)) {
      const pv = fs.readFileSync(pjs, 'utf8').match(/PLUGIN_VERSION\s*=\s*'([^']*)'/)
      if (!pv) fail('R6', 'plugin/bandbox-helper/src/plugin.js', '找不到 PLUGIN_VERSION')
      else if (pv[1] !== pm.version) {
        fail('R6', 'plugin/bandbox-helper/src/plugin.js', `PLUGIN_VERSION 是 ${pv[1]}，manifest 是 ${pm.version}`)
      }
    }
  }
}

// ---------- R7 模板事件处理器不得撞 Node 全局 ----------
// num.ux 的 @click="setInterval(100)" 被 TemplateUtil.js:232 的 if (globalThis[name]) return
// 短路，编译产物不带 _vm_. 前缀 → 四个间隔芯片全是死的，且只有真机/模拟器能发现。
// 只扫事件根标识符：morseCode.ux 的 timers 字段撞全局但仅在脚本里用，扫 data 键会误报。
{
  const re = /@(?:click|tap|touchstart|touchend|touchmove|change|input|scroll|longpress|appear|disappear)\s*=\s*"([^"]+)"/g
  for (const f of walk('src', '.ux')) {
    const tpl = code(f).split('<template>')[1]
    if (!tpl) continue
    const body = tpl.split('</template>')[0]
    let m
    while ((m = re.exec(body))) {
      const id = m[1].match(/^([A-Za-z_$][\w$]*)/)
      if (id && globalThis[id[1]] !== undefined) {
        fail('R7', f, `模板事件 "${m[1]}" 的根标识符 ${id[1]} 是 Node 全局，编译器不加 _vm_. 前缀，点击无效`)
      }
    }
  }
}

// ---------- R8 profile 物化一致性 ----------
// band10 包里不得混入 pro336 令牌值（反之亦然）：源码树的物化状态必须与目标 profile 一致。
// 实际校验逻辑在 apply-profile.mjs（替换表自校验），这里按 BANDBOX_PROFILE 调它。
{
  const want = process.env.BANDBOX_PROFILE || 'band10'
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'apply-profile.mjs'), '--check', want], { encoding: 'utf8' })
  if (r.status !== 0) {
    fail('R8', 'profiles', `源码树 profile 状态 != ${want}（先执行 node tools/apply-profile.mjs ${want}）\n` + ((r.stdout || '') + (r.stderr || '')).trim())
  }
}

// ---------- R9 资源尺寸与 profile 匹配 ----------
// shadow.png 是唯一随 profile 变尺寸的资源：band10 212×84 / pro336 336×84。
{
  const want = process.env.BANDBOX_PROFILE || 'band10'
  const profFile = path.join(ROOT, 'profiles', want + '.json')
  if (fs.existsSync(profFile)) {
    const prof = JSON.parse(fs.readFileSync(profFile, 'utf8'))
    const [w, h] = (prof.assets && prof.assets.shadow) || []
    if (w && h) {
      const buf = fs.readFileSync(path.join(ROOT, 'src/common/shadow.png'))
      const iw = buf.readUInt32BE(16)
      const ih = buf.readUInt32BE(20)
      if (iw !== w || ih !== h) {
        fail('R9', 'src/common/shadow.png', `尺寸 ${iw}x${ih} != profile ${want} 要求的 ${w}x${h}（物化后又被手改？）`)
      }
    }
  }
}

// ---------- R10 计算器几何常量与 CSS 自洽 ----------
// 竖向滚动的内容高度（BASE_H / ADV_H）不是写死的总数，而是按 CSS 盒子逐段累加；
// 累加用的常量必须与 CSS 对得上。Pro 曾把 ADV_H 估成 408（实际 500），
// 三个开关只露出第二个、第三个点不到。改了 CSS 高度/宽度忘了改常量，这里拦下构建。
{
  const rel = 'src/pages/calculator/calculator.ux'
  if (fs.existsSync(path.join(ROOT, rel))) {
    const src = read(rel)
    /** 取某条 CSS 规则的声明体；.key 不会误命中 .keyVar（要求 class 名后紧跟空格+{） */
    const rule = (cls) => {
      const m = src.match(new RegExp('\\.' + cls + ' \\{([^}]*)\\}'))
      return m ? m[1] : null
    }
    const px = (body, prop) => {
      if (!body) return null
      const m = body.match(new RegExp(prop + ': (\\d+)px'))
      return m ? Number(m[1]) : null
    }
    const konst = (name) => {
      const m = src.match(new RegExp('const ' + name + ' = (\\d+)'))
      return m ? Number(m[1]) : null
    }
    const expect = (name, want, why) => {
      if (want === null) return
      const got = konst(name)
      if (got === null) fail('R10', rel, `找不到常量 ${name}（${why}）`)
      else if (got !== want) fail('R10', rel, `${name} = ${got}，应为 ${want}：${why}`)
    }
    const body = (cls) => {
      const b = rule(cls)
      if (!b) fail('R10', rel, `CSS 里找不到 .${cls} 规则`)
      return b
    }
    const key = body('key'), pad = body('pad'), exprArea = body('exprArea'),
      preview = body('preview'), secLabel = body('secLabel'), solveHint = body('solveHint'),
      swRow = body('swRow'), tail = body('tail'), noSol = body('noSol'),
      rLine = body('rLine'), resultCard = body('resultCard')

    // 一行几个键：.pad 宽 ÷ (.key 宽 + 左右 margin 2×2)
    const keyW = px(key, 'width'), keyH = px(key, 'height'), keyM = px(key, 'margin'), padW = px(pad, 'width')
    if (keyW !== null && keyM !== null && padW !== null) {
      expect('KEYS_PER_ROW', Math.floor(padW / (keyW + 2 * keyM)),
        `.pad ${padW}px ÷ (.key ${keyW}px + margin ${keyM}px×2)`)
    }
    expect('EXPR_H', px(exprArea, 'height'), '.exprArea 高')
    expect('PREVIEW_H', px(preview, 'height') === null || px(preview, 'margin') === null ? null : px(preview, 'height') + 2 * px(preview, 'margin'), '.preview 高 + 上下 margin')
    expect('KEY_ROW_H', keyH === null || keyM === null ? null : keyH + 2 * keyM, '.key 高 + 上下 margin')
    expect('SEC_H', px(secLabel, 'height'), '.secLabel 高')
    expect('HINT_H', px(solveHint, 'height'), '.solveHint 高')
    expect('SW_H', px(swRow, 'height') === null || px(swRow, 'margin') === null ? null : px(swRow, 'height') + 2 * px(swRow, 'margin'), '.swRow 高 + 上下 margin')
    expect('TAIL_H', px(tail, 'height'), '.tail 高')
    expect('NO_SOL_H', px(noSol, 'height') === null || px(noSol, 'margin') === null ? null : px(noSol, 'height') + px(noSol, 'margin'), '.noSol 高 + 上 margin')
    expect('R_LINE_H', px(rLine, 'height'), '.rLine 高')
    expect('CARD_H', px(resultCard, 'padding') === null || px(resultCard, 'margin') === null ? null : 2 * px(resultCard, 'padding') + px(resultCard, 'margin'), '.resultCard padding×2 + 上 margin')
    // 模板里实际渲染的段数
    const count = (re) => (src.match(re) || []).length
    expect('SEC_COUNT', count(/class="f secLabel"/g), '模板里的 .secLabel 个数')
    expect('SW_COUNT', count(/class="swRow"/g), '模板里的 .swRow 个数')
  }
}

// ---------- R11 包名规范 ----------
// 分发平台按反向域名（Java 包命名）规范判包名：全小写、点分段、每段字母开头。
// 包名真源是 src/manifest.json 的 package 字段。
{
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/manifest.json'), 'utf8'))
  const PKG_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
  if (!m.package) {
    fail('R11', 'src/manifest.json', '缺少 package 字段')
  } else if (!PKG_RE.test(m.package)) {
    fail('R11', 'src/manifest.json', `包名不符合反向域名规范（应形如 com.example.app）：${m.package}`)
  } else if (m.package.split('.').length < 3) {
    fail('R11', 'src/manifest.json', `包名段数不足 3 段：${m.package}`)
  }
}

// ---------- R12 发行证书 ----------
// 分发平台打回过一次「用了 AIoT 的 debug 证书签名，不是 release 包」：
// 工具链自带的默认证书 CN=localhost 就是 debug 证书（SignUtil 的 defaultDevelopment）。
// 发行包必须用自签发行证书，且证书 CN 与包名对齐。
//
// 另外官网「生成证书」要求证书 subject 带齐 7 项，缺一项就不构成合格的签名文件：
//   国家名称 C / 省份 ST / 城市 L / 组织名称 O / 组织单位名称 OU / 名称与姓氏 CN / 邮箱地址 emailAddress
// （2026-11-15 换源时只写了 C/O/CN 三项，重签补齐；这道门禁防止再退化）
{
  const dir = process.env.BANDBOX_SIGN_DIR
  if (!dir) {
    warn('R12', dir || 'sign/release', '未指定签名证书目录（BANDBOX_SIGN_DIR），跳过证书核对')
  } else {
    const certFile = path.join(ROOT, dir, 'certificate.pem')
    const keyFile = path.join(ROOT, dir, 'private.pem')
    if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
      fail('R12', dir, `签名证书缺失：需要 ${dir}/certificate.pem 与 ${dir}/private.pem`)
    } else {
      let cn = ''
      let subject = ''
      try {
        const cert = new crypto.X509Certificate(fs.readFileSync(certFile))
        subject = cert.subject.replace(/\n/g, ', ')
        const mm = /(?:^|,)\s*CN=([^,]+)/.exec(subject)
        cn = mm ? mm[1].trim() : ''
      } catch (e) {
        fail('R12', dir, '证书解析失败：' + e.message)
      }
      const manifestPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/manifest.json'), 'utf8')).package
      const wantCn = process.env.BANDBOX_SIGN_CN || manifestPkg
      if (!cn) {
        fail('R12', dir, '证书里读不出 CN，无法核对')
      } else if (cn === 'localhost') {
        fail('R12', dir, '证书是工具链自带的 debug 证书（CN=localhost），平台会打回；用 bash tools/gen-release-cert.sh 重新生成')
      } else if (cn !== wantCn) {
        fail('R12', dir, `证书 CN 是 ${cn}，期望 ${wantCn}（平台按包名核对证书）`)
      }
      // subject 7 项完整性：缺一项平台侧就不认这个签名文件
      const REQUIRED_DN = [
        ['C', '国家名称'], ['ST', '省份'], ['L', '城市'], ['O', '组织名称'],
        ['OU', '组织单位名称'], ['CN', '名称与姓氏'], ['emailAddress', '邮箱地址'],
      ]
      const missing = []
      for (const [key, label] of REQUIRED_DN) {
        const m = new RegExp('(?:^|,)\\s*' + key + '=([^,]+)').exec(subject)
        if (!m || !m[1].trim()) missing.push(`${label}(${key})`)
      }
      if (missing.length) {
        fail('R12', dir, `证书 subject 缺字段：${missing.join('、')} —— 官网要求 7 项齐全（国家/省份/城市/组织/组织单位/名称与姓氏/邮箱）；` +
          `用 bash tools/gen-release-cert.sh --force 重签补齐`)
      }
    }
  }
}

// ---------- R13 AstroBox 资源清单引用完整性 ----------
{
  const mf = path.join(ROOT, 'manifest_v2.json')
  if (!fs.existsSync(mf)) {
    warn('R13', 'manifest_v2.json', '仓库里没有 manifest_v2.json（AstroBox 资源清单）——若本次要提交分发平台，先跑 tools/astrobox-sync.mjs 生成')
  } else {
    let m = null
    try {
      m = JSON.parse(fs.readFileSync(mf, 'utf8'))
    } catch (e) {
      fail('R13', 'manifest_v2.json', 'JSON 解析失败：' + e.message)
    }
    if (m) {
      const item = m.item || {}
      const refs = []
      if (item.icon) refs.push(['item.icon', item.icon])
      if (item.cover) refs.push(['item.cover', item.cover])
      for (const [i, p] of (item.preview || []).entries()) refs.push([`item.preview[${i}]`, p])
      for (const [dev, d] of Object.entries(m.downloads || {})) {
        if (d && d.file_name) refs.push([`downloads.${dev}.file_name`, d.file_name])
      }
      if (!refs.length) {
        fail('R13', 'manifest_v2.json', '清单里没有任何资源引用（icon / cover / preview / downloads 全空）')
      }
      for (const [field, p] of refs) {
        const rel = String(p).replace(/^\.\//, '').replace(/^\/+/, '')
        const abs = path.join(ROOT, rel)
        if (!fs.existsSync(abs)) {
          fail('R13', 'manifest_v2.json', `${field} 指向 "${p}"，但仓库里没有这个文件 —— 平台会打回「icon指向文件不存在」；` +
            `补齐实体文件（图标：python3 promo/tools/gen_astrobox_icon.py）或改引用`)
          continue
        }
        // 图标规格：Creator Console 实测边长 ≤ 500px（曾用 864×864 被拒收）
        if (field === 'item.icon' && rel.toLowerCase().endsWith('.png')) {
          const buf = fs.readFileSync(abs)
          if (buf.length > 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
            const w = buf.readUInt32BE(16)
            const h = buf.readUInt32BE(20)
            if (w > 500 || h > 500) {
              fail('R13', rel, `图标 ${w}×${h} 超过 Creator Console 上限（边长需 ≤ 500px），控制台导入时会被直接拒收`)
            }
          }
        }
      }
    }
  }
}

// ---------- R15 页头命中区不得压住可点元素 ----------
// 页头整条可点返回（PageHead.phHit）之后，页头右侧的动作键（保存/完成/参考）正好落在
// 命中区里 —— 真机上点「保存」会被页头吞掉（变成返回，或点不到）。
// Vela 渲染器丢弃 z-index，层序只按文档顺序排，真机/模拟器判定顺序未必一致，
// 唯一稳的办法是「命中区不与任何可点元素重叠」。扫描逻辑见文件上方的 scanHeaderOverlaps()。
{
  const problems = scanHeaderOverlaps()
  for (const p of problems) fail('R15', PAGEHEAD_FILE, p)
}

// ---------- R16 工具分类表完备性 ----------
// 分类模式（首页「工具分类」开关）的成员关系真源是 src/data/cats.js。
// 新增工具若漏挂分类，它在分类模式里就完全没有入口 —— 而分类模式默认是关的，
// 运行期没有任何症状（首页网格照常列全部工具），只有用户打开分类模式才发现工具消失。
// 所以把「成员并集 == 全部工具」做成构建期硬约束。
// 另有一份更详细的诊断脚本 tools/test-cats.mjs（本地工具，tools/ 整目录不入库）。
{
  const appsRel = 'src/data/apps.js'
  const catsRel = 'src/data/cats.js'
  if (!fs.existsSync(path.join(ROOT, appsRel)) || !fs.existsSync(path.join(ROOT, catsRel))) {
    fail('R16', catsRel, '缺少 src/data/apps.js 或 src/data/cats.js')
  } else {
    const appsSrc = read(appsRel)
    const catsSrc = read(catsRel)

    // 全部工具 id（apps.js 每个条目一个 id）
    const appIds = []
    const idRe = /\bid:\s*'([^']+)'/g
    let m
    while ((m = idRe.exec(appsSrc))) appIds.push(m[1])

    // 分类成员表：CATS 里每个 tools: [...] 数组
    const groups = []
    const toolRe = /tools:\s*\[([^\]]*)\]/g
    while ((m = toolRe.exec(catsSrc))) {
      const ids = []
      const qRe = /'([^']+)'/g
      let q
      while ((q = qRe.exec(m[1]))) ids.push(q[1])
      groups.push(ids)
    }

    if (!groups.length) {
      fail('R16', catsRel, '解析不到任何分类成员表（tools: [...]）—— 分类表结构变了？')
    } else {
      const seen = {}
      const dup = []
      const unknown = []
      groups.forEach((ids) => {
        if (!ids.length) fail('R16', catsRel, '有分类没有成员')
        ids.forEach((tid) => {
          if (seen[tid]) dup.push(tid)
          else seen[tid] = true
          if (appIds.indexOf(tid) < 0) unknown.push(tid)
        })
      })
      const missing = appIds.filter((id) => !seen[id])
      if (dup.length) fail('R16', catsRel, `工具挂在多个分类里：${dup.join('、')}`)
      if (unknown.length) fail('R16', catsRel, `分类里挂着不存在的工具：${unknown.join('、')}`)
      if (missing.length) fail('R16', catsRel, `有工具没挂进任何分类（分类模式里会消失）：${missing.join('、')}`)
      // 分类图标必须真实存在（画错的路径在设备上是一张空白图）
      const iconRe = /\bicon:\s*'([^']+)'/g
      while ((m = iconRe.exec(catsSrc))) {
        const rel = m[1].replace(/^\/+/, '')
        if (!fs.existsSync(path.join(ROOT, 'src', rel))) {
          fail('R16', catsRel, `分类图标不存在：${m[1]}`)
        }
      }
    }
  }
}

// ---------- R17 <scroll> 内容容器必须显式给高 ----------
// Vela 的 <scroll> 不给子容器显式高度就按视口高裁内容：卡片被 flex 压扁（标题与副标题
// 挤成一团）、整页滚不动 —— 2026-11-22 用户在设置页报的现象；长文本（输入页预览、
// 摩斯电码）超出视口的部分更是既滚不到也看不见。
// 三条检查：
//   1) 所有纵向 scroll 的直接子容器都要有显式高度（CSS 类给 height，或 style 里给 height）；
//   2) 卡片列表页（设置页 / 功能设置页）的几何常量要与 CSS 对得上，卡片数要与模板一致；
//   3) profile 的 layout.text 宽度令牌要与 CSS 里的文本框宽度一致（文本高度估算靠它折行）。
{
  // 已知未修的页面（同一类缺陷，先记账、逐页收口；修好一页就删掉一行）。
  // 键 = 页面相对路径 + '|' + 内容容器的 class，长文本页与列表页都记在这儿。
  const R17_EXEMPT = {
    'src/pages/lyrics/edit/edit.ux|fBody': '歌词正文长文本：内容高待按字数估算（需按 profile 补文本框宽令牌）',
    'src/pages/lyrics/show/show.ux|lyric': '歌词正文长文本：内容高待按字数估算（需按 profile 补文本框宽令牌）',
    'src/pages/lyrics/show/show.ux|lyricLand': '横屏歌词正文长文本：同上',
    'src/pages/notebook/edit/edit.ux|fBody': '笔记正文长文本：内容高待按字数估算（需按 profile 补文本框宽令牌）',
    'src/pages/notebook/show/show.ux|content': '笔记正文长文本：同上',
    'src/pages/otp/settings/settings.ux|inner': '卡片高度随提示文案行数变化，内容高待收口',
  }
  // ---- 1) 全量扫描：每个纵向 scroll 的直接子容器都要有显式高度 ----
  for (const rel of walk('src', '.ux')) {
    const raw = read(rel)
    const tplM = raw.match(/<template>([\s\S]*?)<\/template>/)
    const styleM = raw.match(/<style>([\s\S]*?)<\/style>/)
    if (!tplM || !styleM) continue
    const rules = parseUxStyle(styleM[1])
    const visit = (el) => {
      if (el.tag === 'scroll') {
        const attrs = el.attrs || ''
        // 纵向 = scroll-y（横向跑马灯 scroll-x 的内容高度由文字行数决定，不需要显式高）
        const isY = /scroll-y="true"/.test(attrs)
        const isX = /scroll-x="true"/.test(attrs)
        if (isY && !isX) {
          for (const c of el.children) {
            const cls = uxClasses(c.attrs)
            // 键取最后一个 class（最具体那个：class="f fBody" → fBody）
            if (R17_EXEMPT[rel + '|' + cls[cls.length - 1]]) continue
            // style 里显式给了 height？（按声明拆开看，避免把 border-bottom-height 之类的当 height）
            const sm = /style="([^"]*)"/.exec(c.attrs || '')
            const inlineH = sm ? /(^|;)\s*height\s*:/.test(sm[1]) : false
            const clsH = cls.some((k) => rules[k] && rules[k].height !== undefined)
            if (!inlineH && !clsH) {
              fail('R17', rel,
                `<scroll> 的内容容器 <${c.tag} class="${uxClasses(c.attrs).join(' ')}"> 没有显式高度：` +
                'Vela 的 scroll 会按视口高裁内容 —— 卡片被压扁、长文本滚不到也看不见')
            }
          }
        }
      }
      for (const c of el.children) visit(c)
    }
    for (const r of parseUxTemplate(tplM[1])) visit(r)
  }

  // ---- 2) 卡片列表页：几何常量与 CSS 自洽、卡片数与模板一致 ----
  const CARD_PAGES = [
    { rel: 'src/pages/set/set.ux', info: null },
    { rel: 'src/pages/toolact/toolact.ux', info: 'infoCard' },
    { rel: 'src/pages/daysmatter/edit/edit.ux', info: null },
  ]
  for (const page of CARD_PAGES) {
    if (!fs.existsSync(path.join(ROOT, page.rel))) continue
    const rel = page.rel
    const src = read(rel)
    /** 取某条 CSS 规则的声明体（要求 class 名后紧跟空格+{，避免 .cardXxx 误命中） */
    const rule = (cls) => {
      const m = src.match(new RegExp('\\.' + cls + ' \\{([^}]*)\\}'))
      return m ? m[1] : null
    }
    const px = (body, prop) => {
      if (!body) return null
      const m = body.match(new RegExp(prop + ': (\\d+)px'))
      return m ? Number(m[1]) : null
    }
    const konst = (name) => {
      const m = src.match(new RegExp('const ' + name + ' = (\\d+)'))
      return m ? Number(m[1]) : null
    }
    const expect = (name, want, why) => {
      if (want === null) return
      const got = konst(name)
      if (got === null) fail('R17', rel, `找不到常量 ${name}（${why}）`)
      else if (got !== want) fail('R17', rel, `${name} = ${got}，应为 ${want}：${why}`)
    }
    // margin 简写「0px 3px 8px 3px」：下外边距是第 3 个值
    const marginBottom = (body) => {
      if (!body) return null
      const m = body.match(/margin: ([\d.]+)px ([\d.]+)px ([\d.]+)px ([\d.]+)px/)
      return m ? Number(m[3]) : null
    }
    const card = rule('card')
    const pad = rule('pad')
    if (!card) fail('R17', rel, 'CSS 里找不到 .card 规则')
    if (!pad) fail('R17', rel, 'CSS 里找不到 .pad 规则')
    expect('CARD_H', px(card, 'height'), '.card 高')
    expect('CARD_GAP', marginBottom(card), '.card 下外边距')
    expect('PAD_H', px(pad, 'height'), '.pad 高')
    if (page.info) {
      const info = rule(page.info)
      if (!info) fail('R17', rel, `CSS 里找不到 .${page.info} 规则`)
      expect('INFO_H', px(info, 'height'), `.${page.info} 高`)
      expect('INFO_GAP', marginBottom(info), `.${page.info} 下外边距`)
    }
    // 模板里 .card 的个数（新增设置项要改 CARD_COUNT）
    const tpl = (src.match(/<template>([\s\S]*?)<\/template>/) || ['', ''])[1]
    const count = (tpl.match(/class="card"/g) || []).length
    expect('CARD_COUNT', count, '模板里的 .card 个数')
    // 滚动内容容器必须显式给高
    if (!/class="inner"[^>]*style="[^"]*height:/.test(tpl)) {
      fail('R17', rel, '滚动内容容器 .inner 没有显式高度（style="height: …px"）：' +
        'Vela 的 scroll 会按视口高裁内容，卡片被压扁且整页滚不动')
    }
    // 内容高必须由卡片数算出来（不然加卡片时高度不会跟着长）
    const expr = (src.match(/const INNER_H = ([^\n]+)/) || [])[1]
    if (!expr) fail('R17', rel, '找不到 const INNER_H（滚动内容高）')
    else if (!/CARD_COUNT/.test(expr) || !/PAD_H/.test(expr)) {
      fail('R17', rel, `INNER_H 的算式没用上 CARD_COUNT / PAD_H：${expr.trim()}`)
    }
    if (!/innerH:\s*INNER_H/.test(src)) {
      fail('R17', rel, 'data 里没有 innerH: INNER_H（内容高没绑到 .inner 上）')
    }
    // .card 必须 flex-shrink:0：常量与 CSS 对不上时宁可裁掉尾巴也不压扁文字
    if (!/flex-shrink:\s*0/.test(card || '')) {
      fail('R17', rel, '.card 缺 flex-shrink:0：内容高与 CSS 对不上时卡片会被压扁')
    }
  }

  // ---- 3) profile 的 layout.text 宽度令牌必须与 CSS 里的文本框宽度一致 ----
  // 文本高度估算（src/utils/textMetrics.js）按这个宽度折行，宽度对不上就会低估行数、
  // 把文字底部裁掉。
  {
    const want = process.env.BANDBOX_PROFILE || 'band10'
    const profFile = path.join(ROOT, 'profiles', want + '.json')
    if (fs.existsSync(profFile)) {
      const prof = JSON.parse(fs.readFileSync(profFile, 'utf8'))
      const tok = (prof.layout && prof.layout.text) || {}
      const cssWidth = (rel, cls) => {
        if (!fs.existsSync(path.join(ROOT, rel))) return null
        const src = read(rel)
        const m = src.match(new RegExp('\\.' + cls + ' \\{([^}]*)\\}'))
        if (!m) return null
        const w = m[1].match(/width:\s*(\d+)px/)
        return w ? Number(w[1]) : null
      }
      const expectTok = (name, got, why) => {
        if (got === null || tok[name] === undefined) return
        if (tok[name] !== got) {
          fail('R17', `profiles/${want}.json`,
            `layout.text.${name} = ${tok[name]}，应为 ${got}（${why}）—— 文本高度估算按这个宽度折行`)
        }
      }
      expectTok('inputW', cssWidth('src/pages/input/input.ux', 'pvScroll'), 'input.ux 的 .pvScroll 宽')
      expectTok('inputMultiW', cssWidth('src/pages/input/input.ux', 'pvMulti'), 'input.ux 的 .pvMulti 宽')
      expectTok('morseW', cssWidth('src/pages/morseCode/morseCode.ux', 'morseScroll'), 'morseCode.ux 的 .morseScroll 宽')
    }
  }
}

// ---------- R14 发行产物完整性 ----------
{
  // 轻量 rpk 自检：签名块在不在、包根有没有混进别的包。
  // （完整验签在 tools/verify-rpk.mjs —— 那个脚本不入库，门禁里只做「结构级」体检。）
  const SIG_MAGIC = Buffer.from('RPK Sig Block 42')
  const ROOT_FILES = new Set(['app.jsc', 'manifest.json', 'manifest-watch.json'])
  function inspectRpk(file) {
    const buf = fs.readFileSync(file)
    let eocd = -1
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
    }
    if (eocd < 0) return { err: '不是合法的 zip/rpk（找不到 EOCD）' }
    const cdOffset = buf.readUInt32LE(eocd + 16)
    const cdSize = buf.readUInt32LE(eocd + 12)
    const entries = []
    let p = cdOffset
    while (p + 46 <= cdOffset + cdSize && buf.readUInt32LE(p) === 0x02014b50) {
      const nameLen = buf.readUInt16LE(p + 28)
      const extraLen = buf.readUInt16LE(p + 30)
      const cmtLen = buf.readUInt16LE(p + 32)
      const localOffset = buf.readUInt32LE(p + 42)
      entries.push({
        name: buf.toString('utf8', p + 46, p + 46 + nameLen),
        localOffset
      })
      p += 46 + nameLen + extraLen + cmtLen
    }
    let localEnd = 0
    for (const e of entries) {
      const lo = e.localOffset
      const nameLen = buf.readUInt16LE(lo + 26)
      const extraLen = buf.readUInt16LE(lo + 28)
      const compSize = buf.readUInt32LE(lo + 18)
      const end = lo + 30 + nameLen + extraLen + compSize
      if (end > localEnd) localEnd = end
    }
    const signChunk = buf.subarray(localEnd, cdOffset)
    const signed = signChunk.length > 0 && signChunk.subarray(signChunk.length - SIG_MAGIC.length).equals(SIG_MAGIC)
    const stray = entries
      .filter((e) => !e.name.endsWith('/'))
      .filter((e) => /\.(rpk|abp)$/i.test(e.name) || (!e.name.includes('/') && !ROOT_FILES.has(e.name)))
      .map((e) => e.name)
    return { signed, stray }
  }

  for (const chan of ['release', 'beta']) {
    const chanDir = path.join(ROOT, chan)
    if (!fs.existsSync(chanDir)) continue
    for (const name of fs.readdirSync(chanDir)) {
      const dir = path.join(chanDir, name)
      if (!fs.statSync(dir).isDirectory()) continue
      const rpks = fs.readdirSync(dir).filter((f) => f.endsWith('.rpk'))
      if (!rpks.length) continue
      for (const f of rpks) {
        const abs = path.join(dir, f)
        let info
        try {
          info = inspectRpk(abs)
        } catch (e) {
          fail('R14', path.join(chan, name, f), `读取失败：${e.message}`)
          continue
        }
        if (info.err) {
          fail('R14', path.join(chan, name, f), info.err)
          continue
        }
        if (!info.signed) {
          fail('R14', path.join(chan, name, f),
            '包内没有 rpk 签名块（未签名 / 签名后被改写）—— 手环会拒装，渠道会判「不是 release 包」。' +
            '重新出包：bash tools/make-release.sh --release <版本> --all-profiles')
        }
        if (info.stray.length) {
          fail('R14', path.join(chan, name, f),
            `包里混进了不该有的文件：${info.stray.join('、')} —— 快应用包里不能嵌套 rpk/abp` +
            '（0.1.1 标准版包就是这么被改坏的）')
        }
      }
      // SHA256SUMS.txt 必须与磁盘上的文件对得上：产物被动过（哪怕只改了 1 字节）要能看出来
      const sumFile = path.join(dir, 'SHA256SUMS.txt')
      if (fs.existsSync(sumFile)) {
        for (const line of fs.readFileSync(sumFile, 'utf8').split('\n')) {
          const m = /^([0-9a-f]{64})\s+(.+)$/.exec(line.trim())
          if (!m) continue
          const abs = path.join(dir, m[2])
          if (!fs.existsSync(abs)) {
            fail('R14', path.join(chan, name, 'SHA256SUMS.txt'), `清单里的 ${m[2]} 不存在了`)
            continue
          }
          const actual = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')
          if (actual !== m[1]) {
            fail('R14', path.join(chan, name, m[2]),
              `文件与 SHA256SUMS.txt 对不上（清单 ${m[1].slice(0, 12)}… / 实际 ${actual.slice(0, 12)}…）—— ` +
              '产物在生成校验和之后被改动过，重新出包')
          }
        }
      }
    }
  }
}

// ---------- R18 字号底线（<14px 一律拦下） ----------
// 手环 1.6" 屏上 12~13px 的中文只有约 1mm 高，真机上发虚。2026-11-24 把全项目
// 11/12/13px 全部抬到 ≥14px；这条门禁防止回退。唯一白名单是输入页的换行符按钮
// （`.nlT` 是 30×24 按钮里的 ⏎ 字形，不是可读文本）。
// 模板值（font-size: {{ ... }}px）与内联 style 里的模板值都跳过，只拦字面量。
const R18_EXEMPT = {
  'src/pages/input/input.ux|nlT': '换行符字形按钮（30×24 内的 ⏎ 字形，不是可读文本）'
}
for (const rel of walk('src', '.ux')) {
  const raw = read(rel)
  const styleM = raw.match(/<style>([\s\S]*?)<\/style>/)
  if (styleM) {
    const css = styleM[1].replace(/\/\*[\s\S]*?\*\//g, '')
    const re = /([^{}]+)\{([^{}]*)\}/g
    let m
    while ((m = re.exec(css))) {
      const fsM = m[2].match(/(?:^|;)\s*font-size\s*:\s*(\d+)px/)
      if (!fsM) continue
      const size = parseInt(fsM[1], 10)
      if (size >= 14) continue
      for (const s of m[1].split(',')) {
        const cls = s.trim().replace(/^\./, '')
        if (!cls || cls.includes(' ') || cls.includes('@')) continue
        if (R18_EXEMPT[rel + '|' + cls]) continue
        fail('R18', rel, `.${cls} 的 font-size = ${size}px（< 14px）—— ` +
          '手环小屏上会发虚；抬到 ≥14px（提示/说明优先 15px），放不下先删字')
      }
    }
  }
  const inline = /style="[^"]*font-size\s*:\s*(\d+)px[^"]*"/g
  let im
  while ((im = inline.exec(raw))) {
    if (parseInt(im[1], 10) < 14) {
      fail('R18', rel, `内联 font-size = ${im[1]}px（< 14px）—— 同上，抬到 ≥14px`)
    }
  }
}

// ---------- R19 文字对比度（提醒，不阻断） ----------
// 文字色只用三档：主 #FFFFFF / 次 0.72 / 提示 0.55；占位符与禁用态可到 0.45。
// 低于 0.4 的白字在 #1A1A1A 卡片上对比度不足 2.5:1，读起来发灰 —— 只出提醒，
// 因为禁用态/装饰性标签有合法用途，看到提醒请人工判一下是不是正文。
for (const rel of walk('src', '.ux')) {
  const styleM = read(rel).match(/<style>([\s\S]*?)<\/style>/)
  if (!styleM) continue
  const css = styleM[1].replace(/\/\*[\s\S]*?\*\//g, '')
  // 只匹配独立的 color 声明（background-color / border-color 不会被命中：前缀是 '-'）
  const re = /(?:^|;)\s*color\s*:\s*rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.(\d+)\s*\)/g
  let m
  while ((m = re.exec(css))) {
    const a = parseFloat('0.' + m[1])
    if (a < 0.4) {
      warn('R19', rel, `有文字色的白透明度 = ${a}（< 0.4）：正文/提示请用 ≥0.55，` +
        '只有占位符/禁用态/纯装饰才允许这么低')
    }
  }
}

// ---------- R20 内存卫生 ----------
{
  for (const b of scanMemoryHygiene()) fail('R20', b.file, b.msg)
}

// ---------- R21 页面小睡 ----------
{
  for (const b of scanNapContract()) fail('R21', b.file, b.msg)
}

// ---------- R22 导航胶囊/日志 ----------
{
  for (const b of scanNavStoreContract()) fail('R22', b.file, b.msg)
}

// ---------- 输出 ----------
console.log('release-gate：' + (errors.length ? `${errors.length} 个阻断项` : '通过') + `，${warnings.length} 个提醒`)
for (const w of warnings) console.log(`  ⚠ ${w.rule} ${w.file}\n     ${w.msg}`)
for (const e of errors) console.log(`  ✗ ${e.rule} ${e.file}\n     ${e.msg}`)
if (errors.length) process.exit(1)
