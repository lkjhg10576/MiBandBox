/**
 * 二维码导入文本清洗（手机插件侧）。
 *
 * 本期只支持「粘贴扫码文本」：用户在手机上识别二维码后复制文本，
 * 粘贴到插件的输入框，插件清洗后发到手环。
 *
 * 下一期接入 PNG 图片解码时，decodePng() 的结果也走同一个入口，
 * 因此本模块保持纯函数、零宿主依赖，可直接单测。
 */
import qrProtocol from './qrProtocol.js'

/**
 * 清洗一段待导入的二维码文本。
 *
 * 步骤：String() 归一 → 去掉所有 \r / \n → trim。
 * 空串返回 { ok:false, reason:'empty' }；
 * UTF-8 字节数超过 qrProtocol.MAX_TEXT_BYTES（512）返回 { ok:false, reason:'too-large' }。
 *
 * @param {string} text 原始文本
 * @returns {{ok: true, text: string} | {ok: false, reason: string}}
 */
export function clean(text) {
  const raw = String(text == null ? '' : text)
  const normalized = raw.replace(/[\r\n]/g, '').trim()
  if (!normalized) return { ok: false, reason: qrProtocol.ERRORS.EMPTY }
  if (qrProtocol.byteLength(normalized) > qrProtocol.MAX_TEXT_BYTES) {
    return { ok: false, reason: qrProtocol.ERRORS.TOO_LARGE }
  }
  return { ok: true, text: normalized }
}

export default { clean }
