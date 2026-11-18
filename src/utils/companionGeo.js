/**
 * 桌面伴侣横屏几何 —— 纯函数、无状态，由 SCREEN 算出，供 clock.ux 内联成 style（首帧即正确）。
 *
 * 旋转映射：(x, y) → (屏宽 − y, x)。条形内容（宽 = 屏高、高 = 屏宽）旋转 90° 后正好铺满屏幕：
 *   local x → 物理屏幕的纵向（0 在上），local y → 物理屏幕的横向（0 在右）。
 *
 * 跑道屏（band10，212×520）两端是圆弧：local x < 40 或 > 480 落在物理屏的圆角收窄区，
 * 所以左右 padding 取 40，让内容避开；矩形屏（pro336）没有圆弧，padding 取 16。
 *
 * 时间用 5 个定宽格（数字/数字/冒号/数字/数字）：格宽由字号 × 经验字宽系数向上取整，
 * 字号从大到小递减试算，取「4 个数字格 + 1 个冒号格 ≤ 时间列宽」的最大整数。
 * 定宽格同时消除「11:11 → 22:22」每分钟的横向抖动。
 * 字宽系数来自 marqueeState 的经验模型：数字 0.58em、冒号 0.42em，
 * 再乘字体度量余量 1.12 与加粗额外宽度 1.06（偏大只是多留空隙，偏小才会截字）。
 *
 * 所有数值都是整数；改版式时优先调对应机型常量，再跑 tools/test-companion-geo.mjs。
 */
import { SCREEN } from '../common/layout.js'

/** 数字格 / 冒号格的字宽（单位 em，含度量与加粗余量） */
const DIGIT_EM = 0.58 * 1.12 * 1.06
const COLON_EM = 0.42 * 1.12 * 1.06

/** 跑道屏（band10：212×520，横条 520×212）版式常量 */
const RUNWAY = {
  pad: 40,
  dateColW: 116,
  gap: 12,
  dayH: 96,
  weekH: 40,
  weekLineH: 40,
  weekFont: 32,
  timeRowH: 120,
  secH: 38,
  secLineH: 38,
  secFont: 30,
  hintH: 22,
  hintFont: 13
}

/** 矩形屏（pro336：336×480，横条 480×336）版式常量 */
const RECT = {
  pad: 16,
  dateColW: 132,
  gap: 12,
  dayH: 132,
  weekH: 56,
  weekLineH: 56,
  weekFont: 42,
  timeRowH: 140,
  secH: 48,
  secLineH: 48,
  secFont: 34,
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
  const stripW = H
  const stripH = W
  const p = W >= 300 ? RECT : RUNWAY

  const innerW = stripW - p.pad * 2
  const timeColW = innerW - p.dateColW - p.gap

  // 时间字号：递减试算，取满足「4 个数字格 + 冒号格 ≤ 时间列宽」的最大整数。
  // 整数 ceil 会溢出，不能用解方程直接取整（例：band10 理论值 95.6 取 96 就超 4px）。
  let timeFont = 0
  for (let f = Math.min(p.timeRowH, 200); f >= 1; f--) {
    if (4 * cellW(f, DIGIT_EM) + cellW(f, COLON_EM) <= timeColW) {
      timeFont = f
      break
    }
  }
  if (!timeFont) timeFont = 1

  const digitW = cellW(timeFont, DIGIT_EM)
  const colonW = cellW(timeFont, COLON_EM)
  const timeRowW = 4 * digitW + colonW

  // 几号最多两位：列宽 ÷ 两个字宽格
  let dayFont = Math.floor(p.dateColW / (2 * DIGIT_EM))
  if (dayFont < 1) dayFont = 1

  const rowH = stripH - p.hintH - BOTTOM_GAP
  const dateH = p.dayH + p.weekH
  const timeContentH = p.timeRowH + p.secH

  return {
    stripW,
    stripH,
    pad: p.pad,
    innerW,
    dateColW: p.dateColW,
    dateH,
    gap: p.gap,
    timeColW,
    timeFont,
    digitW,
    colonW,
    timeRowW,
    timeRowH: p.timeRowH,
    timeContentH,
    dayFont,
    dayH: p.dayH,
    weekH: p.weekH,
    weekLineH: p.weekLineH,
    weekFont: p.weekFont,
    secH: p.secH,
    secLineH: p.secLineH,
    secFont: p.secFont,
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