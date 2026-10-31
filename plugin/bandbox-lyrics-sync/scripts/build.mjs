#!/usr/bin/env node
/**
 * 构建 BandBox歌词同步 插件。
 *
 *   node scripts/build.mjs            → dist/plugin.wasm
 *   node scripts/build.mjs --package  → dist/plugin.wasm + dist/BandBox歌词同步.abp
 *
 * 工具链说明（重要）：
 *   官方 @bytecodealliance/componentize-js 0.23.0 **无法** 构建 API Level 4 的
 *   psys-world-v4 —— 它的 splicer 对 `async func` 导入仍是 todo!()，
 *   构建时直接 panic：
 *     thread '<unnamed>' panicked at crates/spidermonkey-embedding-splicer/src/bindgen.rs:721
 *     not yet implemented
 *
 *   官方文档给出的解法是打补丁的 ComponentizeJS 分支
 *   （AstralSightStudios/ComponentizeJS@astrobox/async-func-support），
 *   但该分支必须本机装 Rust 现场编译 splicer（与「不装 Rust」的要求冲突）。
 *
 *   因此这里改用 componentize-qjs 的 wasmtime-48 分支
 *   （@di-framework/componentize-qjs）：预编译原生二进制、零 Rust，
 *   并且能正确 stub `async func` 导入。
 *
 *   注意：componentize-qjs 额外导出 local:init/init 与 module-loader，
 *   AstroBox 宿主只关心 astrobox:psys-plugin-v4/* 导出，不受影响。
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { deflateRawSync } from 'node:zlib'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const WIT_DIR = path.join(root, 'wit')
const SRC = path.join(root, 'src', 'plugin.js')
const DIST = path.join(root, 'dist')
const WORLD = 'psys-world-v4'

/**
 * 定位 componentize-qjs 原生可执行文件。
 */
function resolveCli() {
  // 1) 直接安装的平台包
  const candidates = [
    '@di-framework/componentize-qjs',
    '@di-framework/componentize-qjs-linux-x64',
    '@di-framework/componentize-qjs-darwin-x64',
    '@di-framework/componentize-qjs-darwin-arm64',
    '@di-framework/componentize-qjs-linux-arm64',
    '@di-framework/componentize-qjs-win32-x64'
  ]
  for (const name of candidates) {
    try {
      const mod = require(name)
      if (typeof mod.nativeCliPath === 'function') {
        const p = mod.nativeCliPath()
        if (p && fs.existsSync(p)) return p
      }
    } catch (e) {}
  }
  // 2) node_modules/.bin
  const bin = path.join(root, 'node_modules', '.bin', 'componentize-qjs')
  if (fs.existsSync(bin)) return bin
  return null
}

function fail(msg) {
  console.error('\n[build] 失败：' + msg + '\n')
  process.exit(1)
}

const cli = resolveCli()
if (!cli) {
  fail(
    '找不到 componentize-qjs 可执行文件。\n' +
      '        请先执行：npm install\n' +
      '        （package.json 的 devDependencies 已固定 @di-framework/componentize-qjs 版本）'
  )
}

if (!fs.existsSync(WIT_DIR)) {
  fail('缺少 WIT 目录：' + WIT_DIR + '\n        请先执行：npm run wit')
}

fs.mkdirSync(DIST, { recursive: true })

const outWasm = path.join(DIST, 'plugin.wasm')
console.log('[build] CLI      :', cli)
console.log('[build] WIT      :', WIT_DIR)
console.log('[build] world   :', WORLD)
console.log('[build] entry   :', SRC)

const res = spawnSync(
  cli,
  ['--wit', WIT_DIR, '--js', SRC, '-n', WORLD, '-o', outWasm],
  { stdio: 'inherit' }
)

if (res.status !== 0 || !fs.existsSync(outWasm)) {
  fail('componentize-qjs 构建失败（退出码 ' + res.status + '）')
}

const size = fs.statSync(outWasm).size
console.log('[build] plugin.wasm =', (size / 1024 / 1024).toFixed(2), 'MB')

// ------------------------------------------------------------------
// 打包成 .abp
// ------------------------------------------------------------------
if (process.argv.includes('--package')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
  const iconPath = path.join(root, 'icon.png')

  const entries = []
  entries.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') })
  entries.push({ name: 'plugin.wasm', data: fs.readFileSync(outWasm) })
  if (fs.existsSync(iconPath)) {
    entries.push({ name: 'icon.png', data: fs.readFileSync(iconPath) })
  }

  // 极简 zip 写入器（不依赖第三方库）
  const chunks = []
  const central = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const compressed = deflateRawSync(entry.data, { level: 9 })
    const crc = crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(0, 12) // date
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)

    chunks.push(local, nameBuf, compressed)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0, 8)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(compressed.length, 20)
    cd.writeUInt32LE(entry.data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)

    central.push(cd, nameBuf)
    offset += local.length + nameBuf.length + compressed.length
  }

  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  const abp = path.join(DIST, manifest.name + '.abp')
  fs.writeFileSync(abp, Buffer.concat([...chunks, centralBuf, end]))
  console.log('[build] 打包完成：', abp, '(' + (fs.statSync(abp).size / 1024 / 1024).toFixed(2), 'MB )')
}

/**
 * CRC-32（zip 格式要求）。
 */
function crc32(buf) {
  let c
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c
    }
    return t
  })())
  let crc = -1
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}
