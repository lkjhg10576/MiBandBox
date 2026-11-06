/**
 * OTP 存储胶水层：账户与设置的唯一读写点（底座是 kv.js）。
 *
 * 页面与 otpBridge 只经此模块访问 OTP 存储；写操作 kv.set() 后立即
 * kv.flush()（跳过 120ms 防抖），防止杀进程丢密钥。
 * notify() 用 slice().forEach + try/catch（照 app.ux 的 layoutState 范式）。
 */
import kv from './kv'
import otpAccounts from './otpAccounts'

const KEY_ACCOUNTS = 'otp.accounts'
const KEY_SETTINGS = 'otp.settings'

/** 时间偏移范围（秒）：手表钟快了为负。 */
const OFFSET_MIN = -300
const OFFSET_MAX = 300

const listeners = []

function notify() {
  listeners.slice().forEach((fn) => {
    try {
      fn()
    } catch (e) {}
  })
}

/**
 * 初始化（转发 kv.init，读盘完成后回调一次）。
 */
function init(cb) {
  kv.init(cb)
}

/**
 * 账户列表（normalized 副本；存储损坏时降级为空列表）。
 */
function list() {
  const raw = kv.get(KEY_ACCOUNTS, [])
  if (!Array.isArray(raw)) return []
  const out = []
  for (let i = 0; i < raw.length; i++) {
    const n = otpAccounts.normalizeAccount(raw[i])
    if (n) out.push(n)
  }
  return out
}

/**
 * 按 id 取单个账户；不存在返回 null。
 */
function getById(id) {
  const all = list()
  for (let i = 0; i < all.length; i++) {
    if (all[i].id === id) return all[i]
  }
  return null
}

function saveAccounts(next) {
  kv.set(KEY_ACCOUNTS, next)
  kv.flush()
  notify()
}

/**
 * 新增/更新一个账户（先严格校验）。
 * 返回 { ok:true, account } 或 { ok:false, reason }。
 */
function upsert(account) {
  const v = otpAccounts.validateAccount(account)
  if (!v.ok) return v
  saveAccounts(otpAccounts.upsertAccounts(list(), [v.account]))
  return { ok: true, account: v.account }
}

/**
 * 删除账户。返回是否确有删除。
 */
function remove(id) {
  const all = list()
  let found = false
  const next = all.filter((a) => {
    if (a.id === id) {
      found = true
      return false
    }
    return true
  })
  if (found) saveAccounts(next)
  return found
}

/**
 * 逐条校验一批账户（不下发不落盘）。
 * 返回 { okCount, firstError }。
 */
function validateAll(accounts) {
  const arr = Array.isArray(accounts) ? accounts : []
  let okCount = 0
  let firstError = ''
  for (let i = 0; i < arr.length; i++) {
    const v = otpAccounts.validateAccount(arr[i])
    if (v.ok) okCount++
    else if (!firstError) firstError = v.reason
  }
  return { okCount, firstError }
}

/**
 * 应用手机下发增量：先删 removeIds 再 upsert（协议 sync_delta 语义）。
 * 逐条校验，无效条目跳过。返回实际落盘的 upsert 条数。
 */
function applyDelta(upsert, removeIds) {
  const ups = Array.isArray(upsert) ? upsert : []
  const rem = Array.isArray(removeIds) ? removeIds : []
  const validUpsert = []
  for (let i = 0; i < ups.length; i++) {
    const v = otpAccounts.validateAccount(ups[i])
    if (v.ok) validUpsert.push(v.account)
  }
  const next = otpAccounts.mergeDelta(list(), validUpsert, rem)
  saveAccounts(next)
  return validUpsert.length
}

/**
 * 全量替换（手机端 list_accounts 回填 / 清空后重建）。
 */
function replaceAll(accounts) {
  const out = []
  const arr = Array.isArray(accounts) ? accounts : []
  for (let i = 0; i < arr.length; i++) {
    const n = otpAccounts.normalizeAccount(arr[i])
    if (n) out.push(n)
  }
  saveAccounts(out)
  return out.length
}

/**
 * 清空全部账户。
 */
function clearAll() {
  saveAccounts([])
}

function getSettings() {
  const s = kv.get(KEY_SETTINGS, null)
  if (!s || typeof s !== 'object') return { timeOffsetSec: 0 }
  let offset = Math.floor(Number(s.timeOffsetSec) || 0)
  if (offset < OFFSET_MIN) offset = OFFSET_MIN
  if (offset > OFFSET_MAX) offset = OFFSET_MAX
  return { timeOffsetSec: offset }
}

function setSettings(next) {
  const cur = getSettings()
  const merged = { ...cur, ...(next || {}) }
  let offset = Math.floor(Number(merged.timeOffsetSec) || 0)
  if (offset < OFFSET_MIN) offset = OFFSET_MIN
  if (offset > OFFSET_MAX) offset = OFFSET_MAX
  kv.set(KEY_SETTINGS, { timeOffsetSec: offset })
  kv.flush()
  notify()
}

function getTimeOffsetSec() {
  return getSettings().timeOffsetSec
}

function setTimeOffsetSec(offset) {
  setSettings({ timeOffsetSec: Math.floor(Number(offset) || 0) })
}

/**
 * 订阅变化。返回退订函数。
 */
function subscribe(fn) {
  if (typeof fn !== 'function') return () => {}
  if (listeners.indexOf(fn) < 0) listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i >= 0) listeners.splice(i, 1)
  }
}

export default {
  OFFSET_MIN,
  OFFSET_MAX,
  init,
  list,
  getById,
  upsert,
  remove,
  validateAll,
  applyDelta,
  replaceAll,
  clearAll,
  getSettings,
  setSettings,
  getTimeOffsetSec,
  setTimeOffsetSec,
  subscribe
}
