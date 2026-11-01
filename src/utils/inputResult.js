/**
 * 跨页面传递一次性的文本输入结果。
 * 独立文件 + 写成功后返回，避免各页面 KV 缓存不同步。
 */
import fs from './fs'

const PATH = 'internal://files/bandbox/input.json'
const DIR = 'internal://files/bandbox/'

function save(field, value, cb) {
  fs.ensureDir(DIR, () => {
    fs.writeText(PATH, JSON.stringify({ field, value, at: Date.now() }), (ok) => {
      if (cb) cb(ok)
    })
  })
}

function clear(cb) {
  fs.remove(PATH, () => {
    if (cb) cb()
  })
}

function take(cb) {
  fs.readText(PATH, (text) => {
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
    fs.remove(PATH, () => {})
    if (cb) cb(data)
  })
}

export default { save, take, clear, PATH }
