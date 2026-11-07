/**
 * 每日一言语料：包内 .txt 资源，异步读取 + 进程内缓存。
 *
 * 外置原因（计划 L4-5）：1000 条一言原本内联在 JS 里，页面首开会物化整份数组，
 * bundle 也因此变大。改为包内 .txt 后，页面按需读、只缓存一次。
 *
 * 注意：包内资源必须用 .txt —— 老版本 Vela file API 会拒绝打包的 .json。
 */
import g from './g'

const PATH = '/common/data/quotes.txt'

let cache = null

/**
 * 读取全部一言
 * @param {Function} cb 回调参数为字符串数组
 */
export function load(cb) {
  if (cache) {
    cb(cache)
    return
  }
  g.fs.readText(PATH, (text) => {
    if (!text) {
      cb([])
      return
    }
    const list = String(text)
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    cache = list
    cb(list)
  })
}

export default { load }
