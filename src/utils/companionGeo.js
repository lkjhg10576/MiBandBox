/**
 * 桌面伴侣横屏几何 —— 纯函数、无状态，由 SCREEN 算出，供 clock.ux 内联成 style（首帧即正确）。
 *
 * 旋转映射：(x, y) → (屏宽 − y, x)。条形内容（宽 = 可绘制高度、高 = 屏宽）旋转 90° 后铺满屏幕：
 *   local x → 观看者视角的横向（左→右），local y → 纵向（上→下）。
 *
 * 两种版式（2026-11-19 第二次改版：按机型自适应，用户选定）：
 *   cols（矮横条，band10 466×212）：左列几号 + 周几（红色加粗），右列 HH:MM:SS + 电量徽标；
 *                                   两列上排/下排同高 → 时间与几号同顶、电量与周几同顶。
 *   rows（高横条，pro336 466×336）：上排「几号 + 周几 + 电量」占一行，下排整行大号 HH:MM:SS。
 * 两种版式共用同一个时间行（8 个定宽格：6 数字 + 2 冒号），关闭秒钟时只保留 5 格；
 * 行宽随之变窄并整组居中 → 时分整体向右平移、保持居中（用户口径）。
 *
 * 跑道屏（band10，212×520）与矩形屏（pro336，336×480）的应用可绘制高度都是 466
 * （theme.css：band10 的 y466 以下是系统栏/药丸收窄区；Pro 实测 480 − 14 系统栏）——
 * 旋转后 local x 对应这块高度，所以内容宽度只能用 466，用满 SCREEN.h 会让最后一位秒
 * 落进系统栏被裁掉（实测 9/0 的右半边缺失）。
 *
 * 左右留白的依据：可绘制区左端 = 竖屏顶部圆角（收窄），右端 = y466（圆角尚未开始）。
 * 圆角半径约 54（theme.css：y0..40 与 y466..500 是收窄带），横向 20px 处纵向可绘制带
 * 仍有 12..200 —— 内容纵向带（约 37..163）完全在带内，两列版式取 pad 20 即安全。
 *
 * 宽度是稀缺资源（8 个字符铺 466px），定宽格按实测墨迹取：
 *   band10 62px 截图数字墨迹最宽 0.50em、冒号 0.10em → 取 0.60em / 0.36em，
 *   每格两侧各留约 3px 静区，既不截字也不把数字挤在一起。
 * 字号从大到小递减试算，取「6 数字格 + 2 冒号格 ≤ 时间列宽」的最大整数；
 * 定宽格消除「11:11:11 → 22:22:22」每秒的横向抖动。
 *
 * 所有数值都是整数；改版式时优先调对应机型常量，再跑 tools/test-companion-geo.mjs。
 */
import { SCREEN } from '../common/layout.js'

/** 数字格 / 冒号格的字宽（单位 em，含粗体度量余量） */
const DIGIT_EM = 0.6
const COLON_EM = 0.36

/** 两列版式的列间距（日期列与时间列之间唯一的留白） */
const COL_GAP = 12

/** 矮横条（band10）：左列日期 / 右列时间 */
const COLS = {
  pad: 20,
  dateRatio: 0.224,
  hintH: 14,
  hintFont: 10
}

/** 高横条（pro336）：上排日期行 / 下排大时间 */
const ROWS = {
  pad: 18,
  rowGap: 16,
  hintH: 14,
  hintFont: 10
}

/** 应用可绘制高度（主题安全区）：两种机型实测都是 466 */
const DRAWABLE_H = 466

/** 横条高度 ≥ 280 视为「高横条」：band10 横条 212 / pro336 横条 336 分列两侧 */
const TALL_STRIP_MIN = 280

/** 时间/几号行盒 = 字号 × 1.2；周几行盒 = 字号 × 1.16 */
const TOP_LINE = 1.2
const WEEK_LINE = 1.16
/** 电量文字行盒 = 字号 × 1.3 */
const BAT_LINE = 1.3

/** 底部提示与横条底边之间留 2px，避免文字盒贴边 */
const BOTTOM_GAP = 2

function cellW(font, em) {
  return Math.ceil(font * em)
}

/** 8 格时间行宽度（HH:MM:SS） */
function timeRowW(font) {
  return 6 * cellW(font, DIGIT_EM) + 2 * cellW(font, COLON_EM)
}

/** 递减试算字号：取「8 格 ≤ maxW」的最大整数（整数 ceil 会溢出，不能解方程直接取整） */
function fitTimeFont(maxW, maxFont) {
  for (let f = maxFont; f >= 1; f--) {
    if (timeRowW(f) <= maxW) return f
  }
  return 1
}

/** 电量徽标组：闪电图标 + 百分比。百分比格按「100%」定宽，数字变化时组宽不抖动。 */
function batteryGeo(batFont) {
  const boltH = Math.round(batFont * 1.15)
  const boltW = Math.max(1, Math.round(boltH * 0.6))
  const batGap = Math.max(2, Math.round(batFont * 0.2))
  const pctW = Math.ceil(batFont * 2.75)
  return {
    batFont,
    batLineH: Math.round(batFont * BAT_LINE),
    boltW,
    boltH,
    batGap,
    pctW,
    batGroupW: boltW + batGap + pctW
  }
}

/**
 * 矮横条：左列几号 + 周几，右列 HH:MM:SS + 电量。
 * @param {number} stripW 横条宽（= 可绘制高度 466）
 * @param {number} stripH 横条高（= 屏宽 212）
 */
function layoutCols(stripW, stripH) {
  const p = COLS
  const rowW = stripW - p.pad * 2
  const dateColW = Math.round(rowW * p.dateRatio)
  const timeColW = rowW - dateColW - COL_GAP

  const timeFont = fitTimeFont(timeColW, Math.min(stripH, 200))
  const digitW = cellW(timeFont, DIGIT_EM)
  const colonW = cellW(timeFont, COLON_EM)

  // 几号最多两位：列宽 ÷ 两个数字格；字号不超过时间，保证同顶对齐时视觉一致
  const dayFont = Math.max(1, Math.min(timeFont, Math.floor(dateColW / (2 * DIGIT_EM))))
  // 周几两字：明显小于时间（参考图口径），同时不得超出日期列宽
  const weekFont = Math.max(1, Math.min(Math.round(timeFont * 0.68), Math.floor((dateColW - 4) / 2)))

  const bat = batteryGeo(Math.max(1, Math.round(timeFont * 0.45)))

  const topH = Math.max(Math.round(timeFont * TOP_LINE), dayFont + 4)
  const weekLineH = Math.round(weekFont * WEEK_LINE)
  const bottomH = Math.max(weekLineH, bat.batLineH + 2)
  const contentH = topH + bottomH

  return {
    mode: 'cols',
    rows: false,
    stripW,
    stripH,
    padL: p.pad,
    padR: p.pad,
    rowW,
    rowH: stripH - p.hintH - BOTTOM_GAP,
    hintH: p.hintH,
    hintFont: p.hintFont,
    timeFont,
    digitW,
    colonW,
    timeRowW: 6 * digitW + 2 * colonW,
    timeRowWNoSec: 4 * digitW + colonW,
    topH,
    dayFont,
    weekFont,
    weekLineH,
    dateColW,
    gap: COL_GAP,
    timeColW,
    bottomH,
    contentH,
    // 高横条版式的字段（cols 下不渲染，保留键名避免模板另一分支取到 undefined）
    dateRowW: 0,
    dateRowH: 0,
    rowGap: 0,
    dayW: 0,
    weekW: 0,
    dayWeekGap: 0,
    ...bat
  }
}

/**
 * 高横条：上排几号 + 周几（左）与电量（右），下排整行大号 HH:MM:SS。
 * @param {number} stripW 横条宽（= 可绘制高度 466）
 * @param {number} stripH 横条高（= 屏宽 336）
 */
function layoutRows(stripW, stripH) {
  const p = ROWS
  const rowW = stripW - p.pad * 2

  const timeFont = fitTimeFont(rowW, Math.min(stripH, 200))
  const digitW = cellW(timeFont, DIGIT_EM)
  const colonW = cellW(timeFont, COLON_EM)

  // 日期行字号约为时间的一半；几号与周几同一行，左对齐、电量贴右
  const dayFont = Math.max(1, Math.round(timeFont * 0.5))
  const weekFont = Math.max(1, Math.round(timeFont * 0.44))
  const dayW = cellW(dayFont, 2 * DIGIT_EM)
  const weekW = Math.max(Math.ceil(weekFont * 2) + 4, 1)
  const dayWeekGap = Math.max(4, Math.round(dayFont * 0.35))

  const bat = batteryGeo(Math.max(1, Math.round(timeFont * 0.34)))

  const topH = Math.round(timeFont * TOP_LINE)
  const dateRowH = Math.round(dayFont * 1.4)

  return {
    mode: 'rows',
    rows: true,
    stripW,
    stripH,
    padL: p.pad,
    padR: p.pad,
    rowW,
    rowH: stripH - p.hintH - BOTTOM_GAP,
    hintH: p.hintH,
    hintFont: p.hintFont,
    timeFont,
    digitW,
    colonW,
    timeRowW: 6 * digitW + 2 * colonW,
    timeRowWNoSec: 4 * digitW + colonW,
    topH,
    dayFont,
    weekFont,
    weekLineH: dateRowH,
    dateRowW: rowW,
    dateRowH,
    rowGap: p.rowGap,
    dayW,
    weekW,
    dayWeekGap,
    // 两列版式的字段（rows 下不渲染，保留键名避免模板另一分支取到 undefined）
    dateColW: 0,
    gap: 0,
    timeColW: 0,
    bottomH: 0,
    contentH: 0,
    ...bat
  }
}

/**
 * 按给定屏幕算几何（导出给单测：两机型都算一遍，不必物化 profile）。
 * @param {{w:number,h:number}} screen 竖屏尺寸
 */
export function layoutFor(screen) {
  const stripW = Math.min(screen.h, DRAWABLE_H)
  const stripH = screen.w
  return stripH >= TALL_STRIP_MIN ? layoutRows(stripW, stripH) : layoutCols(stripW, stripH)
}

/** 当前构建目标（band10 基线 / pro336 物化）的几何 */
export function build() {
  return layoutFor(SCREEN)
}

export default { build, layoutFor }