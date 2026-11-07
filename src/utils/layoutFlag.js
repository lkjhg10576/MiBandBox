/**
 * 首页布局标志：2–4 字节的独立文件，供 app 启动时在读完整份 KV 之前就知道用哪种布局。
 *
 * 目的：首帧等待时间从「读 + JSON.parse 整份 store.json」降到「读几字节」，
 * 同时保留 layoutReady 门控（列表模式用户仍不会看到网格闪现）。
 *
 * 注意：这份文件与 kv 里的 'home' 键必须同步写（见 hset.ux 切换布局处）。
 */
import g from './g'

const PATH = 'internal://files/bandbox/layout.txt'

/**
 * 读布局标志
 * @param {Function} cb 回调参数为 'grid' / 'list' / ''（读不到时为空串）
 */
export function read(cb) {
  try {
    g.fs.readText(PATH, (text) => {
      const v = text ? String(text).trim() : ''
      cb(v === 'list' ? 'list' : v === 'grid' ? 'grid' : '')
    })
  } catch (e) {
    cb('')
  }
}

/**
 * 写布局标志
 * @param {String} mode 'grid' / 'list'
 */
export function write(mode) {
  try {
    g.fs.writeText(PATH, mode === 'list' ? 'list' : 'grid')
  } catch (e) {}
}

export default { read, write, PATH }
