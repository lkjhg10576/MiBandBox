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

test('OTP 动作识别', () => {
  assert.equal(resolveAction('tab-lyrics', ''), 'tab-lyrics')
  assert.equal(resolveAction('tab-otp', ''), 'tab-otp')
  assert.equal(resolveAction('otp-pull', ''), 'otp-pull')
  assert.equal(resolveAction('otp-add', ''), 'otp-add')
  assert.equal(resolveAction('otp-save', ''), 'otp-save')
  assert.equal(resolveAction('otp-confirm-save', ''), 'otp-confirm-save')
  assert.equal(resolveAction('otp-paste', ''), 'otp-paste')
  assert.equal(resolveAction('otp-paste-apply', ''), 'otp-paste-apply')
  assert.equal(resolveAction('otp-edit-done', ''), 'otp-edit-done')
  assert.equal(resolveAction('otp-del-yes', ''), 'otp-del-yes')
  assert.equal(resolveAction('otp-export', ''), 'otp-export')
  assert.equal(resolveAction('otp-export-close', ''), 'otp-export-close')
  assert.equal(resolveAction('otp-dialog-close', ''), 'otp-dialog-close')
  assert.equal(resolveAction('otp-offset-apply', ''), 'otp-offset-apply')
  assert.equal(resolveAction('otp-offset-dismiss', ''), 'otp-offset-dismiss')
  // 带参前缀
  assert.equal(resolveAction('otp-edit:acc_123', ''), 'otp-edit:acc_123')
  assert.equal(resolveAction('otp-del:acc_456', ''), 'otp-del:acc_456')
  assert.equal(resolveAction('otp-field:name', ''), 'otp-field:name')
  // 宿主前缀包裹
  assert.equal(resolveAction('container-otp-edit:acc_1', ''), 'otp-edit:acc_1')
  assert.equal(resolveAction('container-1', '{"value":"otp-del:acc_2"}'), 'otp-del:acc_2')
})

test('OTP 动作文案兜底', () => {
  assert.equal(resolveAction('container-1', '动态口令'), 'tab-otp')
  assert.equal(resolveAction('container-1', '拉取数据'), 'otp-pull')
  assert.equal(resolveAction('container-1', '添加账户'), 'otp-add')
  assert.equal(resolveAction('container-1', '批量粘贴'), 'otp-paste')
  assert.equal(resolveAction('container-1', '解析并导入'), 'otp-paste-apply')
})

test('二维码动作识别', () => {
  assert.equal(resolveAction('tab-qr', ''), 'tab-qr')
  assert.equal(resolveAction('qr-send', ''), 'qr-send')
  assert.equal(resolveAction('qr-pick-png', ''), 'qr-pick-png')
  // 带参前缀
  assert.equal(resolveAction('qr-field:text', ''), 'qr-field:text')
  // 宿主前缀包裹：'qr-send' 不能被 'send' 抢走
  assert.equal(resolveAction('container-qr-send', ''), 'qr-send')
  assert.equal(resolveAction('container-1', '{"value":"qr-field:text"}'), 'qr-field:text')
})

test('二维码动作文案兜底', () => {
  assert.equal(resolveAction('container-1', '二维码'), 'tab-qr')
})

test('无法识别时返回空串', () => {
  assert.equal(resolveAction('container-1', ''), '')
  assert.equal(resolveAction('container-1', '{}'), '')
  assert.equal(resolveAction('container-1', '{"value":""}'), '')
  assert.equal(resolveAction(null, null), '')
})
