/**
 * 工具分类表：首页「分类单栏」模式的成员关系单一真源。
 *
 * 为什么单独一份而不是给 apps.js 加 cat 字段：
 *   apps.js 的数组顺序是模拟器脚本（shoot-routes.py / motion-sim.py / cube-sim.py）的
 *   index 导航依据，也是 tools/perf-audit.mjs 的节点计数依据。若 apps 挂 cat 字段、
 *   分类表再写一遍成员，就是双份真源，必然漂移。
 *
 * 不用 .find( / .includes(：src 全仓零处使用这两个方法，不引入未在 Vela 引擎上
 * 验证过的 ES 方法；用 for 循环 + forEach + 索引表（均为仓库既有写法）。
 */
import apps from './apps.js'

const CATS = [
  { id: 'calc',   name: '计算换算', icon: '/common/icons/catCalc.png',   tools: ['calculator', 'unitconvert', 'datecalc'] },
  { id: 'time',   name: '时间日期', icon: '/common/icons/catTime.png',   tools: ['calendar', 'daysmatter', 'time', 'companion', 'timezone'] },
  { id: 'chance', name: '随机决定', icon: '/common/icons/catChance.png', tools: ['random', 'lightRandom', 'answer', 'diet'] },
  { id: 'light',  name: '灯光字幕', icon: '/common/icons/catLight.png',  tools: ['fluorescence', 'flashlight', 'marquee', 'num', 'colorcard'] },
  { id: 'sound',  name: '声音振动', icon: '/common/icons/catSound.png',  tools: ['vibrate', 'metronome', 'tapTempo', 'morseCode'] },
  { id: 'code',   name: '编码安全', icon: '/common/icons/catCode.png',   tools: ['qrcode', 'otp', 'password'] },
  { id: 'test',   name: '检测测量', icon: '/common/icons/catTest.png',   tools: ['level', 'cpsTest', 'performance', 'display', 'storage', 'system'] },
  { id: 'play',   name: '趣味计数', icon: '/common/icons/catPlay.png',   tools: ['fish', 'motion', 'cubeTimer', 'scoreboard', 'counter'] },
  { id: 'read',   name: '记录查询', icon: '/common/icons/catRead.png',   tools: ['notebook', 'lylist', 'sentence', 'history', 'dailytip', 'wasteSorting'] }
]

/** 首页分类行：desc 用工具数，永远与成员表一致，不会随工具增减而说错 */
const rows = CATS.map((c) => ({ id: c.id, cat: c.id, name: c.name, icon: c.icon, desc: c.tools.length + ' 个工具' }))

const BY_ID = {}
apps.forEach((a) => { BY_ID[a.id] = a })

function category(id) {
  for (let i = 0; i < CATS.length; i++) if (CATS[i].id === id) return CATS[i]
  return null
}

function toolsOf(id) {
  const c = category(id)
  if (!c) return []
  const out = []
  c.tools.forEach((tid) => { if (BY_ID[tid]) out.push(BY_ID[tid]) })
  return out
}

export default { CATS, rows, category, toolsOf }
