/**
 * 内置输入法文本工具：把键盘事件落到页面字段上。
 * 纯 JS，不依赖 @system.*，可以在 Node 下单测。
 */
import textInput from './textInput'

/** 追加键盘输出，按页面上限裁剪；单行把换行转空格。 */
export function append(value, content, max, multiline) {
  const current = String(value == null ? '' : value)
  const next = String(content == null ? '' : content)
  return textInput.clamp(current + next, max, multiline)
}

/** 删除最后一个字符。 */
export function backspace(value) {
  return String(value == null ? '' : value).slice(0, -1)
}

export default { append, backspace }
