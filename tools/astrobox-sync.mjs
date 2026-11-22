#!/usr/bin/env node
/**
 * astrobox-sync —— 把 AstroBox Creator Console 写在 GitHub 资源仓库里的资源拉回本地
 *
 * ## 为什么需要它
 *
 * 资源仓库（GitHub `lkjhg10576/MiBandBox`）同时是：
 *   1. 本项目的 GitHub 镜像（AtomGit 每次提交自动覆盖同步过来）；
 *   2. AstroBox Creator Console 的工作区（控制台直接往这里写 media/ downloads/ manifest_v2.json）。
 *
 * 两个写入方互不知情：控制台改了资源 → 下一次 AtomGit push 把镜像覆盖回去，控制台的改动就没了；
 * 反过来本地 push → 控制台下次会话又会覆盖一遍。0.1.1 被打回「icon指向文件不存在」就是这个
 * 竞态的产物：11-09 在控制台里移除了图标，文件从仓库消失，而清单 manifest_v2.json 的
 * item.icon 仍指着它。
 *
 * 所以约定：**本地仓库是真源**。控制台每次编辑会话后跑一次本脚本，把控制台写的文件拉回本地
 * 并提交；下次 push 推上去，资源仓库就是完整的。清单里指向的文件全部在本地存在，才允许提交。
 *
 * ## 用法
 *
 *   node tools/astrobox-sync.mjs            # 拉取 + 校验（控制台改完跑这个）
 *   node tools/astrobox-sync.mjs --check    # 只校验本地引用完整性，不联网
 *
 * 环境变量：
 *   GITHUB_TOKEN / GH_TOKEN   GitHub token（缺省时用 `gh auth token`）
 *   ASTROBOX_RESOURCE_REPO    资源仓库（缺省 lkjhg10576/MiBandBox）
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = process.env.ASTROBOX_RESOURCE_REPO || 'lkjhg10576/MiBandBox'
const CHECK_ONLY = process.argv.includes('--check')
const MANIFEST = 'manifest_v2.json'

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim()
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim()
  const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' })
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim()
  console.error('拿不到 GitHub token：先 `gh auth login`，或设 GITHUB_TOKEN')
  process.exit(2)
}

async function api(tok, url, accept = 'application/vnd.github+json') {
  // 用 URL 解析而非字符串拼接：防止 url 以 `@` 开头时被解析成
  // `https://api.github.com@evil.com/...`，把带 token 的请求发到别的主机上。
  const target = new URL(url, 'https://api.github.com/')
  if (target.hostname !== 'api.github.com') throw new Error(`拒绝请求非法目标主机：${target.hostname}`)
  const r = await fetch(target, {
    headers: { Authorization: `Bearer ${tok}`, Accept: accept, 'User-Agent': 'bandbox-astrobox-sync' },
  })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} ${url}`)
  return r
}

async function pull(tok) {
  let changed = 0
  // 1) 清单
  const mf = await api(tok, `/repos/${REPO}/contents/${MANIFEST}`)
  const mjson = Buffer.from((await mf.json()).content, 'base64')
  const mfAbs = path.join(ROOT, MANIFEST)
  if (!fs.existsSync(mfAbs) || !fs.readFileSync(mfAbs).equals(mjson)) {
    fs.writeFileSync(mfAbs, mjson)
    console.log(`  ↓ ${MANIFEST}`)
    changed++
  }
  const manifest = JSON.parse(mjson.toString('utf8'))

  // 2) media/ 与 downloads/ 下的实体文件（清单里引用到的才拉，避免塞一堆无关文件）
  const wanted = new Set()
  const item = manifest.item || {}
  if (item.icon) wanted.add(item.icon)
  if (item.cover) wanted.add(item.cover)
  for (const p of item.preview || []) wanted.add(p)
  for (const d of Object.values(manifest.downloads || {})) if (d?.file_name) wanted.add(d.file_name)

  for (const rel of wanted) {
    const clean = rel.replace(/^\.\//, '').replace(/^\/+/, '')
    const abs = path.join(ROOT, clean)
    const res = await api(tok, `/repos/${REPO}/contents/${clean}`, 'application/vnd.github.raw')
    const buf = Buffer.from(await res.arrayBuffer())
    if (!fs.existsSync(abs) || !fs.readFileSync(abs).equals(buf)) {
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, buf)
      console.log(`  ↓ ${clean} (${(buf.length / 1024).toFixed(1)} KB)`)
      changed++
    }
  }
  return { changed, manifest }
}

/** 清单里每一条引用都要在本地有实体文件 —— 这条不过，平台就会打回「icon指向文件不存在」 */
function verify(manifest) {
  const item = manifest.item || {}
  const refs = []
  if (item.icon) refs.push(['item.icon', item.icon])
  if (item.cover) refs.push(['item.cover', item.cover])
  for (const [i, p] of (item.preview || []).entries()) refs.push([`item.preview[${i}]`, p])
  for (const [dev, d] of Object.entries(manifest.downloads || {})) {
    if (d?.file_name) refs.push([`downloads.${dev}.file_name`, d.file_name])
  }
  const bad = []
  for (const [field, p] of refs) {
    const clean = String(p).replace(/^\.\//, '').replace(/^\/+/, '')
    if (!fs.existsSync(path.join(ROOT, clean))) bad.push(`${field} → ${p}（文件缺失）`)
  }
  // 图标边长 ≤ 500px（Creator Console 实测硬上限）
  if (item.icon) {
    const clean = String(item.icon).replace(/^\.\//, '').replace(/^\/+/, '')
    const abs = path.join(ROOT, clean)
    if (fs.existsSync(abs) && clean.toLowerCase().endsWith('.png')) {
      const buf = fs.readFileSync(abs)
      if (buf.length > 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        const w = buf.readUInt32BE(16)
        const h = buf.readUInt32BE(20)
        if (w > 500 || h > 500) bad.push(`item.icon → ${clean} 是 ${w}×${h}，超过控制台上限 500px`)
      }
    }
  }
  return { refs, bad }
}

let manifest
if (CHECK_ONLY) {
  const mfAbs = path.join(ROOT, MANIFEST)
  if (!fs.existsSync(mfAbs)) {
    console.error(`本地没有 ${MANIFEST}，无法校验`)
    process.exit(2)
  }
  manifest = JSON.parse(fs.readFileSync(mfAbs, 'utf8'))
} else {
  console.log(`从 ${REPO} 拉取资源文件…`)
  const r = await pull(token())
  manifest = r.manifest
  console.log(r.changed ? `  拉了 ${r.changed} 个文件` : '  已是最新')
}

const { refs, bad } = verify(manifest)
console.log(`\n引用校验（${refs.length} 条）：`)
for (const [field, p] of refs) console.log(`  · ${field} → ${p}`)
if (bad.length) {
  console.error('\n✗ 有引用指向不存在的文件，提交到平台会被打回：')
  for (const b of bad) console.error(`  ✗ ${b}`)
  process.exit(1)
}
console.log('\n✓ 全部引用都能在仓库里找到实体文件')
