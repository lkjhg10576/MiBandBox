import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ACTIONS, isAction, resolveAction } from '../src/actions.js'

test('isAction 识别已知动作', () => {
  for (const action of ACTIONS) assert.equal(isAction(action), true, action)
  assert.equal(isAction('pick-device:AA:BB:CC'), true)
  assert.equal(isAction('unknown'), false)
  assert.equal(isAction(''), false)
  assert.equal(isAction(null), false)
})

test('新宿主：动作 id 在 eventId 里', () => {
  assert.equal(resolveAction('pick-file', ''), 'pick-file')
  assert.equal(resolveAction('send', '{}'), 'send')
  assert.equal(resolveAction('pick-device:AA:BB', ''), 'pick-device:AA:BB')
})

test('旧宿主：动作 id 在 eventPayload 字符串里', () => {
  assert.equal(resolveAction('container-1', 'pick-file'), 'pick-file')
  assert.equal(resolveAction('container-1', 'pick-device:AA:BB'), 'pick-device:AA:BB')
})

test('旧宿主：动作 id 在 eventPayload JSON 里', () => {
  assert.equal(resolveAction('container-1', '{"id":"send"}'), 'send')
  assert.equal(resolveAction('container-1', '{"action":"pick-file"}'), 'pick-file')
  assert.equal(resolveAction('container-1', '{"value":"refresh-devices"}'), 'refresh-devices')
  assert.equal(resolveAction('container-1', { value: 'toggle-debug' }), 'toggle-debug')
})

test('动作 id 带宿主前缀时仍能识别', () => {
  assert.equal(resolveAction('plugin-container-pick-file', ''), 'pick-file')
  assert.equal(resolveAction('plugin-container-pick-device:AA:BB', ''), 'pick-device:AA:BB')
  assert.equal(resolveAction('container-1', '{"value":"prefix-pick-device:AA:BB"}'), 'pick-device:AA:BB')
})

test('极端情况下按按钮文案兜底', () => {
  assert.equal(resolveAction('container-1', '选择 LRC 文件'), 'pick-file')
  assert.equal(resolveAction('container-1', '{"value":"发送到手环"}'), 'send')
  assert.equal(resolveAction('container-1', '刷新设备'), 'refresh-devices')
  assert.equal(resolveAction('container-1', '关闭诊断'), 'toggle-debug')
})

test('无法识别时返回空串', () => {
  assert.equal(resolveAction('container-1', ''), '')
  assert.equal(resolveAction('container-1', '{}'), '')
  assert.equal(resolveAction('container-1', '{"value":""}'), '')
  assert.equal(resolveAction(null, null), '')
})
