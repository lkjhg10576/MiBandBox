import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const worldSrc = readFileSync(new URL('../world/bandbox.wit', import.meta.url), 'utf8')
const srcDir = new URL('../src/', import.meta.url)

const worldImports = new Set()
for (const match of worldSrc.matchAll(/import\s+astrobox:psys-host-v4\/([\w-]+);/g)) {
  worldImports.add(match[1])
}

const sourceImports = new Set()
for (const file of readdirSync(srcDir)) {
  if (!file.endsWith('.js')) continue
  const src = readFileSync(new URL(file, srcDir), 'utf8')
  for (const match of src.matchAll(/from 'astrobox:psys-host-v4\/([\w-]+)'/g)) {
    sourceImports.add(match[1])
  }
}

test('world 只导入源码实际使用的宿主接口', () => {
  assert.deepEqual(
    [...worldImports].sort(),
    [...sourceImports].sort(),
    'world/bandbox.wit 的 import 与 src 中的宿主 import 不一致'
  )
})

test('world 不导入宿主未实现的 canopusconnect', () => {
  assert.ok(
    !worldImports.has('canopusconnect'),
    'canopusconnect 未在宿主 linker 中实现，导入会导致插件安装/加载失败'
  )
})
