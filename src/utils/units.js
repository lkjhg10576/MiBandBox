/**
 * 单位换算内核：12 类物理量、约 100 个单位，纯 JS，零 @system.* 依赖。
 *
 * 系数全部来自国际单位制与各国法定计量定义的公开换算关系（公共领域常识事实），
 * 例如 1 in = 0.0254 m、1 lb = 0.45359237 kg、1 cal = 4.184 J、1 eV = 1.602176634e-19 J。
 * 不联网、不加载外部数据、不引入第三方依赖。
 *
 * 线性类别：base = v × from.factor；result = base / to.factor。
 * 温度类别：以摄氏度 °C 为基准，用 toBase / fromBase 做仿射变换（不能用 factor）。
 *
 * 与 src/utils/lunar.js / calendar.js 同形态，Node 可直接 import 单测。
 */

/** 每类恰好一个基准单位（base: true），其 factor === 1 或 toBase 为恒等变换。 */
const CATEGORIES = [
  {
    id: 'length',
    name: '长度',
    en: 'Length',
    defaults: { from: 'm', to: 'ft' },
    units: [
      { id: 'mm', name: '毫米', symbol: 'mm', factor: 0.001 },
      { id: 'cm', name: '厘米', symbol: 'cm', factor: 0.01 },
      { id: 'dm', name: '分米', symbol: 'dm', factor: 0.1 },
      { id: 'm', name: '米', symbol: 'm', factor: 1, base: true },
      { id: 'km', name: '千米', symbol: 'km', factor: 1000 },
      { id: 'inch', name: '英寸', symbol: 'in', factor: 0.0254 },
      { id: 'ft', name: '英尺', symbol: 'ft', factor: 0.3048 },
      { id: 'yd', name: '码', symbol: 'yd', factor: 0.9144 },
      { id: 'mi', name: '英里', symbol: 'mi', factor: 1609.344 },
      { id: 'nmi', name: '海里', symbol: 'nmi', factor: 1852 },
      { id: 'chi', name: '市尺', symbol: '尺', factor: 1 / 3 },
      { id: 'cun', name: '市寸', symbol: '寸', factor: 1 / 30 },
      { id: 'zhang', name: '丈', symbol: '丈', factor: 10 / 3 }
    ]
  },
  {
    id: 'mass',
    name: '质量',
    en: 'Mass',
    defaults: { from: 'kg', to: 'lb' },
    units: [
      { id: 'mg', name: '毫克', symbol: 'mg', factor: 1e-6 },
      { id: 'g', name: '克', symbol: 'g', factor: 0.001 },
      { id: 'kg', name: '千克', symbol: 'kg', factor: 1, base: true },
      { id: 't', name: '吨', symbol: 't', factor: 1000 },
      { id: 'jin', name: '市斤', symbol: '斤', factor: 0.5 },
      { id: 'liang', name: '两', symbol: '两', factor: 0.05 },
      { id: 'lb', name: '磅', symbol: 'lb', factor: 0.45359237 },
      { id: 'oz', name: '盎司', symbol: 'oz', factor: 0.028349523125 },
      { id: 'st', name: '英石', symbol: 'st', factor: 6.35029318 }
    ]
  },
  {
    id: 'time',
    name: '时间',
    en: 'Time',
    defaults: { from: 'h', to: 'min' },
    units: [
      { id: 'ms', name: '毫秒', symbol: 'ms', factor: 0.001 },
      { id: 's', name: '秒', symbol: 's', factor: 1, base: true },
      { id: 'min', name: '分钟', symbol: 'min', factor: 60 },
      { id: 'h', name: '小时', symbol: 'h', factor: 3600 },
      { id: 'd', name: '天', symbol: 'd', factor: 86400 },
      { id: 'w', name: '周', symbol: 'w', factor: 604800 },
      { id: 'mo', name: '月', symbol: '月', factor: 2592000, note: '按 30 天' },
      { id: 'yr', name: '年', symbol: '年', factor: 31536000, note: '按 365 天' }
    ]
  },
  {
    id: 'area',
    name: '面积',
    en: 'Area',
    defaults: { from: 'm2', to: 'mu' },
    units: [
      { id: 'mm2', name: '平方毫米', symbol: 'mm²', factor: 1e-6 },
      { id: 'cm2', name: '平方厘米', symbol: 'cm²', factor: 1e-4 },
      { id: 'm2', name: '平方米', symbol: 'm²', factor: 1, base: true },
      { id: 'km2', name: '平方千米', symbol: 'km²', factor: 1e6 },
      { id: 'ha', name: '公顷', symbol: 'ha', factor: 10000 },
      { id: 'mu', name: '亩', symbol: '亩', factor: 10000 / 15 },
      { id: 'in2', name: '平方英寸', symbol: 'in²', factor: 0.00064516 },
      { id: 'ft2', name: '平方英尺', symbol: 'ft²', factor: 0.09290304 },
      { id: 'mi2', name: '平方英里', symbol: 'mi²', factor: 2589988.110336 },
      { id: 'acre', name: '英亩', symbol: 'acre', factor: 4046.8564224 }
    ]
  },
  {
    id: 'volume',
    name: '体积',
    en: 'Volume',
    defaults: { from: 'L', to: 'gal' },
    units: [
      { id: 'mL', name: '毫升', symbol: 'mL', factor: 0.001 },
      { id: 'L', name: '升', symbol: 'L', factor: 1, base: true },
      { id: 'm3', name: '立方米', symbol: 'm³', factor: 1000 },
      { id: 'cm3', name: '立方厘米', symbol: 'cm³', factor: 0.001 },
      { id: 'in3', name: '立方英寸', symbol: 'in³', factor: 0.016387064 },
      { id: 'ft3', name: '立方英尺', symbol: 'ft³', factor: 28.316846592 },
      { id: 'gal', name: '加仑(美)', symbol: 'gal', factor: 3.785411784 },
      { id: 'pt', name: '品脱(美)', symbol: 'pt', factor: 0.473176473 },
      { id: 'floz', name: '液量盎司(美)', symbol: 'fl oz', factor: 0.0295735295625 }
    ]
  },
  {
    id: 'temperature',
    name: '温度',
    en: 'Temperature',
    defaults: { from: 'c', to: 'f' },
    units: [
      {
        id: 'c',
        name: '摄氏度',
        symbol: '°C',
        factor: 1, // 基准标记；温度换算走 toBase/fromBase，不用 factor
        base: true,
        toBase: (v) => v,
        fromBase: (c) => c
      },
      {
        id: 'f',
        name: '华氏度',
        symbol: '°F',
        toBase: (v) => (v - 32) * 5 / 9,
        fromBase: (c) => c * 9 / 5 + 32
      },
      {
        id: 'k',
        name: '开尔文',
        symbol: 'K',
        toBase: (v) => v - 273.15,
        fromBase: (c) => c + 273.15
      }
    ]
  },
  {
    id: 'speed',
    name: '速度',
    en: 'Speed',
    defaults: { from: 'kmh', to: 'mps' },
    units: [
      { id: 'mps', name: '米/秒', symbol: 'm/s', factor: 1, base: true },
      { id: 'kmh', name: '千米/时', symbol: 'km/h', factor: 1 / 3.6 },
      { id: 'mph', name: '英里/时', symbol: 'mph', factor: 0.44704 },
      { id: 'kn', name: '节', symbol: 'kn', factor: 1852 / 3600 },
      { id: 'ftps', name: '英尺/秒', symbol: 'ft/s', factor: 0.3048 }
    ]
  },
  {
    id: 'data',
    name: '数据',
    en: 'Data',
    defaults: { from: 'MB', to: 'MiB' },
    units: [
      { id: 'bit', name: '比特', symbol: 'b', factor: 0.125 },
      { id: 'B', name: '字节', symbol: 'B', factor: 1, base: true },
      { id: 'KB', name: '千字节', symbol: 'KB', factor: 1000 },
      { id: 'MB', name: '兆字节', symbol: 'MB', factor: 1e6 },
      { id: 'GB', name: '吉字节', symbol: 'GB', factor: 1e9 },
      { id: 'TB', name: '太字节', symbol: 'TB', factor: 1e12 },
      { id: 'KiB', name: '千字节', symbol: 'KiB', factor: 1024, note: '1024 进制' },
      { id: 'MiB', name: '兆字节', symbol: 'MiB', factor: 1048576, note: '1024 进制' },
      { id: 'GiB', name: '吉字节', symbol: 'GiB', factor: 1073741824, note: '1024 进制' },
      { id: 'TiB', name: '太字节', symbol: 'TiB', factor: 1099511627776, note: '1024 进制' }
    ]
  },
  {
    id: 'pressure',
    name: '压力',
    en: 'Pressure',
    defaults: { from: 'atm', to: 'kPa' },
    units: [
      { id: 'Pa', name: '帕', symbol: 'Pa', factor: 1, base: true },
      { id: 'kPa', name: '千帕', symbol: 'kPa', factor: 1000 },
      { id: 'MPa', name: '兆帕', symbol: 'MPa', factor: 1e6 },
      { id: 'bar', name: '巴', symbol: 'bar', factor: 100000 },
      { id: 'atm', name: '标准大气压', symbol: 'atm', factor: 101325 },
      { id: 'mmHg', name: '毫米汞柱', symbol: 'mmHg', factor: 133.322387415 },
      { id: 'psi', name: '磅力每平方英寸', symbol: 'psi', factor: 6894.757293168361 },
      { id: 'kgfcm2', name: '千克力每平方厘米', symbol: 'kgf/cm²', factor: 98066.5 }
    ]
  },
  {
    id: 'energy',
    name: '能量',
    en: 'Energy',
    defaults: { from: 'kWh', to: 'J' },
    units: [
      { id: 'J', name: '焦耳', symbol: 'J', factor: 1, base: true },
      { id: 'kJ', name: '千焦', symbol: 'kJ', factor: 1000 },
      { id: 'cal', name: '卡', symbol: 'cal', factor: 4.184 },
      { id: 'kcal', name: '千卡', symbol: 'kcal', factor: 4184 },
      { id: 'Wh', name: '瓦时', symbol: 'Wh', factor: 3600 },
      { id: 'kWh', name: '千瓦时', symbol: 'kWh', factor: 3.6e6 },
      { id: 'eV', name: '电子伏', symbol: 'eV', factor: 1.602176634e-19 },
      { id: 'BTU', name: '英热单位', symbol: 'BTU', factor: 1055.05585262 },
      { id: 'ftlb', name: '英尺磅', symbol: 'ft·lb', factor: 1.3558179483314004 }
    ]
  },
  {
    id: 'power',
    name: '功率',
    en: 'Power',
    defaults: { from: 'kW', to: 'hp' },
    units: [
      { id: 'W', name: '瓦', symbol: 'W', factor: 1, base: true },
      { id: 'kW', name: '千瓦', symbol: 'kW', factor: 1000 },
      { id: 'MW', name: '兆瓦', symbol: 'MW', factor: 1e6 },
      { id: 'PS', name: '马力(公制)', symbol: 'PS', factor: 735.49875 },
      { id: 'hp', name: '马力(英制)', symbol: 'hp', factor: 745.6998715822702 },
      { id: 'calps', name: '卡/秒', symbol: 'cal/s', factor: 4.184 },
      { id: 'kcalph', name: '千卡/时', symbol: 'kcal/h', factor: 1.1638888888888888 },
      { id: 'BTUph', name: '英热单位/时', symbol: 'BTU/h', factor: 0.2930710701722222 }
    ]
  },
  {
    id: 'frequency',
    name: '频率',
    en: 'Frequency',
    defaults: { from: 'MHz', to: 'kHz' },
    units: [
      { id: 'Hz', name: '赫兹', symbol: 'Hz', factor: 1, base: true },
      { id: 'kHz', name: '千赫', symbol: 'kHz', factor: 1000 },
      { id: 'MHz', name: '兆赫', symbol: 'MHz', factor: 1e6 },
      { id: 'GHz', name: '吉赫', symbol: 'GHz', factor: 1e9 },
      // r/s 与 Hz 物理等价，factor 同为 1；基准仍以 base 标记唯一确定
      { id: 'rps', name: '转/秒', symbol: 'r/s', factor: 1 },
      { id: 'rpm', name: '转/分', symbol: 'rpm', factor: 1 / 60 }
    ]
  }
]

/** 按 id 取类别，找不到返回 null。 */
function category(id) {
  for (let i = 0; i < CATEGORIES.length; i++) {
    if (CATEGORIES[i].id === id) return CATEGORIES[i]
  }
  return null
}

/** 取该类别的单位数组，找不到返回空数组。 */
function unitsOf(categoryId) {
  const cat = category(categoryId)
  return cat ? cat.units : []
}

/** 在类别里按 id 找单位。 */
function unit(cat, id) {
  if (!cat) return null
  for (let i = 0; i < cat.units.length; i++) {
    if (cat.units[i].id === id) return cat.units[i]
  }
  return null
}

/** 该类别的基准单位（非线性类别也用它做往返校验）。 */
function baseUnit(cat) {
  for (let i = 0; i < cat.units.length; i++) {
    if (cat.units[i].base) return cat.units[i]
  }
  return null
}

/**
 * 数值换算。非法类别 / 单位 / 输入一律返回 NaN。
 * 温度走 toBase → fromBase；其余类别走 factor。
 */
function convert(catId, fromId, toId, value) {
  const cat = category(catId)
  if (!cat) return NaN
  const from = unit(cat, fromId)
  const to = unit(cat, toId)
  if (!from || !to || typeof value !== 'number' || !isFinite(value)) return NaN
  if (typeof from.toBase === 'function' && typeof to.fromBase === 'function') {
    return to.fromBase(from.toBase(value))
  }
  if (typeof from.factor !== 'number' || typeof to.factor !== 'number') return NaN
  return value * from.factor / to.factor
}

/** 去掉小数尾部多余的 0 与孤立的小数点。 */
function trimZeros(s) {
  if (s.indexOf('.') < 0) return s
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

/**
 * 结果格式化：
 *  - 12 位有效数字截断去浮点噪声，再去掉尾随 0；整数不带小数点
 *  - |v| ≥ 1e12 或 0 < |v| < 1e-6 → 6 位有效数字的科学计数
 *  - 非有限数显示「—」，-0 归一为 0
 */
function formatValue(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '—'
  if (v === 0) return '0'
  const av = Math.abs(v)
  if (av >= 1e12 || av < 1e-6) {
    // toExponential(5) = 1 位整数 + 5 位小数 = 6 位有效数字
    const parts = v.toExponential(5).split('e')
    return trimZeros(parts[0]) + 'e' + parts[1]
  }
  return trimZeros(v.toPrecision(12))
}

/**
 * 解析自绘数字键盘的输入串：可选负号 + 数字 + 至多一个小数点。
 * 键盘的「−」是 U+2212，先归一成 ASCII '-'。非法串返回 NaN。
 */
function parseInput(str) {
  if (typeof str !== 'string') return NaN
  const s = str.replace(/\u2212/g, '-').trim()
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return NaN
  const n = Number(s)
  return isFinite(n) ? n : NaN
}

export { CATEGORIES, category, unitsOf, convert, formatValue, parseInput, unit, baseUnit }

export default { CATEGORIES, category, unitsOf, convert, formatValue, parseInput, unit, baseUnit }
