/**
 * 文件能力封装：统一失败降级，页面不直接碰 @system.file。
 */
import file from '@system.file'

export function readText(uri, cb) {
  file.readText({
    uri,
    success(res) {
      if (cb) cb(res && res.text !== undefined ? res.text : '', null)
    },
    fail(res, code) {
      if (cb) cb(null, code || 300)
    }
  })
}

export function writeText(uri, text, cb) {
  file.writeText({
    uri,
    text,
    success() {
      if (cb) cb(true, null)
    },
    fail(res, code) {
      if (cb) cb(false, code || 300)
    }
  })
}

export function list(uri, cb) {
  file.list({
    uri,
    success(res) {
      const arr = (res && res.fileList) || []
      if (cb) cb(arr, null)
    },
    fail(res, code) {
      if (cb) cb([], code || 300)
    }
  })
}

export function mkdir(uri, cb) {
  file.mkdir({
    uri,
    recursive: true,
    success() {
      if (cb) cb(true, null)
    },
    fail(res, code) {
      if (cb) cb(false, code || 300)
    }
  })
}

export function remove(uri, cb) {
  file.delete({
    uri,
    success() {
      if (cb) cb(true, null)
    },
    fail(res, code) {
      if (cb) cb(false, code || 300)
    }
  })
}

export function exists(uri, cb) {
  file.access({
    uri,
    success() {
      if (cb) cb(true)
    },
    fail() {
      if (cb) cb(false)
    }
  })
}

export function rename(srcUri, dstUri, cb) {
  file.move({
    srcUri,
    dstUri,
    success() {
      if (cb) cb(true, null)
    },
    fail(res, code) {
      if (cb) cb(false, code || 300)
    }
  })
}

export function usage(cb) {
  if (typeof file.getUsage !== 'function') {
    if (cb) cb(null)
    return
  }
  file.getUsage({
    success(res) {
      if (cb) cb(res || null)
    },
    fail() {
      if (cb) cb(null)
    }
  })
}

export function ensureDir(uri, cb) {
  mkdir(uri, (ok, code) => {
    if (ok) {
      if (cb) cb(true, null)
      return
    }
    exists(uri, (alreadyExists) => {
      if (alreadyExists) {
        if (cb) cb(true, null)
      } else {
        if (cb) cb(false, code || 300)
      }
    })
  })
}

export default { readText, writeText, list, mkdir, remove, exists, rename, usage, ensureDir }
