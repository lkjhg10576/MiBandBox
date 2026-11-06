/**
 * @system.interconnect 的 Node 测试桩：捕获手表发出的消息、注入手机消息。
 * 仅 tools/test-otp-bridge.mjs 通过 loader 注入使用，不参与真机构建。
 */
const state = {
  instance: null,
  sent: [],
  onStatusCbs: []
}

export default {
  instance() {
    if (!state.instance) {
      state.instance = {
        onmessage: null,
        onopen: null,
        onclose: null,
        onerror: null,
        subscribe(cb) {
          state.sub = cb
        },
        send(opts) {
          state.sent.push(opts.data)
          if (opts.success) opts.success({ status: 1 })
          return true
        }
      }
    }
    return state.instance
  }
}

export const __sent = () => state.sent.slice()
export const __sentCount = () => state.sent.length
export const __reset = () => {
  state.sent = []
  state.instance = null
  state.onStatusCbs = []
}

/** 注入一条手机→手表消息（走 onmessage → dispatch → listeners）。 */
export const __pushIncoming = (data) => {
  if (state.instance && state.instance.onmessage) state.instance.onmessage(data)
}

/** 模拟连接状态变化（1 打开 / 2 关闭）。 */
export const __emitStatus = (status) => {
  for (const cb of state.onStatusCbs) cb(status)
}

/** 暴露状态监听器注册（interconnect.onStatus 会调用这里）。 */
export const __onStatusRegister = (cb) => {
  state.onStatusCbs.push(cb)
}
