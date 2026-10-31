/**
 * 应用目录：首页顺序与路由。图标全部为工具自绘。
 */
const apps = [
  { id: 'calculator', name: '计算器', route: '/pages/calculator', icon: '/common/icons/calculator.png', desc: '四则运算 · 开方' },
  { id: 'notebook', name: '笔记本', route: '/pages/notebook/list', icon: '/common/icons/notebook.png', desc: '随手记 · 本地保存' },
  { id: 'fluorescence', name: '荧光棒', route: '/pages/fluorescence', icon: '/common/icons/fluorescence.png', desc: '彩色循环 · 氛围' },
  { id: 'daysmatter', name: '目标日', route: '/pages/daysmatter/list', icon: '/common/icons/daysmatter.png', desc: '倒数 · 纪念日' },
  { id: 'sentence', name: '每日一言', route: '/pages/sentence', icon: '/common/icons/sentence.png', desc: '一句话 · 换一条' },
  { id: 'password', name: '密码生成', route: '/pages/password', icon: '/common/icons/password.png', desc: '随机 · 收藏' },
  { id: 'answer', name: '答案之书', route: '/pages/answer', icon: '/common/icons/answer.png', desc: '摇一摇 · 看答案' },
  { id: 'vibrate', name: '振动器', route: '/pages/vibrate', icon: '/common/icons/vibrate.png', desc: '节奏 · 强度' },
  { id: 'time', name: '剩余时间', route: '/pages/time', icon: '/common/icons/time.png', desc: '今日 · 今年' },
  { id: 'storage', name: '存储空间', route: '/pages/storage', icon: '/common/icons/storage.png', desc: '已用 · 容量' },
  { id: 'fish', name: '木鱼', route: '/pages/fish', icon: '/common/icons/fish.png', desc: '敲一敲 · 静心' },
  { id: 'display', name: '显示测试', route: '/pages/display', icon: '/common/icons/display.png', desc: '纯色 · 坏点' },
  { id: 'flashlight', name: '红光手电', route: '/pages/flashlight', icon: '/common/icons/flashlight.png', desc: '高亮 · 护眼' },
  { id: 'cpsTest', name: '手速测试', route: '/pages/cpsTest', icon: '/common/icons/cpsTest.png', desc: '3 秒 · 点击次数' },
  { id: 'diet', name: '今日饮食', route: '/pages/diet', icon: '/common/icons/diet.png', desc: '吃什么 · 喝什么' },
  { id: 'random', name: '随机数', route: '/pages/random', icon: '/common/icons/random.png', desc: '区间 · 抽号' },
  { id: 'system', name: '系统信息', route: '/pages/system', icon: '/common/icons/system.png', desc: '型号 · 屏幕 · 版本' },
  { id: 'performance', name: '性能测试', route: '/pages/performance', icon: '/common/icons/performance.png', desc: '四项跑分 · 参考' },
  { id: 'history', name: '史载今日', route: '/pages/history', icon: '/common/icons/history.png', desc: '今天的科技文化' },
  { id: 'scoreboard', name: '记分牌', route: '/pages/scoreboard', icon: '/common/icons/scoreboard.png', desc: '红蓝 · 计时' },
  { id: 'morseCode', name: '摩斯密码', route: '/pages/morseCode', icon: '/common/icons/morseCode.png', desc: '点划 · 振动' },
  { id: 'wasteSorting', name: '垃圾分类', route: '/pages/wasteSorting', icon: '/common/icons/wasteSorting.png', desc: '查一查 · 怎么扔' },
  { id: 'qrcode', name: '快捷生码', route: '/pages/qrcode', icon: '/common/icons/qrcode.png', desc: '文本 · 二维码' },
  { id: 'marquee', name: '跑马灯', route: '/pages/marquee', icon: '/common/icons/marquee.png', desc: '滚动字幕 · 颜色' },
  { id: 'lylist', name: '歌词本', route: '/pages/lylist', icon: '/common/icons/lylist.png', desc: '本地歌词 · 滚动' },
  { id: 'level', name: '水平仪', route: '/pages/level', icon: '/common/icons/level.png', desc: '倾角 · 圆环' }
]

export default apps
