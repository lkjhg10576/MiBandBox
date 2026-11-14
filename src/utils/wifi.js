/**
 * WiFi 二维码串构造（纯函数，按 WiFi QR 规范拼串，可 Node 单测）。
 *
 * 格式：WIFI:T:<auth>;S:<ssid>;P:<pass>;;
 * 转义规则：反斜杠、分号、逗号、冒号、双引号五个字符前加反斜杠。
 * 开放网络（nopass）不带 P 段；隐藏网络追加 H:true 段。
 * 本模块零依赖，不依赖 @system.*。
 */

/**
 * UTF-8 字节长度（手写实现，不用 TextEncoder：手环环境没有）。
 */
export function byteLength(str) {
  const s = String(str == null ? '' : str)
  let len = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) len += 1
    else if (c < 0x800) len += 2
    else if (c >= 0xd800 && c <= 0xdbff) {
      len += 4
      i++
    } else len += 3
  }
  return len
}

/**
 * 转义 WiFi 串里的五个保留字符：反斜杠、分号、逗号、冒号、双引号（前加反斜杠）。
 */
function esc(value) {
  return String(value == null ? '' : value).replace(/([\\;,:"])/g, '\\$1')
}

/**
 * 构造 WiFi 二维码串。
 * auth 取 WPA / WEP / nopass，其它值一律按 WPA 处理；
 * hidden 为 true 时追加 H:true 段。
 * 调用方负责校验 ssid 非空与总长（字节 <= 600 且字符 <= 200）。
 */
export function buildWifi(opts) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const ssid = String(o.ssid == null ? '' : o.ssid)
  const pass = String(o.pass == null ? '' : o.pass)
  const auth = o.auth === 'WEP' || o.auth === 'nopass' ? o.auth : 'WPA'
  const hidden = o.hidden === true
  const parts = ['T:' + auth, 'S:' + esc(ssid)]
  if (auth !== 'nopass') parts.push('P:' + esc(pass))
  if (hidden) parts.push('H:true')
  return 'WIFI:' + parts.join(';') + ';;'
}

export default { byteLength, buildWifi }
