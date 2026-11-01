/**
 * 文本输入工具：统一原生 input / textarea 的取值、换行和长度规则。
 * 纯 JS，不依赖 @system.*，可以在 Node 下单测。
 */

const MORSE_ALLOWED = /[^A-Z0-9 .,?'!\/()&:;=+\-_"$@]/g

/** 读取 change 事件的值：input 用 value，textarea 用 text。 */
export function eventValue(e) {
  if (!e) return ''
  if (e.value !== undefined) return e.value
  if (e.text !== undefined) return e.text
  if (e.detail) {
    if (e.detail.value !== undefined) return e.detail.value
    if (e.detail.text !== undefined) return e.detail.text
  }
  return ''
}

/** 统一换行；单行输入把换行替换为空格。 */
export function normalize(value, multiline) {
  let text = String(value == null ? '' : value).replace(/\r\n?/g, '\n')
  if (!multiline) text = text.replace(/\n/g, ' ')
  return text
}

/** 按现有字符计数口径裁剪长度（UTF-16 code unit）。 */
export function clamp(value, max, multiline) {
  const text = normalize(value, multiline)
  const limit = parseInt(max, 10)
  if (!limit || limit <= 0) return text
  return text.slice(0, limit)
}

/** 摩斯页只接受字母、数字、空格和常用符号。 */
export function sanitizeMorse(value) {
  return String(value == null ? '' : value)
    .toUpperCase()
    .replace(MORSE_ALLOWED, '')
}

/** 让原生输入框获得焦点（触发系统输入法）；不支持时静默失败。 */
export function focus(vm, id) {
  try {
    if (!vm || typeof vm.$element !== 'function') return
    const el = vm.$element(id)
    if (el && typeof el.focus === 'function') el.focus({ focus: true })
  } catch (e) {}
}

/** 收起输入法。 */
export function blur(vm, id) {
  try {
    if (!vm || typeof vm.$element !== 'function') return
    const el = vm.$element(id)
    if (el && typeof el.focus === 'function') el.focus({ focus: false })
  } catch (e) {}
}

export default { eventValue, normalize, clamp, sanitizeMorse, focus, blur }
