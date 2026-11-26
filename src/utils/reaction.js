/**
 * 反应力测验纯 JS 状态机：
 *   idle → waiting → armed → result / foul / summary
 *
 * 双模式：
 *   - 'visual'：视觉变色触发
 *   - 'haptic'：手环闭眼触觉盲测（长振触发）
 *
 * 5 轮制：每轮随机等待 1500–4500 ms；提前点击判 foul（不计入轮次、可重测本轮）；
 * 第 5 轮完成时直接进入 summary 并计算均值 / 最快 / 更新分模式 Best。
 */

export const MODES = ['visual', 'haptic']
export const TOTAL_ROUNDS = 5
export const WAIT_MIN_MS = 1500
export const WAIT_MAX_MS = 4500
export const BEST_KV_KEY = 'reactionBest'

export function normalizeMode(mode) {
  return mode === 'haptic' ? 'haptic' : 'visual'
}

export function normalizeBest(raw) {
  const out = { visual: 0, haptic: 0 }
  if (!raw || typeof raw !== 'object') return out
  const v = Math.floor(Number(raw.visual))
  const h = Math.floor(Number(raw.haptic))
  if (isFinite(v) && v > 0) out.visual = v
  if (isFinite(h) && h > 0) out.haptic = h
  return out
}

export function randomDelay(rng) {
  const r = typeof rng === 'function' ? Number(rng()) : Math.random()
  const clamped = isFinite(r) ? Math.max(0, Math.min(0.999999999, r)) : 0.5
  return WAIT_MIN_MS + Math.floor(clamped * (WAIT_MAX_MS - WAIT_MIN_MS + 1))
}

export function computeStats(times) {
  if (!Array.isArray(times) || times.length === 0) {
    return { count: 0, avgMs: 0, minMs: 0, maxMs: 0 }
  }
  let sum = 0
  let min = times[0]
  let max = times[0]
  for (let i = 0; i < times.length; i++) {
    const t = times[i]
    sum += t
    if (t < min) min = t
    if (t > max) max = t
  }
  return {
    count: times.length,
    avgMs: Math.round(sum / times.length),
    minMs: min,
    maxMs: max
  }
}

export function updateBest(bestMap, mode, scoreMs) {
  const m = normalizeMode(mode)
  const next = normalizeBest(bestMap)
  const s = Math.round(Number(scoreMs))
  if (!isFinite(s) || s <= 0) return { best: next, isNewBest: false }
  if (!next[m] || s < next[m]) {
    next[m] = s
    return { best: next, isNewBest: true }
  }
  return { best: next, isNewBest: false }
}

export function createState(mode, bestMap) {
  return {
    mode: normalizeMode(mode),
    phase: 'idle',
    round: 0,
    totalRounds: TOTAL_ROUNDS,
    times: [],
    lastMs: 0,
    avgMs: 0,
    minMs: 0,
    best: normalizeBest(bestMap),
    isNewBest: false,
    foulCount: 0,
    waitMs: 0,
    armedAt: 0
  }
}

export function setMode(st, mode) {
  const nextMode = normalizeMode(mode)
  return createState(nextMode, st && st.best)
}

/**
 * 开始新测验或进入下一轮：
 *   - idle / summary：从第 1 轮重新开始；
 *   - foul：保持当前轮次重新等待；
 *   - result：进入下一轮（round + 1）。
 */
export function startRound(st, rng) {
  const cur = st || createState('visual')
  const fresh = cur.phase === 'idle' || cur.phase === 'summary'
  const round = fresh ? 1 : cur.phase === 'foul' ? Math.max(1, cur.round) : Math.min(cur.totalRounds, cur.round + 1)
  const times = fresh ? [] : cur.times.slice()
  return Object.assign({}, cur, {
    phase: 'waiting',
    round: round,
    times: times,
    lastMs: fresh ? 0 : cur.lastMs,
    avgMs: fresh ? 0 : cur.avgMs,
    minMs: fresh ? 0 : cur.minMs,
    isNewBest: false,
    foulCount: fresh ? 0 : cur.foulCount,
    waitMs: randomDelay(rng),
    armedAt: 0
  })
}

/** 信号触发（等待定时到期）：waiting → armed。 */
export function arm(st, nowMs) {
  if (!st || st.phase !== 'waiting') return st
  const ts = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now()
  return Object.assign({}, st, {
    phase: 'armed',
    armedAt: ts
  })
}

/**
 * 判定区点击：
 *   - idle / result / foul / summary：进入 waiting（startRound）；
 *   - waiting：判抢跑（foul）；
 *   - armed：记录本轮耗时；凑满 5 轮则进入 summary 并刷新 Best。
 */
export function tap(st, nowMs, rng) {
  const cur = st || createState('visual')
  if (cur.phase === 'idle' || cur.phase === 'result' || cur.phase === 'foul' || cur.phase === 'summary') {
    return startRound(cur, rng)
  }
  if (cur.phase === 'waiting') {
    return Object.assign({}, cur, {
      phase: 'foul',
      foulCount: cur.foulCount + 1,
      waitMs: 0,
      armedAt: 0
    })
  }
  if (cur.phase === 'armed') {
    const ts = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now()
    const rt = Math.max(1, Math.round(ts - cur.armedAt))
    const times = cur.times.concat([rt])
    const stats = computeStats(times)
    if (times.length >= cur.totalRounds) {
      const bestRes = updateBest(cur.best, cur.mode, stats.avgMs)
      return Object.assign({}, cur, {
        phase: 'summary',
        times: times,
        lastMs: rt,
        avgMs: stats.avgMs,
        minMs: stats.minMs,
        best: bestRes.best,
        isNewBest: bestRes.isNewBest,
        waitMs: 0,
        armedAt: 0
      })
    }
    return Object.assign({}, cur, {
      phase: 'result',
      times: times,
      lastMs: rt,
      avgMs: stats.avgMs,
      minMs: stats.minMs,
      waitMs: 0,
      armedAt: 0
    })
  }
  return cur
}

export default {
  MODES,
  TOTAL_ROUNDS,
  WAIT_MIN_MS,
  WAIT_MAX_MS,
  BEST_KV_KEY,
  normalizeMode,
  normalizeBest,
  randomDelay,
  computeStats,
  updateBest,
  createState,
  setMode,
  startRound,
  arm,
  tap
}
