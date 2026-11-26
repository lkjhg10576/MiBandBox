/**
 * 轻量 KV：整份 JSON 存一个文件，内存缓存 + 防抖落盘。
 *
 * 读盘策略：
 *   - 单例化后一进程只在首次 init() 读盘一次，就绪后直接走内存；
 *     提供 reload(cb) 逃生口供显式强制重读
 *   - 读盘返回时若已有本地未落盘改动（dirty / writing / pending），
 *     只把磁盘值合并进未写过的键，避免启动早期「页面先写、读盘后到」冲掉新值
 *   - rev() 在每次数据变更时递增，供 otpStore 等派生缓存按版本号失效
 *   - flush 只做一次全量序列化；写入进行中再次触发合并到写完后的补写
 */
import file from '@system.file'

const PATH = 'internal://files/bandbox/store.json'

// 落盘防抖
const FLUSH_DELAY_MS = 120

let data = {}
let ready = false
let reading = false
let timer = null
let queue = []
let dirty = false
let writing = false
let pending = false
let revision = 0
let unflushedKeys = Object.create(null)
let unflushedReset = false

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
        } else if (!dirty) {
          unflushedKeys = Object.create(null)
          unflushedReset = false
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

function readDisk() {
  reading = true
  file.readText({
    uri: PATH,
    success(res) {
      try {
        const parsed = JSON.parse(res.text)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          if (dirty || writing || pending) {
            if (!unflushedReset) {
              const keys = Object.keys(parsed)
              for (let i = 0; i < keys.length; i++) {
                const k = keys[i]
                if (!unflushedKeys[k]) data[k] = parsed[k]
              }
            }
          } else {
            data = parsed
          }
          revision++
        }
      } catch (e) {}
      ready = true
      reading = false
      flushQueue()
    },
    fail() {
      ready = true
      reading = false
      flushQueue()
    }
  })
}

function init(cb) {
  if (cb) queue.push(cb)
  if (reading) return
  if (ready) {
    flushQueue()
    return
  }
  readDisk()
}

function reload(cb) {
  if (cb) queue.push(cb)
  if (reading) return
  readDisk()
}

function get(key, def) {
  if (data[key] === undefined) return def
  return data[key]
}

function set(key, value) {
  if (data[key] === value) return value
  data[key] = value
  unflushedKeys[key] = true
  dirty = true
  revision++
  schedule()
  return value
}

function remove(key) {
  if (data[key] === undefined && ready && !reading) return
  delete data[key]
  unflushedKeys[key] = true
  dirty = true
  revision++
  schedule()
}

function all() {
  return data
}

function reset() {
  data = {}
  unflushedReset = true
  unflushedKeys = Object.create(null)
  dirty = true
  revision++
  schedule()
}

function rev() {
  return revision
}

export default { init, reload, get, set, remove, all, reset, flush, rev, PATH }
