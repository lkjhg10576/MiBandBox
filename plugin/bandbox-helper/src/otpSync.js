/**
 * OTP 三态同步模型（仅手机插件侧使用）。
 *
 * baseline / local / deletedIds 三态：
 *   baseline    上次与手环达成一致的全量账户（最近一次 commitSuccess 或全量拉取）
 *   local       用户在手机上编辑后的期望状态
 *   deletedIds  本次会话被删掉的 id（防止「删了又同 id 重建」的合并歧义）
 *
 * 插件进程内是内存态；插件重启后用户重新「拉取数据」即可重建 baseline
 * （手表端 kv.flush() 落盘的账户是唯一持久真相源）。
 */
import otpAccounts from './otpAccounts.js'

/** 稳定序列化：normalizeAccount 产物键序固定，diff 可靠。 */
function stable(a) {
  const n = otpAccounts.normalizeAccount(a)
  return n ? JSON.stringify(n) : ''
}

/**
 * 创建三态同步容器。初始 loaded=false：必须先拉取或导入后才允许保存。
 */
export function createOtpSync() {
  return { baseline: [], local: [], deletedIds: [], loaded: false }
}

/**
 * 全量拉取后重建三态（拉取即达成一致：baseline = local = 手表当前状态）。
 */
export function replaceAll(sync, accounts) {
  const list = (Array.isArray(accounts) ? accounts : [])
    .map((a) => otpAccounts.normalizeAccount(a))
    .filter(Boolean)
  sync.baseline = list
  sync.local = list.map((a) => JSON.parse(JSON.stringify(a)))
  sync.deletedIds = []
  sync.loaded = true
}

/**
 * 手机端新增/编辑一批账户（写 local，不动 baseline）。
 * 返回实际写入了几个。同一凭据（secret+issuer+name+type 相同）复用已有 id，
 * 避免重复导入产生克隆账户。
 */
export function applyLocalUpsert(sync, accounts) {
  const inc = Array.isArray(accounts) ? accounts : []
  let count = 0
  for (let i = 0; i < inc.length; i++) {
    const n = otpAccounts.normalizeAccount(inc[i])
    if (!n) continue
    for (let j = 0; j < sync.local.length; j++) {
      if (sameCore(sync.local[j], n)) {
        n.id = sync.local[j].id
        break
      }
    }
    sync.local = upsertList(sync.local, n)
    count++
  }
  return count
}

/**
 * 手机端删除一个账户（写 local + deletedIds，不动 baseline）。
 */
export function applyLocalRemove(sync, id) {
  const key = String(id == null ? '' : id)
  sync.local = sync.local.filter((a) => a.id !== key)
  if (sync.deletedIds.indexOf(key) < 0) sync.deletedIds.push(key)
}

/**
 * 计算 delta：local 相对 baseline 的变更。
 *   upsert：local 中新增或内容有变的账户（稳定序列化比对）
 *   remove：baseline 中有、local 中没有（或被显式删除）的 id
 */
export function getSyncDelta(sync) {
  const upsert = []
  for (let i = 0; i < sync.local.length; i++) {
    const l = sync.local[i]
    let changed = true
    for (let j = 0; j < sync.baseline.length; j++) {
      if (sync.baseline[j].id === l.id) {
        changed = stable(sync.baseline[j]) !== stable(l)
        break
      }
    }
    if (changed) upsert.push(l)
  }
  const remove = []
  for (let i = 0; i < sync.baseline.length; i++) {
    const b = sync.baseline[i]
    let gone = sync.deletedIds.indexOf(b.id) >= 0
    if (!gone) {
      gone = true
      for (let j = 0; j < sync.local.length; j++) {
        if (sync.local[j].id === b.id) {
          gone = false
          break
        }
      }
    }
    if (gone) remove.push(b.id)
  }
  // 已删除的 id 不应同时出现在 upsert
  const dedup = upsert.filter((a) => sync.deletedIds.indexOf(a.id) < 0)
  return { upsert: dedup, remove }
}

/**
 * 是否还有未保存的修改。
 */
export function hasPending(sync) {
  const d = getSyncDelta(sync)
  return d.upsert.length > 0 || d.remove.length > 0
}

/**
 * 下发成功后把 baseline 推进到 local（三态达成一致）。
 */
export function commitSuccess(sync) {
  sync.baseline = sync.local.map((a) => JSON.parse(JSON.stringify(a)))
  sync.deletedIds = []
}

/**
 * 放弃本地修改（local 回滚到 baseline）。
 */
export function discardLocal(sync) {
  sync.local = sync.baseline.map((a) => JSON.parse(JSON.stringify(a)))
  sync.deletedIds = []
}

// ------------------------------------------------------------------
// 内部工具
// ------------------------------------------------------------------

function sameCore(a, b) {
  return (
    a.secret === b.secret &&
    a.issuer === b.issuer &&
    a.name === b.name &&
    a.type === b.type
  )
}

function upsertList(list, account) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === account.id) {
      const next = list.slice()
      next[i] = account
      return next
    }
  }
  const next = list.slice()
  next.push(account)
  return next
}

export default {
  createOtpSync,
  replaceAll,
  applyLocalUpsert,
  applyLocalRemove,
  getSyncDelta,
  hasPending,
  commitSuccess,
  discardLocal
}
