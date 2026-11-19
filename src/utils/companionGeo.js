/**
 * 桌面伴侣横屏几何 —— 纯函数、无状态，由 SCREEN 算出，供 clock.ux 内联成 style（首帧即正确）。
 *
 * 旋转映射：(x, y) → (屏宽 − y, x)。条形内容（宽 = 屏高、高 = 屏宽）旋转 90° 后正好铺满屏幕：
 *   local x → 观看者视角的横向（左→右），local y → 纵向（上→下）。
 *
 * 版式（2026-11-19 改版，按用户给的参考图）：
 *   左列日期：几号（大数字）在上、周几（红色加粗）在下；
 *   右列时间：HH:MM:SS 一整行（6 个数字格 + 2 个冒号格，秒与时分同字号）在上、电量在下。
 *   两列都按「上排 / 下排」两行做且行高相同 —— 用户要求时间与几号同顶对齐、电量与周几同顶对齐。
 *
 * 跑道屏（band10，212×520）与矩形屏（pro336，336×480）的应用可绘制高度都是 466
 * （theme.css：band10 的 y466 以下是系统栏/药丸收窄区；Pro 实测 480 − 14 系统栏）——
 * 旋转后 local x 对应这块高度，所以内容宽度只能用 466，用满 SCREEN.h 会让最后一位秒
 * 落进系统栏被裁掉（实测 9/0 的右半边缺失）。band10 左右 pad 取 24：
 * 药丸圆角在观看者左右两端，而文字实际所在的纵向带远离圆角最窄处，24px 已留足余量。
 *
 * 注意 Vela 的宽度是 content-box：行上写 width: 520px + padding 0 40px 会变成 600px 总宽，
 * 居中后内容整体左移 40（实测截图：日期贴到圆弧边、右侧空 80px）。所以 padding 不能写在行上，
 * 改为行宽 = 内宽、由父容器居中 —— 老的 0 40px 写法正是这个坑。
 *
 * 时间仍是 8 个定宽格：数字格宽由字号 × 经验字宽系数向上取整，字号从大到小递减试算，
 * 取「6 个数字格 + 2 个冒号格 ≤ 时间列宽」的最大整数。定宽格消除「11:11:11 → 22:22:22」
 * 每秒的横向抖动。字宽系数沿用 marqueeState 的经验模型：数字 0.58em、冒号 0.42em，
 * 再乘字体度量余量 1.12 与加粗额外宽度 1.06（偏大只是多留空隙，偏小才会截字）。
 *
 * 日期列宽取内宽的 20.5%（参考图里「19」宽约等于「21:49:52」的 22%），
 * 几号字号由「两格数字 ≤ 日期列宽」反推 —— 新方案下与时间字号基本相等，视觉更接近参考图。
 *
 * 所有数值都是整数；改版式时优先调对应机型常量，再跑 tools/test-companion-geo.mjs。
 */
import { SCREEN } from '../common/layout.js'

/** 数字格 / 冒号格的字宽（单位 em，含度量与加粗余量） */
const DIGIT_EM = 0.58 * 1.12 * 1.06
const COLON_EM = 0.42 * 1.12 * 1.06

/** 日期列占内宽的比例（参考图：日期数字块 ≈ 时间行的 22%） */
const DATE_COL_RATIO = 0.205

/** 应用可绘制高度（主题安全区）：两种机型实测都是 466 */
const DRAWABLE_H = 466

/** 跑道屏（band10：212×520，横条 466×212）版式常量 */
const RUNWAY = {
  pad: 24,
  gap: 12,
  hintH: 22,
  hintFont: 13
}

/** 矩形屏（pro336：336×480，横条 466×336）版式常量 */
const RECT = {
  pad: 16,
  gap: 12,
  hintH: 22,
  hintFont: 13
}

/** 底部提示与横条底边之间留 4px，避免文字盒贴边 */
const BOTTOM_GAP = 4

function cellW(font, em) {
  return Math.ceil(font * em)
}

/**
 * 按给定屏幕算几何（导出给单测：两机型都算一遍，不必物化 profile）。
 * @param {{w:number,h:number}} screen 竖屏尺寸
 */
export function layoutFor(screen) {
  const W = screen.w
  const H = screen.h
  const stripW = Math.min(H, DRAWABLE_H)
  const stripH = W
  const p = W >= 300 ? RECT : RUNWAY

  const innerW = stripW - p.pad * 2
  const dateColW = Math.round(innerW * DATE_COL_RATIO)
  const gap = p.gap
  const timeColW = innerW - dateColW - gap

  // 时间字号：递减试算，取满足「6 个数字格 + 2 个冒号格 ≤ 时间列宽」的最大整数。
  // 整数 ceil 会溢出，不能用解方程直接取整。
  let timeFont = 0
  for (let f = Math.min(stripH, 200); f >= 1; f--) {
    if (6 * cellW(f, DIGIT_EM) + 2 * cellW(f, COLON_EM) <= timeColW) {
      timeFont = f
      break
    }
  }
  if (!timeFont) timeFont = 1

  const digitW = cellW(timeFont, DIGIT_EM)
  const colonW = cellW(timeFont, COLON_EM)
  const timeRowW = 6 * digitW + 2 * colonW

  // 几号最多两位：列宽 ÷ 两个字宽格
  let dayFont = Math.floor(dateColW / (2 * DIGIT_EM))
  if (dayFont < 1) dayFont = 1

  // 周几两字：比时间略小（参考图里明显小于数字），同时不得超出日期列宽
  let weekFont = Math.min(Math.floor(timeFont * 0.68), Math.floor((dateColW - 4) / 2))
  if (weekFont < 1) weekFont = 1

  // 上排（几号 / 时间）行高：字号 1.2 倍，两列共用 —— 同字号 + 同行高 = 字顶严格对齐
  const topH = Math.max(Math.round(timeFont * 1.2), dayFont + 4)

  // 下排（周几 / 电量）行高：周几行盒与电量行盒取较高者，两列共用
  const weekLineH = Math.round(weekFont * 1.16)
  const batFont = Math.max(1, Math.round(timeFont * 0.45))
  const batLineH = Math.round(batFont * 1.3)
  const bottomH = Math.max(weekLineH, batLineH + 2)

  const contentH = topH + bottomH
  const rowH = stripH - p.hintH - BOTTOM_GAP

  // 电量徽标：闪电图标 + 百分比。百分比格按「100%」定宽，数字变化时组宽不抖动。
  const boltH = Math.round(batFont * 1.15)
  const boltW = Math.max(1, Math.round(boltH * 0.6))
  const batGap = Math.max(2, Math.round(batFont * 0.2))
  const pctW = Math.ceil(batFont * 2.75)
  const batGroupW = boltW + batGap + pctW

  return {
    stripW,
    stripH,
    pad: p.pad,
    innerW,
    rowW: innerW,
    dateColW,
    dateH: contentH,
    gap,
    timeColW,
    timeFont,
    digitW,
    colonW,
    timeRowW,
    topH,
    bottomH,
    contentH,
    dayFont,
    weekFont,
    weekLineH,
    batFont,
    batLineH,
    boltW,
    boltH,
    batGap,
    pctW,
    batGroupW,
    hintH: p.hintH,
    hintFont: p.hintFont,
    rowH
  }
}

/** 当前构建目标（band10 基线 / pro336 物化）的几何 */
export function build() {
  return layoutFor(SCREEN)
}

export default { build, layoutFor }