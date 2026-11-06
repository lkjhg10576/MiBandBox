#!/usr/bin/env node
/**
 * 屏幕亮度与高亮控制（screen.js）单测。
 * 运行：node tools/test-screen.mjs
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const screenSource = await readFile(path.join(root, 'src/utils/screen.js'), 'utf8')

let passed = 0
let failed = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    failures.push({ name, error: e })
    console.log(`  ✗ ${name}: ${e.message}`)
  }
}

/**
 * 构造带 mock brightness 的 screen 模块实例
 */
function createScreenInstance(mockBrightness) {
  // 替换 import brightness from '@system.brightness'
  let transformed = screenSource.replace(
    /import brightness from '@system\.brightness'/,
    'const brightness = __mockBrightness'
  )
  transformed = transformed.replace('export default { enter, leave }', 'return { enter, leave }')
  transformed = transformed.replace('export function enter', 'function enter')
  transformed = transformed.replace('export function leave', 'function leave')

  const factory = new Function('__mockBrightness', transformed)
  return factory(mockBrightness)
}

console.log('屏幕亮度/荧光棒退出恢复单测')

await test('场景1：系统自动亮度（mode=1，value=0），退出时只恢复自动模式，绝不调用 setValue', async () => {
  const calls = []
  const mockBrightness = {
    getValue: ({ success }) => {
      calls.push({ fn: 'getValue' })
      success({ value: 0 }) // 自动亮度新手表常返回 0
    },
    getMode: ({ success }) => {
      calls.push({ fn: 'getMode' })
      success({ mode: 1 }) // 1 = 自动模式
    },
    setMode: ({ mode, success }) => {
      calls.push({ fn: 'setMode', mode })
      if (success) success()
    },
    setValue: ({ value, success }) => {
      calls.push({ fn: 'setValue', value })
      if (success) success()
    },
    setKeepScreenOn: ({ keepScreenOn, success }) => {
      calls.push({ fn: 'setKeepScreenOn', keepScreenOn })
      if (success) success()
    }
  }

  const screen = createScreenInstance(mockBrightness)
  screen.enter({ bright: true, keepOn: true })

  // 验证进入逻辑：
  // 1. 同步设置 255
  // 2. 检查到原模式为 1，切 mode: 0 防回压并再次 setMax
  assert.ok(calls.some(c => c.fn === 'setValue' && c.value === 255), '进入时拉满 255')
  assert.ok(calls.some(c => c.fn === 'setMode' && c.mode === 0), '进入时切为手动模式 mode 0')
  assert.ok(calls.some(c => c.fn === 'setKeepScreenOn' && c.keepScreenOn === true), '进入时开启常亮')

  // 清空调用记录，测试退出流程
  calls.length = 0
  screen.leave()

  // 关键断言！退出时必须切回 mode: 1，且绝对不能调用 setValue（避免跌落最暗）
  const setValuesOnLeave = calls.filter(c => c.fn === 'setValue')
  assert.equal(setValuesOnLeave.length, 0, '退出荧光棒时绝不能调用 setValue，避免屏幕被调到最暗')

  const setModesOnLeave = calls.filter(c => c.fn === 'setMode')
  assert.equal(setModesOnLeave.length, 1, '退出荧光棒时必须恢复模式')
  assert.equal(setModesOnLeave[0].mode, 1, '退出荧光棒时必须恢复为系统自动亮度 mode: 1')

  const setKeepOnOnLeave = calls.filter(c => c.fn === 'setKeepScreenOn')
  assert.equal(setKeepOnOnLeave.length, 1, '退出荧光棒时必须关闭常亮')
  assert.equal(setKeepOnOnLeave[0].keepScreenOn, false, '关闭常亮')
})

await test('场景2：系统手动亮度（mode=0，value=128），退出时回到原亮度与手动模式', async () => {
  const calls = []
  const mockBrightness = {
    getValue: ({ success }) => {
      calls.push({ fn: 'getValue' })
      success({ value: 128 }) // 原手动亮度 128
    },
    getMode: ({ success }) => {
      calls.push({ fn: 'getMode' })
      success({ mode: 0 }) // 0 = 手动模式
    },
    setMode: ({ mode, success }) => {
      calls.push({ fn: 'setMode', mode })
      if (success) success()
    },
    setValue: ({ value, success }) => {
      calls.push({ fn: 'setValue', value })
      if (success) success()
    },
    setKeepScreenOn: ({ keepScreenOn, success }) => {
      calls.push({ fn: 'setKeepScreenOn', keepScreenOn })
      if (success) success()
    }
  }

  const screen = createScreenInstance(mockBrightness)
  screen.enter({ bright: true, keepOn: true })

  calls.length = 0
  screen.leave()

  // 退出时恢复原手动亮度 128，且保持手动模式 0
  const setValuesOnLeave = calls.filter(c => c.fn === 'setValue')
  assert.equal(setValuesOnLeave.length, 1, '退出时恢复原手动亮度')
  assert.equal(setValuesOnLeave[0].value, 128, '恢复为 128')

  const setModesOnLeave = calls.filter(c => c.fn === 'setMode')
  assert.equal(setModesOnLeave.length, 1, '退出时保持 mode: 0')
  assert.equal(setModesOnLeave[0].mode, 0, '保持手动模式 0')
})

await test('场景3：设备不支持 getMode（旧款手环），退出时通过 setValue 恢复原亮度', async () => {
  const calls = []
  const mockBrightness = {
    getValue: ({ success }) => {
      calls.push({ fn: 'getValue' })
      success({ value: 150 })
    },
    // 不提供 getMode / setMode
    setValue: ({ value, success }) => {
      calls.push({ fn: 'setValue', value })
      if (success) success()
    },
    setKeepScreenOn: ({ keepScreenOn, success }) => {
      calls.push({ fn: 'setKeepScreenOn', keepScreenOn })
      if (success) success()
    }
  }

  const screen = createScreenInstance(mockBrightness)
  screen.enter({ bright: true, keepOn: true })

  calls.length = 0
  screen.leave()

  const setValuesOnLeave = calls.filter(c => c.fn === 'setValue')
  assert.equal(setValuesOnLeave.length, 1, '不支持 getMode 时恢复原亮度')
  assert.equal(setValuesOnLeave[0].value, 150, '恢复为 150')
})

await test('场景4：快速进出（getMode 在 leave 之后才返回），回调到达时正确恢复自动模式', async () => {
  const calls = []
  let pendingGetModeSuccess = null

  const mockBrightness = {
    getValue: ({ success }) => {
      calls.push({ fn: 'getValue' })
      success({ value: 0 })
    },
    getMode: ({ success }) => {
      calls.push({ fn: 'getMode' })
      pendingGetModeSuccess = success // 暂不触发，模拟异步延迟
    },
    setMode: ({ mode, success }) => {
      calls.push({ fn: 'setMode', mode })
      if (success) success()
    },
    setValue: ({ value, success }) => {
      calls.push({ fn: 'setValue', value })
      if (success) success()
    },
    setKeepScreenOn: ({ keepScreenOn, success }) => {
      calls.push({ fn: 'setKeepScreenOn', keepScreenOn })
      if (success) success()
    }
  }

  const screen = createScreenInstance(mockBrightness)
  screen.enter({ bright: true, keepOn: true })

  calls.length = 0
  // 用户迅速退出
  screen.leave()

  // 退出这一瞬间，因为 getMode 还在 pending，不会误设 setValue
  assert.equal(calls.filter(c => c.fn === 'setValue').length, 0)

  // 随后 getMode 异步返回
  assert.ok(pendingGetModeSuccess, '存在 pending 的 getMode 回调')
  pendingGetModeSuccess({ mode: 1 })

  // 回调返回后，应该识别出已退出且原本是自动模式，直接恢复 mode: 1，绝不调 setValue
  assert.equal(calls.filter(c => c.fn === 'setValue').length, 0, '绝不能调 setValue')
  const setModes = calls.filter(c => c.fn === 'setMode')
  assert.equal(setModes.length, 1, '安全恢复为自动模式')
  assert.equal(setModes[0].mode, 1, '恢复为 mode 1')
})

await test('场景5：bright: false 时不操作亮度，只控制常亮', async () => {
  const calls = []
  const mockBrightness = {
    getValue: ({ success }) => {
      calls.push({ fn: 'getValue' })
      success({ value: 100 })
    },
    getMode: ({ success }) => {
      calls.push({ fn: 'getMode' })
      success({ mode: 1 })
    },
    setMode: ({ mode }) => calls.push({ fn: 'setMode', mode }),
    setValue: ({ value }) => calls.push({ fn: 'setValue', value }),
    setKeepScreenOn: ({ keepScreenOn }) => calls.push({ fn: 'setKeepScreenOn', keepScreenOn })
  }

  const screen = createScreenInstance(mockBrightness)
  screen.enter({ bright: false, keepOn: true })

  assert.equal(calls.filter(c => c.fn === 'setValue').length, 0, '不调 setValue')
  assert.equal(calls.filter(c => c.fn === 'setMode').length, 0, '不调 setMode')
  assert.equal(calls.filter(c => c.fn === 'setKeepScreenOn').length, 1, '开启常亮')

  calls.length = 0
  screen.leave()

  assert.equal(calls.filter(c => c.fn === 'setValue').length, 0, '退出不调 setValue')
  assert.equal(calls.filter(c => c.fn === 'setMode').length, 0, '退出不调 setMode')
  assert.equal(calls.filter(c => c.fn === 'setKeepScreenOn').length, 1, '退出关闭常亮')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
