/**
 * 设备 profile 布局常量 —— 自动生成，勿手改。
 * 由 tools/apply-profile.mjs 按 profiles/band10.json 生成；
 * 源码基线是 band10（212×520 跑道屏），pro336 构建期物化为 336×480。
 */
export const PROFILE = "band10"
export const SCREEN = {"w":212,"h":520}
export const HOME = {"cols":2,"rowH":76,"padBottom":60}
export const MARQUEE = {"minCopyW":240}
export const IME = {"kbW":192,"containerH":305}

/** 首页网格内容高度：ceil(格子数 / 列数) * 行高 + 底部留白 */
export function gridHeight(count) {
  return Math.ceil(count / HOME.cols) * HOME.rowH + HOME.padBottom
}
