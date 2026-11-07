/**
 * 设备选择：优先取运行中已连接的设备，取不到时回退到宿主保存的设备记录。
 *
 * ⚠️ Level 4 的 `get-connected-device-list` / `get-device-list` 都是 `async func`，
 * 在 JS 侧返回 **Promise**，必须 await 才能拿到数组。
 * 不 await 的话 `.length` 是 undefined，设备列表恒为空 —— 手环连着也显示「未检测到」。
 *
 * 部分手机/连接方式下 `getConnectedDeviceList` 可能返回空（例如权限未授予、
 * 设备实体不是 XiaomiDevice）；回退到 `getDeviceList` 至少能拿到地址，
 * 让心跳/发送尝试一次，并在失败时给出明确错误。
 */
import { getConnectedDeviceList, getDeviceList } from 'astrobox:psys-host-v4/device'

/**
 * 把宿主返回的 list<device-info> 规整成 [{ addr, name }]。
 */
function normalize(list) {
  const out = []
  if (!Array.isArray(list)) return out
  for (let i = 0; i < list.length; i++) {
    const d = list[i]
    if (!d || typeof d !== 'object') continue
    const addr = typeof d.addr === 'string' ? d.addr : ''
    if (!addr) continue
    out.push({
      addr,
      name: typeof d.name === 'string' && d.name ? d.name : addr
    })
  }
  return out
}

/**
 * 统一取错误文案。
 */
function errorText(e) {
  if (e === null || e === undefined) return ''
  if (typeof e === 'string') return e
  if (typeof e.message === 'string' && e.message) return e.message
  try {
    return JSON.stringify(e)
  } catch (x) {
    return String(e)
  }
}

export default {
  /**
   * 取设备列表。
   * 返回 { ok: true, devices: [...], source: 'connected'|'saved' } 或 { ok: false, reason }。
   */
  async list() {
    let reason = ''
    let connected = []
    try {
      connected = normalize(await getConnectedDeviceList())
    } catch (e) {
      reason = errorText(e)
    }
    if (connected.length) {
      return { ok: true, devices: connected, source: 'connected' }
    }

    let saved = []
    try {
      saved = normalize(await getDeviceList())
    } catch (e) {
      if (!reason) reason = errorText(e)
    }
    if (saved.length) {
      return { ok: true, devices: saved, source: 'saved' }
    }
    if (reason) {
      return { ok: false, reason }
    }
    return { ok: true, devices: [], source: 'connected' }
  },

  /**
   * 选出要发送的目标设备。
   * 只有一个设备时直接返回；多个时由调用方（UI）选择。
   */
  pick(devices, selectedAddr) {
    const list = devices || []
    if (!list.length) {
      return { ok: false, reason: '没有检测到已连接的手环' }
    }
    if (selectedAddr) {
      const hit = list.filter((d) => d.addr === selectedAddr)[0]
      if (hit) return { ok: true, device: hit }
      return { ok: false, reason: '选中的设备已断开' }
    }
    if (list.length === 1) {
      return { ok: true, device: list[0] }
    }
    return { ok: false, reason: '请选择目标手环', needChoice: true, devices: list }
  }
}
