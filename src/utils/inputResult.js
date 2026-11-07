/**
 * 跨页面传递一次性的文本输入结果。
 * 独立文件 + 写成功后返回，避免各页面 KV 缓存不同步。
 */
import g from './g'

const PATH = 'internal://files/bandbox/input.json'
const DIR = 'internal://files/bandbox/'

function save(field, value, cb) {
  g.fs.ensureDir(DIR, () => {
    g.fs.writeText(PATH, JSON.stringify({ field, value, at: Date.now() }), (ok) => {
      if (cb) cb(ok)
    })
  })
}

function clear(cb) {
  g.fs.remove(PATH, () => {
    if (cb) cb()
  })
}

function take(cb) {
  g.fs.readText(PATH, (text) => {
    if (!text) {
      if (cb) cb(null)
      return
    }
    let data = null
    try {
      data = JSON.parse(text)
    } catch (e) {
      data = null
    }
    g.fs.remove(PATH, () => {})
    if (cb) cb(data)
  })
}

export default { save, take, clear, PATH }
