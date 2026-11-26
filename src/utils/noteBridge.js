/**
 * 便签导入接收桥接层：bandbox-note 协议的唯一入口。
 *
 * 与 qrBridge / otpBridge 同一套分层与全局状态模式：
 *   ① 状态挂在 global.__bbNoteBridge，跨 page bundle 共享（去重缓存、认领标记、订阅者）；
 *   ② 不在 app.ux 启动路径加载，由 notebook/list 与 notebook/import 进入时 init() 认领 pushInbox('note')；
 *   ③ 串行队列处理收到的 note_push，保证并发推送下的重名检查与自增序号无竞态；
 *   ④ 落盘格式与 notebook/edit 完全一致：`${finalName}\n${body}`。
 */
import interconnectUtil from './interconnect'
import noteProtocol from './noteProtocol'
import docs from './docs'
import pushInbox from './pushInbox'

const g =
  typeof global !== 'undefined'
    ? global
    : typeof globalThis !== 'undefined'
      ? globalThis
      : {}

const KEY = '__bbNoteBridge'
const SEEN_MAX = 32

if (!g[KEY]) {
  g[KEY] = {
    inited: false,
    seen: [],
    queue: [],
    processing: false,
    subs: [],
    lastNote: null
  }
}

const st = g[KEY]

function send(json) {
  if (!interconnectUtil.isReady()) interconnectUtil.init()
  if (!interconnectUtil.isReady()) return
  interconnectUtil.send(json, () => {}, () => {})
}

function findSeen(id) {
  if (!id) return null
  for (let i = 0; i < st.seen.length; i++) {
    if (st.seen[i].id === id) return st.seen[i]
  }
  return null
}

function rememberSeen(id, name, overwritten) {
  if (!id || findSeen(id)) return
  st.seen.push({ id, name, overwritten: !!overwritten })
  if (st.seen.length > SEEN_MAX) st.seen.shift()
}

function notify(entry) {
  const list = st.subs.slice()
  for (let i = 0; i < list.length; i++) {
    try {
      list[i](entry)
    } catch (e) {}
  }
}

function resolveUniqueTitle(baseTitle, conflictMode, cb) {
  const clean = docs.safeName(baseTitle) || '手机便签'
  if (conflictMode === noteProtocol.CONFLICT_MODES.OVERWRITE) {
    docs.exists('notes', clean, (ex) => {
      cb(clean, !!ex)
    })
    return
  }

  docs.exists('notes', clean, (exists) => {
    if (!exists) {
      cb(clean, false)
      return
    }
    function pickNext(n) {
      if (n > 99) {
        const tail = '-' + Date.now().toString(36).slice(-4)
        const headMax = Math.max(1, noteProtocol.MAX_TITLE_LEN - tail.length)
        const head = docs.safeName(clean.slice(0, headMax)) || '便签'
        cb(head + tail, false)
        return
      }
      const suffix = ' (' + n + ')'
      const headMax = Math.max(1, noteProtocol.MAX_TITLE_LEN - suffix.length)
      const head = docs.safeName(clean.slice(0, headMax)) || '便签'
      const cand = head + suffix
      docs.exists('notes', cand, (taken) => {
        if (!taken) cb(cand, false)
        else pickNext(n + 1)
      })
    }
    pickNext(2)
  })
}

function processOne(msg, done) {
  const id = typeof msg.id === 'string' && msg.id ? msg.id : noteProtocol.makeId('np')
  const prev = findSeen(id)
  if (prev) {
    send(noteProtocol.noteAckMessage(id, prev.name, prev.overwritten))
    done()
    return
  }

  const check = noteProtocol.validateNoteInput(msg.title, msg.body)
  if (!check.ok) {
    send(noteProtocol.noteErrMessage(id, check.reason))
    done()
    return
  }

  const conflict = noteProtocol.normalizeConflict(msg.conflict)
  const baseTitle = docs.safeName(check.title) || '手机便签'

  resolveUniqueTitle(baseTitle, conflict, (finalName, overwritten) => {
    const fileText = finalName + '\n' + check.body
    docs.save('notes', finalName, fileText, (ok) => {
      if (!ok) {
        send(noteProtocol.noteErrMessage(id, noteProtocol.ERRORS.WRITE_FAILED))
        done()
        return
      }
      rememberSeen(id, finalName, overwritten)
      const entry = {
        id,
        title: finalName,
        overwritten: !!overwritten,
        chars: check.chars,
        at: Date.now()
      }
      st.lastNote = entry
      send(noteProtocol.noteAckMessage(id, finalName, !!overwritten))
      notify(entry)
      done()
    })
  })
}

function drainQueue() {
  if (st.processing || !st.queue.length) return
  st.processing = true
  const msg = st.queue.shift()
  processOne(msg, () => {
    st.processing = false
    if (st.queue.length) drainQueue()
  })
}

function handleMessage(msg) {
  if (!msg || msg.type !== 'note_push') return
  st.queue.push(msg)
  drainQueue()
}

function handle(raw) {
  const parsed = noteProtocol.parse(raw)
  if (!parsed.ok) return
  handleMessage(parsed.msg)
}

function init() {
  if (st.inited) return
  st.inited = true
  pushInbox.claim('note', handle)
}

function subscribe(fn) {
  if (typeof fn !== 'function') return () => {}
  if (st.subs.indexOf(fn) < 0) st.subs.push(fn)
  return () => {
    const idx = st.subs.indexOf(fn)
    if (idx >= 0) st.subs.splice(idx, 1)
  }
}

function getLastNote() {
  return st.lastNote
}

export default { init, handle, subscribe, getLastNote }
