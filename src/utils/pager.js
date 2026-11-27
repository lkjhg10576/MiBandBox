/**
 * 长列表分页：固定每页 5 项，页面只渲染当前页。
 *
 * 收藏列表与选城列表原先一次物化全部条目（收藏几十张卡、城市首屏 40 个
 * list-item），手环上要 8~25s 才出首帧。分页后每页最多 5 个节点，
 * 翻页时按需重建，首帧只付出 5 项的代价。
 */
const SIZE = 5

function count(total) {
  const n = Math.ceil((total > 0 ? total : 0) / SIZE)
  return n > 0 ? n : 1
}

function clamp(page, pages) {
  const p = parseInt(page, 10)
  if (!p || p < 1) return 1
  if (p > pages) return pages
  return p
}

/** 当前页第一条在完整列表里的下标 */
function start(page) {
  const p = parseInt(page, 10)
  return (p > 1 ? p - 1 : 0) * SIZE
}

export default { SIZE, count, clamp, start }