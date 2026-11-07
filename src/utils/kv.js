/**
 * 轻量 KV：整份 JSON 存一个文件，内存缓存 + 防抖落盘。
 *
 * L4 重写要点：
 *   - flush 只做**一次**全量序列化（原来 snapshot() 里 JSON.parse(JSON.stringify())
 *     再外层 JSON.stringify，每个 key 写一次就是 3 次全量遍历）
 *   - set 同值不置脏，避免无意义的落盘
 *   - 写入进行中再次触发 → 合并到写完之后的补写（pending），不排队
 *   - init 读盘窗口 80ms → 5000ms：单例化后读盘只发生在 app 启动，
 *     保留 5 秒兜底给「外部改了文件」的场景
 */
import file from '@system.file'

const PATH = 'internal://files/bandbox/store.json'

// 同一次启动内，5 秒内的 init 复用内存数据（不再读盘）
const READ_WINDOW_MS = 5000
// 落盘防抖
const FLUSH_DELAY_MS = 120

let data = {}
let ready = false
let reading = false
let lastRead = 0
let timer = null
let queue = []
let dirty = false
let writing = false
let pending = false

function flush() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!dirty) return
  dirty = false
  if (writing) {
    // 正在写：本次改动合并到写完后的补写
    pending = true
    return
  }
  writing = true
  let text = ''
  try {
    // 唯一一次序列化
    text = JSON.stringify(data)
  } catch (e) {
    writing = false
    dirty = true
    return
  }
  try {
    file.writeText({
      uri: PATH,
      text: text,
      success() {
        writing = false
        if (pending) {
          pending = false
          dirty = true
          flush()
        }
      },
      fail() {
        writing = false
        // 写失败：保留脏标记，下次 set 会重新触发落盘
        dirty = true
      }
    })
  } catch (e) {
    writing = false
    dirty = true
  }
}

function schedule() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(flush, FLUSH_DELAY_MS)
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
  if (ready && Date.now() - lastRead < READ_WINDOW_MS) {
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
  if (data[key] === value) return value
  data[key] = value
  dirty = true
  schedule()
  return value
}

function remove(key) {
  if (data[key] === undefined) return
  delete data[key]
  dirty = true
  schedule()
}

function all() {
  return data
}

function reset() {
  data = {}
  dirty = true
  schedule()
}

export default { init, get, set, remove, all, reset, flush, PATH }
