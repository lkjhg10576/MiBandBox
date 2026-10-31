/**
 * 设备选择：获取已连接的设备列表，多设备时让用户挑一个。
 */
import { getConnectedDeviceList } from 'astrobox:psys-host-v4/device'

export default {
  /**
   * 取已连接设备。
   * 返回 { ok: true, devices: [...] } 或 { ok: false, reason }。
   */
  list() {
    try {
      const devices = getConnectedDeviceList() || []
      return { ok: true, devices }
    } catch (e) {
      return { ok: false, reason: String(e && e.message ? e.message : e) }
    }
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
