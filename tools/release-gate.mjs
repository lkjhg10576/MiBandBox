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

// ---------- 输出 ----------
console.log('release-gate：' + (errors.length ? `${errors.length} 个阻断项` : '通过') + `，${warnings.length} 个提醒`)
for (const w of warnings) console.log(`  ⚠ ${w.rule} ${w.file}\n     ${w.msg}`)
for (const e of errors) console.log(`  ✗ ${e.rule} ${e.file}\n     ${e.msg}`)
if (errors.length) process.exit(1)
