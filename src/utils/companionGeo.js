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
 * 精美样式（2026-11-22 第三版式，fancyFor/buildFancy，参考图表盘风）：三机型同一公式，
 * 时间居左（自绘粗 condensed 数字，2026-11-23 起为**反相遮罩位图** fdm_*.png，
 * 页面用「彩色底容器 + 黑色遮罩图」合成出任意取色的字形）
 * + 右栏「周几几号 / 目标日倒计时 / 分隔线 / 电量」；固定 HH:MM 无秒，
 * 由设置页「精美样式」开关经路由参数启用，简洁样式（上述两种版式）保持不变。
 *
 * 跑道屏（band10，212×520）与矩形屏（pro336，336×480）的应用可绘制高度都是 466
 * （theme.css：band10 的 y466 以下是系统栏/药丸收窄区；Pro 实测 480 − 14 系统栏）——
 * 旋转后 local x 对应这块高度，所以内容宽度只能用 466，用满 SCREEN.h 会让最后一位秒
 * 落进系统栏被裁掉（实测 9/0 的右半边缺失）。
 *
 * **药丸屏可见宽约束（2026-11-23 起）**：band10 / band9 的物理屏是跑道（胶囊）形，
 * 竖屏两端的圆角带逐行收窄 —— 旋转后，local x 小的一端（屏幕顶部）可见宽度不足整条高。
 * 若时间行贴 pad=14，数字上下角会落进圆角被边框削掉（用户实测报障）。
 * 所以 layoutFancy 同时试算 pad ∈ [14,56]：pad 越大，时间行左端离圆角越远、可见宽越大，
 * 但内容区越窄，两条约束取平衡：
 *   cap   ≤ 数字盒在 local x=pad 处的可见宽（盒纵向居中，圆角带按 sqrt(R²−d²) 收窄）；
 *   infoH ≤ 右栏右沿（local x=stripW−pad，底部圆角带）处的可见宽。
 * Pro（stripH ≥ 280）是矩形屏，可见宽恒 = stripH，约束不生效、pad 保持 14。
 * 圆角带中心：顶部在 y=0、底部在 y=物理屏高（band10 520 / band9 490）——
 * 可绘制高 466 之外还有 54px 已进入底部圆角带，所以函数要 screen.h。
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
import { SCREEN, COMPANION } from '../common/layout.js'

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
  hintFont: 12
}

/** 高横条（pro336）：上排日期行 / 下排大时间 */
const ROWS = {
  pad: 18,
  rowGap: 16,
  hintH: 14,
  hintFont: 12
}

/**
 * 精美样式（2026-11-22 第三版式，参考图表盘风，用户可选）：三机型同一套公式 ——
 * 时间居左（**反相遮罩位图** src/common/images/fdm_*.png：页面给每位数字一个彩色底容器 +
 * 一张黑色反相遮罩图，合成出任意取色的字形），右栏信息列自上而下：
 * 周几 + 几号 / 目标日倒计时 / 分隔线 / 电量徽标，全部左对齐。
 * 简洁样式的周几是红色；精美样式按参考图为白色。冒号是两个圆点 div，不占图片资产。
 *
 * 全部比例都从参考图（用户给的手环照片）量出来，归一化到「字高」：
 *   数字墨迹宽 0.322、笔画粗 0.106、字距 0.0625、冒号点径 0.098、点心距 0.32、
 *   右栏文字高 0.144 字高、右栏总高 0.68 字高、时间字高 0.75 屏高。
 * 字形真源是 tools/gen-assets/gen.py 的 _fd_glyph（设计坐标空间 58×180），
 * 出图时等比放大成 190 高的反相遮罩（FD_OUT_CAP），实测宽度见 FD_SRC_W。
 */
const FANCY = {
  /** 时间行左端/右栏右端的留白（自适应下限；layoutFancy 会在 [PAD_MIN,PAD_MAX] 里挑） */
  pad: 14,
  /** 时间区与右栏之间的最小余量（实际间隙由剩余空间决定，通常更大） */
  gapMin: 12,
  /** 字距（字高比例，参考图实测 0.0625） */
  trackRatio: 0.06,
  /** 冒号圆点直径 / 两点净间隙（字高比例；点心距 = 直径 + 净间隙 = 0.32） */
  dotRatio: 0.10,
  dotGapRatio: 0.22,
  /** 字高上限（屏高比例；参考图 0.75）。位图遮罩**只缩不放**：显示字高 ≤ FD_CAP（190），
   *  layoutFancy 会把 maxH 夹到 FD_CAP（Pro 正好取 190，band10 165 / band9 149 都更小）。 */
  hCap: 0.78,
  /** 日期行 / 倒计时行 / 电量字号 = 字高比例（实测：参考图白字墨迹高 0.144 字高，
   *  而中文字形墨迹只有字号的 ~0.85 → 字号比例取 0.17 才等效） */
  dateRatio: 0.17,
  midRatio: 0.16,
  batRatio: 0.145,
  /** 右栏行间隙 = 字高比例 */
  rowGapRatio: 0.05,
  hintH: 14,
  hintFont: 12
}

/** 时间行留白的自适应范围：pad 越大，时间行左端越远离药丸圆角、可见宽越大（换更大的字高）。 */
export const PAD_MIN = 14
export const PAD_MAX = 56

/** 字形源规格：**反相遮罩位图**（src/common/images/fdm_*.png）的实测墨迹宽表 + 出图字高。
 *  显示宽 = ceil(源宽 × 显示字高 / FD_CAP)（见 fancyWidths 的取整理由）；
 *  改字形要 gen.py（生成器打实测值）与本表两边同步。
 *  FD_CAP = 190 = Pro 的最大显示字高（band10 165 / band9 149 都只缩不放）。 */
export const FD_SRC_W = [61, 35, 61, 61, 61, 61, 61, 61, 61, 61]
export const FD_CAP = 190

/**
 * 彩色底相对数字容器（= 遮罩图画布 = 墨迹盒）的**内缩量**（px）。
 *
 * 真机渲染器在图像的远边（右/下）做半纹素采样时，会把遮罩边缘与图像外的透明区混合 →
 * 容器底色从 1px 边缘透出来，在数字右边缘/底边缘各显出一条 L 形彩色细线（2026-11-24 真机
 * 照片报障；模拟器 1:1 渲染复现不出）。修法是让**彩色底比容器内缩 1px**：图像最外圈的
 * 采样污染落在黑底（容器自身的 background-color = #000000）上，线就看不见了。
 *
 * 为什么不用「遮罩图加黑边 + 图放大到容器外」：2026-11-24 实测该做法在真机上触发了
 * Vela 对**旋转容器里绝对定位子图**的裁剪 —— 字形上下各被削掉一块（2 的圆弧顶变平）。
 * 图必须**正好铺满容器**（尺寸 = fw × digitH、不偏移、不做 absolute），不要再放大。
 *
 * 代价：字形在右/下最外 1px 没有底色（被黑底吃掉），是抗锯齿最外缘，肉眼基本看不出。
 */
export const FD_INSET = 1

/** 最宽数字的源墨迹宽（时间行宽试算用） */
const FD_MAX_SRC_W = Math.max.apply(null, FD_SRC_W)

/**
 * 每个数字在给定显示字高下的墨迹宽（「1」明显窄，其余同宽）。
 *
 * **必须向上取整（ceil）**：Vela 的 <image> 按高度等比缩放后画在盒子里，
 * 盒子比缩放后的宽度窄时，图像左缘会留出 ~0.2px 的缝 → 容器底色从缝里透出来，
 * 在数字左侧显出一条 1px 的淡色竖线（「1」最明显：它的宽高比与格子差得最多）。
 * 向上取整让盒子永远 ≥ 缩放后的宽度，图像左缘正好压住盒左 → 缝消失。
 * @param {number} cap 显示字高（px）
 * @returns {number[]} 10 个数字的显示宽
 */
export function fancyWidths(cap) {
  return FD_SRC_W.map((w) => Math.max(1, Math.ceil((w * cap) / FD_CAP)))
}

/** 应用可绘制高度（主题安全区）：band10 / pro336 实测 466；band9（192×490）竖屏收窄带同比例，436。
 *  真源在各 profile 的 layout.companion.drawableH（apply-profile 生成进 layout.js）。 */
const DRAWABLE_H = COMPANION.drawableH || 466

/** 横条高度 ≥ 280 视为「高横条」：band10 横条 212 / pro336 横条 336 分列两侧 */
const TALL_STRIP_MIN = 280

/**
 * 跑道（胶囊）屏在竖屏 y 处的可见半宽。
 * 物理屏宽 = stripH，两端圆角半径 pillR = stripH/2：顶部圆角带 y∈[0,pillR)、
 * 底部圆角带 y∈(screenH−pillR, screenH]，中间是整宽直边。
 * stripH ≥ 280（Pro 336）是矩形屏，没有收窄 → 恒 pillR。
 * @param {number} y 竖屏纵向坐标（旋转后 = local x）
 * @param {number} stripH 屏宽（旋转后横条高）
 * @param {number} screenH 物理屏高（band10 520 / band9 490；缺省按 stripH）
 */
export function visibleHalfAt(y, stripH, screenH) {
  const r = stripH / 2
  if (stripH >= TALL_STRIP_MIN) return r
  const total = screenH || stripH
  let d = 0
  if (y < r) d = r - y
  else if (y > total - r) d = y - (total - r)
  if (d > r) d = r
  if (d < 0) d = 0
  return Math.sqrt(r * r - d * d)
}

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
 * 精美样式在给定字高下的全部几何：时间行（上界）+ 右栏信息列。
 * 右栏宽 = 各行内容宽的max（日期组 / 倒计时 / 电量组）—— 列宽跟着内容走，
 * 分隔线铺满整列，文字左对齐（参考图口径）。
 */
function fancyMetrics(cap) {
  const p = FANCY
  // 数字显示宽 = 源墨迹宽等比缩放（每位数字宽窄不同，「1」明显窄）
  const digitW = Math.round((FD_MAX_SRC_W * cap) / FD_CAP)
  const track = Math.max(1, Math.round(cap * p.trackRatio))
  const dotD = Math.max(2, Math.round(cap * p.dotRatio))
  const dotGap = Math.max(2, Math.round(cap * p.dotGapRatio))
  const timeRowW = 4 * digitW + dotD + 4 * track

  const dateFont = Math.max(1, Math.round(cap * p.dateRatio))
  const dateLineH = Math.round(dateFont * 1.25)
  const midFont = Math.max(1, Math.round(cap * p.midRatio))
  const midLineH = Math.round(midFont * 1.25)
  const bat = batteryGeo(Math.max(1, Math.round(cap * p.batRatio)))

  // 日期行内部：周几（两字）+ 间隙 + 几号（两位数字格，单个数字居中）
  const weekW = Math.ceil(dateFont * 2) + 2
  const dateGap = Math.max(4, Math.round(dateFont * 0.3))
  const dayW = Math.ceil(dateFont * 1.24)
  // 倒计时行固定宽（最长「NNN天」= 3 数字 + 1 汉字 ≈ 2.8em），文本左对齐防抖动
  const midW = Math.ceil(midFont * 3)
  // 右栏宽：取各行内容最宽的一条（列随内容走，文字左对齐，不留空档）
  const infoW = Math.max(weekW + dateGap + dayW, midW, bat.batGroupW)

  const rowGap = Math.max(2, Math.round(cap * p.rowGapRatio))

  return {
    digitW,
    // 彩色底（.fInk）的尺寸：比容器右/下各内缩 FD_INSET，图像远边的采样污染落在黑底上
    inkH: Math.max(1, cap - FD_INSET),
    track,
    dotD,
    dotGap,
    timeRowW,
    dateFont,
    dateLineH,
    midFont,
    midLineH,
    weekW,
    dateGap,
    dayW,
    midW,
    infoW,
    rowGap,
    // 倒计时 + 间隙 + 分隔线的组高（无目标日时整组不渲染，右栏剩日期/电量两段居中）
    midGrpH: midLineH + rowGap + 2,
    // 右栏总高：日期 + 间隙 + (倒计时 + 间隙 + 分隔线 + 间隙) + 电量
    infoH: dateLineH + rowGap + midLineH + rowGap + 2 + rowGap + bat.batLineH,
    ...bat
  }
}

/**
 * 纵向居中、local y 长 h 的盒，在物理 x 上到屏中心的最大距离（含 floor 取整偏差）。
 * 物理 x = stripH − local y，所以盒范围 = [S − top − h, S − top]，top = floor((S − h)/2)。
 */
function boxHalf(stripH, h) {
  const top = Math.floor((stripH - h) / 2)
  const r = stripH / 2
  return Math.max(r - (stripH - top - h), stripH - top - r)
}

/**
 * 精美样式：时间居左（反相遮罩位图，紧排）+ 右栏信息列（周几几号 / 倒计时 / 分隔线 / 电量）。
 * 三机型同一公式，全部由 stripW/stripH 缩放导出。
 *
 * 字高与 pad 联合试算：
 *   1. 字高从 maxH = min(floor(stripH × hCap), FD_CAP) 递减 —— 位图遮罩只缩不放，
 *      FD_CAP = 190（Pro 的最大显示字高）就是上限，band10 165 / band9 149 更小、本就不受此限；
 *   2. 每个字高下，pad 从 PAD_MIN 往上找第一个同时满足三条约束的值：
 *      a. 时间行 + 右栏 + gapMin 放得进 stripW − 2×pad；
 *      b. 数字盒（纵向居中）在 local x = pad 处的可见宽足够（跑道屏圆角带）；
 *      c. 右栏（纵向居中）在 local x = stripW − pad 处的可见宽足够。
 * 数字/右栏都**纵向居中**（clock.ux 用绝对 top = floor((stripH − h)/2) 钉死，不靠 flex 居中），
 * 这样物理 x 范围 = pillR ± h/2，可见宽约束才与「盒中心 = 屏中心」的几何一致。
 *
 * @param {number} stripW 横条宽（= 可绘制高度 466 / band9 436）
 * @param {number} stripH 横条高（= 屏宽）
 * @param {number} screenH 物理屏高（band10 520 / band9 490；Pro 矩形屏用不到）
 */
function layoutFancy(stripW, stripH, screenH) {
  const p = FANCY
  const rowH = stripH - p.hintH - 2
  const maxH = Math.min(Math.floor(stripH * p.hCap), FD_CAP)

  let cap = 1
  let m = null
  let pad = PAD_MIN
  for (let h = maxH; h >= 1; h--) {
    const cand = fancyMetrics(h)
    // 数字盒 / 右栏都纵向居中：local y ∈ [(S−h)/2, (S+h)/2]，物理 x = stripH − local y。
    // 取整后盒中心可能偏离屏中心 0.5px → 用「盒两端到屏中心的最大距离」当所需可见半宽。
    const need = boxHalf(stripH, h)
    const needI = boxHalf(stripH, cand.infoH)
    for (let q = PAD_MIN; q <= PAD_MAX; q++) {
      const rw = stripW - q * 2
      if (cand.timeRowW + cand.infoW + p.gapMin > rw) continue
      if (need > visibleHalfAt(q, stripH, screenH)) continue
      if (needI > visibleHalfAt(stripW - q, stripH, screenH)) continue
      cap = h
      m = cand
      pad = q
      break
    }
    if (m) break
  }
  if (!m) m = fancyMetrics(1)

  const timeTop = Math.floor((stripH - cap) / 2)
  const infoTop = Math.floor((stripH - m.infoH) / 2)
  const rowW = stripW - pad * 2

  return {
    mode: 'fancy',
    stripW,
    stripH,
    padL: pad,
    padR: pad,
    rowW,
    rowH,
    hintH: p.hintH,
    hintFont: p.hintFont,
    digitH: cap,
    /** 数字盒 / 右栏的 margin-top（纵向居中；clock.ux 的 .fbody 是 align-items:flex-start） */
    timeTop,
    infoTop,
    colonW: m.dotD,
    timeW: m.timeRowW,
    gap: rowW - m.timeRowW - m.infoW,
    divW: m.infoW,
    ...m
  }
}

/**
 * 按给定屏幕算精美样式几何（导出给单测：各机型都算一遍，不必物化 profile）。
 * @param {{w:number,h:number}} screen 竖屏尺寸
 * @param {number} [drawableH] 可绘制高度（缺省取当前 profile 的 COMPANION.drawableH）
 */
export function fancyFor(screen, drawableH) {
  const dh = drawableH || DRAWABLE_H
  const stripW = Math.min(screen.h, dh)
  const stripH = screen.w
  return layoutFancy(stripW, stripH, screen.h)
}

/** 当前构建目标（band10 基线 / pro336 物化）的精美样式几何 */
export function buildFancy() {
  return fancyFor(SCREEN)
}

/**
 * 按给定屏幕算几何（导出给单测：各机型都算一遍，不必物化 profile）。
 * @param {{w:number,h:number}} screen 竖屏尺寸
 * @param {number} [drawableH] 可绘制高度（缺省取当前 profile 的 COMPANION.drawableH）
 */
export function layoutFor(screen, drawableH) {
  const dh = drawableH || DRAWABLE_H
  const stripW = Math.min(screen.h, dh)
  const stripH = screen.w
  return stripH >= TALL_STRIP_MIN ? layoutRows(stripW, stripH) : layoutCols(stripW, stripH)
}

/** 当前构建目标（band10 基线 / pro336 物化）的几何 */
export function build() {
  return layoutFor(SCREEN)
}

export default {
  build, buildFancy, layoutFor, fancyFor, visibleHalfAt, fancyWidths,
  FD_SRC_W, FD_CAP, FD_INSET, PAD_MIN, PAD_MAX
}