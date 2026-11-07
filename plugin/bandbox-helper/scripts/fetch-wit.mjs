#!/usr/bin/env node
/**
 * 拉取 AstroBox 插件 WIT 定义到 wit/。
 *
 *   node scripts/fetch-wit.mjs
 *
 * WIT 来自 AstralSightStudios/AstroBox-Plugin-WIT（main 分支）。
 * 本仓库不把它做成 git submodule：submodule 需要 git 协议访问 GitHub，
 * 在部分网络环境下不可用；直接下载 tarball 更稳。
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const WIT_DIR = path.join(root, 'wit')

const REPO = 'AstralSightStudios/AstroBox-Plugin-WIT'
const BRANCH = 'main'
const TARBALL = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${BRANCH}`

console.log('[wit] 下载', TARBALL)

const res = spawnSync('curl', ['-sSL', '--retry', '3', '--retry-delay', '2', '-o', '-', TARBALL], {
  maxBuffer: 64 * 1024 * 1024,
  encoding: 'buffer'
})

if (res.status !== 0 || !res.stdout || res.stdout.length < 100) {
  console.error('[wit] 下载失败（退出码 ' + res.status + '）')
  process.exit(1)
}

fs.rmSync(WIT_DIR, { recursive: true, force: true })
fs.mkdirSync(WIT_DIR, { recursive: true })

const tmp = path.join(root, '.wit-tmp')
fs.rmSync(tmp, { recursive: true, force: true })
fs.mkdirSync(tmp, { recursive: true })
fs.writeFileSync(path.join(tmp, 'wit.tar.gz'), res.stdout)

const untar = spawnSync('tar', ['xzf', path.join(tmp, 'wit.tar.gz'), '-C', tmp], { stdio: 'inherit' })
if (untar.status !== 0) {
  console.error('[wit] 解压失败')
  process.exit(1)
}

const extracted = path.join(tmp, `${REPO}-${BRANCH}`)
if (!fs.existsSync(extracted)) {
  // tarball 顶层目录名可能带其它形态，退化成「找到唯一含 main.wit 的目录」
  const candidates = fs
    .readdirSync(tmp)
    .map((n) => path.join(tmp, n))
    .filter((p) => fs.existsSync(path.join(p, 'main.wit')))
  if (candidates.length !== 1) {
    console.error('[wit] 目录结构异常，候选：', fs.readdirSync(tmp))
    process.exit(1)
  }
  fs.cpSync(candidates[0], WIT_DIR, { recursive: true })
} else {
  fs.cpSync(extracted, WIT_DIR, { recursive: true })
}
fs.rmSync(tmp, { recursive: true, force: true })

// main.wit 带 UTF-8 BOM，会让 WIT 解析器报错
const mainWit = path.join(WIT_DIR, 'main.wit')
if (fs.existsSync(mainWit)) {
  const buf = fs.readFileSync(mainWit)
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    fs.writeFileSync(mainWit, buf.subarray(3))
    console.log('[wit] 已去掉 main.wit 的 BOM')
  }
}

console.log('[wit] 完成：', WIT_DIR)
console.log('[wit] 文件：')
for (const f of fs.readdirSync(WIT_DIR)) {
  console.log('   ', f)
}
