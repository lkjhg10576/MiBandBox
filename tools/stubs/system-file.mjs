/**
 * @system.file 的 Node 测试桩：内存文件系统。
 * 仅 tools/test-otp-bridge.mjs 通过 loader 注入使用，不参与真机构建。
 */
const files = {}

function readText(opts) {
  const text = files[opts.uri]
  if (text === undefined) {
    if (opts.fail) opts.fail({})
    return
  }
  if (opts.success) opts.success({ text })
}

function writeText(opts) {
  files[opts.uri] = opts.text || ''
  if (opts.success) opts.success({})
}

function deleteFile(opts) {
  delete files[opts.uri]
  if (opts.success) opts.success({})
}

export default { readText, writeText, deleteFile }
export const __files = files
export const __reset = () => {
  for (const k in files) delete files[k]
}
