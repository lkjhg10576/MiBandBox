/**
 * UI 动作解析。
 *
 * 不同 AstroBox 版本 / 平台对 `on(CLICK, id)` 的传递方式并不一致：
 *   - 新宿主把 id 放在 `onUiEvent(eventId, ...)` 的第一个参数里；
 *   - 旧宿主 / 桌面独立插件窗口可能把 id 放在 `eventPayload` 里。
 *
 * 这里统一解析，调用方只关心“哪个动作被点了”。
 */

/** 没有参数的动作 id。 */
export const ACTIONS = [
  // 歌词 Tab（原有）
  'pick-file',
  'send',
  'refresh-devices',
  'toggle-debug',
  // Tab 切换
  'tab-lyrics',
  'tab-otp',
  // 动态口令
  'otp-pull',
  'otp-add',
  'otp-save',
  'otp-confirm-save',
  'otp-paste',
  'otp-paste-apply',
  'otp-edit-done',
  'otp-del-yes',
  'otp-export',
  'otp-export-close',
  'otp-dialog-close',
  'otp-offset-apply',
  'otp-offset-dismiss'
]

/** 带参数的动作前缀。 */
const PREFIXES = ['pick-device:', 'otp-edit:', 'otp-del:', 'otp-field:', 'otp-uri:']

/** 极端情况下宿主可能把按钮文案当事件数据传回来，作为最后兜底。 */
const LABEL_ACTIONS = {
  '选择 LRC 文件': 'pick-file',
  '发送到手环': 'send',
  '刷新设备': 'refresh-devices',
  '诊断': 'toggle-debug',
  '关闭诊断': 'toggle-debug',
  // Tab
  '歌词同步': 'tab-lyrics',
  '动态口令': 'tab-otp',
  // OTP
  '拉取数据': 'otp-pull',
  '添加账户': 'otp-add',
  '保存修改': 'otp-save',
  '确认保存': 'otp-confirm-save',
  '批量粘贴': 'otp-paste',
  '解析并导入': 'otp-paste-apply',
  '批量导出': 'otp-export'
}

/**
 * 是否是已知动作 id。
 */
export function isAction(id) {
  if (typeof id !== 'string' || !id) return false
  if (ACTIONS.indexOf(id) >= 0) return true
  for (let i = 0; i < PREFIXES.length; i++) {
    if (id.indexOf(PREFIXES[i]) === 0) return true
  }
  return false
}

/**
 * 从一个字符串里找动作（兼容宿主给动作 id 加前缀的情况）。
 */
function actionFromString(value) {
  if (typeof value !== 'string' || !value) return ''
  const label = LABEL_ACTIONS[value.trim()]
  if (label) return label
  for (let i = 0; i < ACTIONS.length; i++) {
    if (value.indexOf(ACTIONS[i]) >= 0) return ACTIONS[i]
  }
  for (let i = 0; i < PREFIXES.length; i++) {
    const at = value.indexOf(PREFIXES[i])
    if (at >= 0) {
      const rest = value.slice(at)
      // 动作 id 后面可能跟着 JSON 的引号/括号，截到第一个分隔符
      const hit = rest.match(new RegExp('^' + PREFIXES[i] + '[^\\s"\',}\\]]+'))
      return hit ? hit[0] : rest
    }
  }
  return ''
}

/**
 * 从 eventPayload 里解析动作。
 * 支持字符串、JSON 字符串、`{ id | action | value | name | data }`。
 */
function actionFromPayload(payload) {
  if (typeof payload === 'string') {
    if (isAction(payload)) return payload
    const direct = actionFromString(payload)
    if (direct) return direct
    try {
      return actionFromPayload(JSON.parse(payload))
    } catch (e) {
      return ''
    }
  }
  if (payload && typeof payload === 'object') {
    const keys = ['id', 'action', 'value', 'name', 'data']
    for (let i = 0; i < keys.length; i++) {
      const value = payload[keys[i]]
      if (typeof value === 'string' && isAction(value)) return value
    }
    for (let i = 0; i < keys.length; i++) {
      const value = payload[keys[i]]
      if (typeof value === 'string') {
        const hit = actionFromString(value)
        if (hit) return hit
      }
    }
  }
  return ''
}

/**
 * 解析本次 UI 事件对应的动作 id；解析不到返回空串。
 */
export function resolveAction(eventId, payload) {
  if (isAction(eventId)) return eventId
  const fromPayload = actionFromPayload(payload)
  if (fromPayload) return fromPayload
  return actionFromString(eventId)
}

export default { ACTIONS, PREFIXES, isAction, resolveAction }
