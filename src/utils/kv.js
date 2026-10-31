/**
 * 轻量 KV：整份 JSON 存一个文件，内存缓存 + 防抖落盘。
 * 每次 init 都会重新读文件（80ms 内合并），避免多页面各自缓存导致读到旧值。
 */
import file from '@system.file'

const PATH = 'internal://files/bandbox/store.json'

let data = {}
let ready = false
let reading = false
let lastRead = 0
let timer = null
let queue = []

function snapshot() {
  try {
    return JSON.parse(JSON.stringify(data))
  } catch (e) {
    return {}
  }
}

function flush() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  try {
    file.writeText({
      uri: PATH,
      text: JSON.stringify(snapshot()),
      fail() {}
    })
  } catch (e) {}
}

function schedule() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(flush, 120)
}

function flushQueue() {
  const list = queue
  queue = []
  list.forEach((fn) => {
    try {
      fn(data)
    } catch (e) {}
  })
}

function init(cb) {
  if (cb) queue.push(cb)
  if (reading) return
  if (ready && Date.now() - lastRead < 80) {
    flushQueue()
    return
  }
  reading = true
  file.readText({
    uri: PATH,
    success(res) {
      try {
        const parsed = JSON.parse(res.text)
        if (parsed && typeof parsed === 'object') data = parsed
      } catch (e) {}
      ready = true
      reading = false
      lastRead = Date.now()
      flushQueue()
    },
    fail() {
      ready = true
      reading = false
      lastRead = Date.now()
      flushQueue()
    }
  })
}

function get(key, def) {
  if (data[key] === undefined) return def
  return data[key]
}

function set(key, value) {
  data[key] = value
  schedule()
  return value
}

function remove(key) {
  delete data[key]
  schedule()
}

function all() {
  return data
}

function reset() {
  data = {}
  schedule()
}

export default { init, get, set, remove, all, reset, flush, PATH }
