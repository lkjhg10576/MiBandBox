/**
 * 荧光棒调色板：36 个等距色相（每 10°）。
 *
 * 播放页（原生关键帧）与关键帧生成流程共用这一份数据，
 * 保证 @keyframes 里的颜色与 JS 兜底路径完全一致。
 */
export function hsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  const to = (v) => {
    const n = Math.round((v + m) * 255)
    return (n < 16 ? '0' : '') + n.toString(16)
  }
  return '#' + to(r) + to(g) + to(b)
}

/** 36 色循环调色板 */
export const PALETTE = []
for (let i = 0; i < 36; i++) PALETTE.push(hsl((i * 10) % 360, 0.92, 0.56))

/** 一个完整循环的毫秒数（每色 interval 毫秒） */
export function cycleMs(interval) {
  return interval * PALETTE.length
}

export default { PALETTE, hsl, cycleMs }
