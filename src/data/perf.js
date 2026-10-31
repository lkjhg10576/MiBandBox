/**
 * 性能参考分：自测/公开参数估算的参考值，仅用于横向比较，不代表绝对性能。
 */
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
  { key: 'object', name: '对象访问', weight: 0.2 },
  { key: 'array', name: '数组操作', weight: 0.25 },
  { key: 'math', name: '复杂数学', weight: 0.25 },
  { key: 'sort', name: '数组排序', weight: 0.3 }
]

export default { devices, tests }
