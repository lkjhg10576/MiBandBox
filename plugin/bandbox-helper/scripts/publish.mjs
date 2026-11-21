#!/usr/bin/env node
/**
 * 发布 BandBox辅助 到 AstroBox 官方插件源。
 *
 * ## 上架机制
 *
 * 官方插件源 `AstralSightStudios/AstroBox-NG-Plugin-Repo` 的根 index.txt 每行是一个
 * 「作者仓库的 raw 基地址」。它的 Action 每 4 小时（以及上游 push 时）跑
 * `scripts/generate-index.mjs`：去每个作者仓库拉 `<基址>/index.txt` → 里面的每一行是
 * 一个「装着 manifest.json 的文件夹」的相对路径 → 再去 `<基址>/<文件夹>/manifest.json`
 * 拉清单，汇总成 index.json，客户端读它。
 *
 * 所以本仓库（AtomGit）必须长这样：
 *
 *   index.txt          ← 一行：release
 *   release/
 *     manifest.json    ← 清单
 *     plugin.wasm      ← entry，客户端按 manifest.entry 下载
 *     icon.png         ← manifest.icon
 *     BandBox辅助.abp   ← 可选，手动安装用
 *
 * ## 为什么要绕 AtomGit
 *
 * 国内连 GitHub 慢。本仓真源放 AtomGit，用平台的「仓库镜像」功能单向 push 到
 * GitHub 的同名仓；市场只认 GitHub 的 raw 地址。用户在国内拿到的仍然是 GitHub 源，
 * 但我们推代码走 AtomGit，链路顺畅。
 *
 * 因此本脚本只推 AtomGit，镜像由平台负责；推完会轮询 GitHub 的 raw 地址确认镜像到了。
 *
 * ## 用法
 *
 *   node scripts/publish.mjs                # 构建 + 同步 + 提交 + 推送 + 校验镜像
 *   node scripts/publish.mjs --dry-run      # 只同步到本地仓，不提交不推送
 *   node scripts/publish.mjs --no-build     # 复用已有 dist/，不重新构建
 *
 * 环境变量：
 *   PLUGIN_REPO_URL     插件仓地址（缺省 https://atomgit.com/gcw_MchqrexB/bandbox_helper.git）
 *   PLUGIN_REPO_DIR     本地克隆目录（缺省 dist/repo，在 .gitignore 内）
 *   PLUGIN_MIRROR_BASE  GitHub 镜像基址（缺省 raw.githubusercontent.com/lkjhg10576/bandbox_helper）
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const DIST = path.join(root, 'dist')

const REPO_URL = process.env.PLUGIN_REPO_URL || 'https://atomgit.com/gcw_MchqrexB/bandbox_helper.git'
const REPO_DIR = process.env.PLUGIN_REPO_DIR || path.join(DIST, 'repo')
const MIRROR_BASE =
  process.env.PLUGIN_MIRROR_BASE ||
  'https://raw.githubusercontent.com/lkjhg10576/bandbox_helper/refs/heads/main/'

const DRY_RUN = process.argv.includes('--dry-run')
const NO_BUILD = process.argv.includes('--no-build')

function fail(msg) {
  console.error('\n[publish] 失败：' + msg + '\n')
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (r.status !== 0) {
    if (r.stdout) console.log(r.stdout)
    if (r.stderr) console.error(r.stderr)
    fail(cmd + ' ' + args.join(' ') + ' 退出码 ' + r.status)
  }
  return r.stdout || ''
}

// ------------------------------------------------------------------
// 1. 构建
// ------------------------------------------------------------------
if (!NO_BUILD) {
  console.log('[publish] 构建 …')
  run(process.execPath, [path.join(here, 'build.mjs'), '--package'], { stdio: 'inherit' })
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
const abpName = manifest.name + '.abp'
const publishFiles = ['manifest.json', 'icon.png', 'plugin.wasm', abpName]
for (const f of publishFiles) {
  if (!fs.existsSync(path.join(DIST, f))) {
    fail('dist/' + f + ' 不存在（先构建，或去掉 --no-build）')
  }
}

// ------------------------------------------------------------------
// 2. 准备本地插件仓
// ------------------------------------------------------------------
if (!fs.existsSync(path.join(REPO_DIR, '.git'))) {
  console.log('[publish] 克隆插件仓 →', REPO_DIR)
  fs.rmSync(REPO_DIR, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(REPO_DIR), { recursive: true })
  run('git', ['clone', REPO_URL, REPO_DIR], { stdio: 'inherit' })
} else {
  console.log('[publish] 更新插件仓 …')
  run('git', ['-C', REPO_DIR, 'fetch', 'origin'], { stdio: 'inherit' })
  run('git', ['-C', REPO_DIR, 'reset', '--hard', 'origin/main'], { stdio: 'inherit' })
}

// ------------------------------------------------------------------
// 3. 同步发布目录 + index.txt + README
// ------------------------------------------------------------------
const releaseDir = path.join(REPO_DIR, 'release')
fs.mkdirSync(releaseDir, { recursive: true })
for (const f of publishFiles) {
  fs.copyFileSync(path.join(DIST, f), path.join(releaseDir, f))
}

// index.txt：每行一个「装着 manifest.json 的文件夹」的仓库内相对路径
fs.writeFileSync(path.join(REPO_DIR, 'index.txt'), 'release\n', 'utf8')

const PERM_TEXT = {
  device: '读取已连接的手环设备列表',
  interconnect: '向手环发送消息（send-qaic-message）',
  register_interconnect_recv: '注册接收手环回执（register-interconnect-recv）'
}
const permLines = manifest.permissions.map(
  (p) => '- `' + p + '` —— ' + (PERM_TEXT[p] || '（见 manifest.json）')
)

const readme = [
  '# ' + manifest.name,
  '',
  manifest.description,
  '',
  '> AstroBox 官方插件源收录插件。手机端 AstroBox 的「插件市场」里可直接搜索安装。',
  '',
  '## 配套应用',
  '',
  '本插件是 **BandBox**（小米手环百宝箱快应用）的手机端配套插件，负责两条链路：',
  '',
  '1. **从手机推送歌词**：手机选 `.lrc` 歌词文件 → 插件剥离时间轴与标签 → 推到手环「歌词本」；',
  '2. **动态口令（TOTP）同步**：批量导入 `otpauth://` 账户 → 下发到手环 → 手环本地离线生成 6 位验证码。',
  '',
  '> 装插件前请先在手环上装好 BandBox 快应用（包名 `com.lkjhg.bandbox`），插件按包名寻址手环。',
  '',
  '## 安装',
  '',
  '**方式一（推荐）**：手机 AstroBox → 插件市场 → 搜索「' + manifest.name + '」→ 安装。',
  '',
  '**方式二（手动）**：下载 [`' + abpName + '`](./release/' + abpName + ')，',
  '用手机 AstroBox 的「从本地导入插件」安装。`.abp` 是标准 zip，内容为 manifest.json + plugin.wasm + icon.png。',
  '',
  '## 技术信息',
  '',
  '- 版本：' + manifest.version,
  '- API Level：' + manifest.api_level,
  '- WASI Version：' + manifest.wasi_version,
  '- 入口：`plugin.wasm`（QuickJS → wasm，componentize-qjs 编译）',
  '',
  '### 权限清单',
  '',
  permLines.join('\n'),
  '',
  '## 源码',
  '',
  '- 插件源码与构建脚本：https://atomgit.com/gcw_MchqrexB/MiBandBox/tree/main/plugin/bandbox-helper',
  '- 配套快应用：https://atomgit.com/gcw_MchqrexB/MiBandBox',
  '- GitHub 镜像：https://github.com/lkjhg10576/MiBandBox',
  '',
  '## 许可',
  '',
  '自由、免费、开源。MIT License。',
  ''
].join('\n')
fs.writeFileSync(path.join(REPO_DIR, 'README.md'), readme, 'utf8')

// ------------------------------------------------------------------
// 4. 提交 + 推送（只推 AtomGit，GitHub 由镜像同步）
// ------------------------------------------------------------------
if (DRY_RUN) {
  console.log('[publish] --dry-run：已同步到 ' + REPO_DIR + '，不提交不推送')
  process.exit(0)
}

run('git', ['-C', REPO_DIR, 'add', '-A'], { stdio: 'inherit' })
const staged = run('git', ['-C', REPO_DIR, 'diff', '--cached', '--name-status'])
if (!staged.trim()) {
  console.log('[publish] 没有变更，无需提交')
} else {
  const msg = 'release: ' + manifest.name + ' ' + manifest.version
  run('git', ['-C', REPO_DIR, 'commit', '-m', msg], { stdio: 'inherit' })
  console.log('[publish] 推送 → ' + REPO_URL)
  run('git', ['-C', REPO_DIR, 'push', 'origin', 'main'], { stdio: 'inherit' })
}

// ------------------------------------------------------------------
// 5. 校验镜像：轮询 GitHub raw，确认镜像仓已同步
// ------------------------------------------------------------------
console.log('[publish] 等待镜像同步（GitHub raw）…')
const target = MIRROR_BASE + 'release/manifest.json'
let ok = false
for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch(target, { cache: 'no-store' })
    if (res.ok) {
      const body = await res.json()
      if (body && body.version === manifest.version) {
        console.log('[publish] 镜像已就绪：' + target + '  (version ' + body.version + ')')
        ok = true
        break
      }
    }
  } catch (e) {}
  await new Promise((r) => setTimeout(r, 4000))
}
if (!ok) {
  console.warn(
    '[publish] 警告：镜像还没同步到 GitHub（' + target + '）。\n' +
      '          平台镜像有延迟，稍后用下面的命令自查：\n' +
      '          curl -sI "' + target + '"'
  )
  process.exit(1)
}
