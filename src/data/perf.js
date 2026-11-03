/**
 * 性能参考分：自测/公开参数估算的参考值，仅用于横向比较，不代表绝对性能。
 *
 * 计分口径：
 *   综合分 = referenceScore × 基准总耗时 / 本次实测总耗时
 *
 * 不用“单项得分率加权平均”：单项（尤其数组排序）受 GC/预热影响会出现
 * 2 倍以上抖动，加权后会把单项异常放大成几十分的偏差。总耗时对单项抖动
 * 有天然的稀释作用，更适合手表这种小样本跑分。
 *
 * refMs 仍用于单项进度条展示；refTotalMs 由四项 refMs 求和得到。
 * calibrated=false 时，性能页只展示原始毫秒，不展示最终分，避免用未校准
 * 的基准误导用户。实测完成后把四项 refMs 填入并改为 true。
 */
const calibrated = true
const referenceScore = 132

const devices = [
  { name: '小米手环 8 Pro', score: 100 },
  { name: '小米手环 9', score: 118 },
  { name: '小米手环 9 Pro', score: 122 },
  { name: '小米手环 10', score: 132 },
  { name: '小米手环 10 Pro', score: 138 },
  { name: 'REDMI Watch 4', score: 108 },
  { name: 'REDMI Watch 5', score: 126 },
  { name: 'REDMI Watch 6', score: 140 },
  { name: 'Xiaomi Watch S3', score: 150 },
  { name: 'Xiaomi Watch S4', score: 168 },
  { name: 'Xiaomi Watch S5', score: 185 }
]

const tests = [
  { key: 'object', name: '对象访问', weight: 0.2, refMs: 1647 },
  { key: 'array', name: '数组操作', weight: 0.25, refMs: 314 },
  { key: 'math', name: '复杂数学', weight: 0.25, refMs: 2994 },
  { key: 'sort', name: '数组排序', weight: 0.3, refMs: 503 }
]

const refTotalMs = tests.reduce((sum, t) => sum + t.refMs, 0)

/**
 * 按实测结果计算综合分。
 * 未校准（refMs 仍为 0）时返回 0，页面只展示原始耗时。
 * @param {{key:string, ms:number, weight:number}[]} results
 */
function scoreFor(results) {
  if (!calibrated || refTotalMs <= 0) return 0
  const totalMs = (results || []).reduce((sum, r) => sum + Math.max(1, r.ms), 0)
  if (!totalMs) return 0
  return Math.max(1, Math.round((referenceScore * refTotalMs) / totalMs))
}

export default { devices, tests, calibrated, referenceScore, refTotalMs, scoreFor }
