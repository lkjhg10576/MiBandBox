/**
 * OTP 跨页会话态：详情页定位、编辑目标、导出目标。
 *
 * 本工具链每个页面打成独立 bundle，模块级变量不跨页共享；
 * 因此值挂到全局对象上（globalThis 在各页面 bundle 间是同一个对象），
 * 照 src/utils/marqueeState.js 形态。跨页传值不走 KV（异步读写会拿到旧值）。
 */

const g =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof global !== 'undefined'
      ? global
      : {}

const KEY = '__bandboxOtpSession'

function read() {
  const v = g[KEY]
  if (v && typeof v === 'object') return v
  return { editId: '', exportId: '' }
}

function write(next) {
  g[KEY] = { ...read(), ...(next || {}) }
}

export default {
  /** 详情页要看的账户 id */
  get currentId() {
    return read().currentId || ''
  },
  set currentId(v) {
    write({ currentId: String(v || '') })
  },
  /** 编辑页的目标账户 id（空 = 新建） */
  get editId() {
    return read().editId || ''
  },
  set editId(v) {
    write({ editId: String(v || '') })
  },
  /** 二维码导出的目标账户 id */
  get exportId() {
    return read().exportId || ''
  },
  set exportId(v) {
    write({ exportId: String(v || '') })
  }
}
