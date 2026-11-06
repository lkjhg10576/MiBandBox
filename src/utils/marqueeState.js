/**
 * 跑马灯配置的跨页传递：入口页 marquee/marqueeSet 写入，播放页 textShow 同步读取。
 *
 * 注意：本工具链把每个页面打成独立 bundle、各自带一份模块缓存，
 * 模块级变量并不跨页共享；因此值挂到全局对象上（globalThis/global
 * 在各页面 bundle 间是同一个对象），对外仍以 marqueeState.cfg 读写。
 * 不走 KV 传值是因为 KV 读写均为异步，播放页可能读到落盘前的旧配置
 * （KV 里残留的 marqueeMode='h' 因此会一直覆盖后续入口）；KV 仅用于
 * “记住上次配置”的持久化。
 */

/** 播放内容在内容区里重复的份数：4 份足够覆盖一个视口，滚动到底也不会露出空白 */
export const COPY_COUNT = 4

/** 一份内容块的最小宽度（px）：必须大于横屏视口 520 的三分之一，保证可滚动 */
const MIN_COPY_W = 240

/** 估算基准字号下限：<text> 的默认字号是 30px，
 *  首帧若动态 font-size 尚未生效也会是这个尺寸，按它算才不会撑破内容块 */
const BASE_FONT_SIZE = 30

/** 两份内容之间的空隙（单位 em） */
const GAP_EM = 1.2

const g =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof global !== 'undefined'
      ? global
      : {}

const KEY = '__bandboxMarqueeCfg'

/**
 * 单字符宽度系数（单位 em）。
 * 全角字符按 1.0（等宽），西文按经验值；估算只用于确定滚动周期，
 * 偏大只是多留一点空隙，偏小才会截字，所以西文取值偏保守。
 */
function charRatio(ch) {
  const code = ch.charCodeAt(0)
  if (code >= 0x4e00 && code <= 0x9fff) return 1.0 // CJK 统一表意文字
  if (code >= 0x3000 && code <= 0x303f) return 1.0 // CJK 标点
  if (code >= 0x3040 && code <= 0x30ff) return 1.0 // 假名
  if (code >= 0xac00 && code <= 0xd7af) return 1.0 // 谚文
  if (code >= 0xff00 && code <= 0xff60) return 1.0 // 全角形式
  if (code >= 0xffe0 && code <= 0xffe6) return 1.0 // 全角符号
  if (code === 32) return 0.3 // 半角空格
  if (code >= 48 && code <= 57) return 0.58 // 数字
  if (code >= 65 && code <= 90) return 0.68 // 大写字母
  if (code >= 97 && code <= 122) return 0.54 // 小写字母
  return 0.42 // 其它西文与标点
}

/**
 * 估算一段文字的渲染宽度（px）。
 * 系数 1.12 是字体度量差异的安全余量，1.06 是加粗带来的额外宽度。
 */
export function estimateTextWidth(text, fontSize) {
  const s = String(text || '')
  const size = Number(fontSize) || 30
  let em = 0
  for (let i = 0; i < s.length; i++) em += charRatio(s.charAt(i))
  return em * size * 1.12 * 1.06
}

/**
 * 一份内容块的宽度（px）——同时也是滚动的周期。
 * 内容块宽度固定后，滚动到周期边界回零的画面与起点完全一致，循环无缝。
 */
export function copyWidth(text, fontSize) {
  const size = Math.max(Number(fontSize) || BASE_FONT_SIZE, BASE_FONT_SIZE)
  const raw = estimateTextWidth(text, size) + GAP_EM * size
  return Math.max(MIN_COPY_W, Math.ceil(raw / 10) * 10)
}

export default {
  get cfg() {
    return g[KEY] || null
  },
  set cfg(v) {
    g[KEY] = v || null
  },
  COPY_COUNT,
  copyWidth,
  estimateTextWidth
}
