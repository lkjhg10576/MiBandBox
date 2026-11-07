/**
 * 全局单例集合：整个 App 只有一份公共工具模块。
 *
 * 官方最佳实践：「公共模块挂 global」—— 工具链把每个页面打成独立 bundle，
 * 直接 import 会让 router/time/haptic/kv/fs/screen 在 59 个 bundle 里各有一份副本
 * （router 59 份、file 37 份、kv 23 份），既撑大包体又让各页的内存缓存互不可见。
 *
 * 规则：
 *   - 本文件**只在 app.ux 里 import**（模块顶层求值早于 onCreate，也早于任何页面创建）
 *   - 页面**绝不 import 本文件**，只用 src/utils/g.js 的 shim 取用
 */
import kv from './utils/kv'
import router from './utils/router'
import fs from './utils/fs'
import time from './utils/time'
import haptic from './utils/haptic'
import screen from './utils/screen'
import clock from './utils/clock'

const g =
  typeof global !== 'undefined'
    ? global
    : typeof globalThis !== 'undefined'
      ? globalThis
      : {}

g.__bb = { kv, router, fs, time, haptic, screen, clock }

export default g.__bb
