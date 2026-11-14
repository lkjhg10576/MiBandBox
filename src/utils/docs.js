/**
 * 文档仓库：笔记本与歌词本共用。
 * 目录下每个 txt 为一个文档，标题取文件名。
 */
import g from './g.js'
import { normalizeTitle } from './lyricsDoc.js'

const ROOT = 'internal://files/bandbox/'

/**
 * 稳健文件名编码：
 * 避免 encodeURIComponent 对 CJK 字符膨胀 9 倍（每个汉字 9 字节，11 汉字超 96 字节截断导致死锁/列表丢失）。
 * 仅对 URI 保留字中会在路径解析中产生歧义的字符（% 与 #）做百分号转义，
 * CJK 与字母数字、空格等直接作为文件名保存，24 汉字 UTF-8 仅 72 字节，安全收敛在 96 字节限制内。
 */
function encodeDocName(name) {
  return String(name || '').replace(/[%#]/g, (c) => encodeURIComponent(c))
}

function join(dir, name) {
  return ROOT + dir + '/' + encodeDocName(name) + '.txt'
}

function joinLegacy(dir, name) {
  return ROOT + dir + '/' + encodeURIComponent(name) + '.txt'
}

/**
 * 文件名/标题归一化。
 * 实现收敛到 lyricsDoc.js（纯函数，无平台依赖），与歌词解析器共用同一套规则，
 * 避免「判定是不是标题」和「生成文件名」两处规则漂移。
 */
function safeName(name) {
  return normalizeTitle(name)
}

function list(dir, cb) {
  const uri = ROOT + dir + '/'
  g.fs.ensureDir(uri, () => {
    g.fs.list(uri, (arr) => {
      const seen = Object.create(null)
      const docs = []
      const fileList = arr || []

      for (let i = 0; i < fileList.length; i++) {
        const it = fileList[i]
        if (!it || !it.uri || !/\.txt$/.test(it.uri)) continue

        const raw = it.uri.split('/').pop() || ''
        const base = raw.replace(/\.txt$/, '')
        let name = ''
        try {
          name = decodeURIComponent(base)
        } catch (e) {
          name = base
        }
        if (!name) continue

        const item = {
          name,
          title: name,
          size: it.length || 0,
          mtime: it.lastModifiedTime || 0,
          uri: uri + raw
        }

        // 双编码去重：若同一标题同时存在新旧文件名，优先保留较新版本
        if (seen[name]) {
          const existing = seen[name]
          if (item.mtime > existing.mtime) {
            existing.size = item.size
            existing.mtime = item.mtime
            existing.uri = item.uri
          }
        } else {
          seen[name] = item
          docs.push(item)
        }
      }

      docs.sort((a, b) => b.mtime - a.mtime)
      cb(docs)
    })
  })
}

function read(dir, name, cb) {
  const primary = join(dir, name)
  g.fs.readText(primary, (text, code) => {
    if (text !== null) {
      if (cb) cb(text, null)
      return
    }
    // 回退兼容：尝试读取历史全 encodeURIComponent 编码文件
    const legacy = joinLegacy(dir, name)
    if (legacy !== primary) {
      g.fs.readText(legacy, (legacyText, legacyCode) => {
        if (cb) cb(legacyText, legacyText !== null ? null : (legacyCode || code || 300))
      })
    } else {
      if (cb) cb(null, code || 300)
    }
  })
}

function save(dir, name, text, cb) {
  const clean = safeName(name)
  if (!clean) {
    if (cb) cb(false, 202, '')
    return
  }
  const uri = ROOT + dir + '/'
  const targetPath = join(dir, clean)
  const str = String(text == null ? '' : text)

  g.fs.ensureDir(uri, (okDir, dirCode) => {
    if (!okDir) {
      if (cb) cb(false, dirCode || 300, clean)
      return
    }

    function doWrite(attemptsLeft, done) {
      g.fs.writeText(targetPath, str, (ok, code) => {
        if (ok) {
          done(true, null)
        } else if (attemptsLeft > 0) {
          doWrite(attemptsLeft - 1, done)
        } else {
          done(false, code || 300)
        }
      })
    }

    function verify(done) {
      g.fs.readText(targetPath, (readBack, code) => {
        if (readBack === null || readBack === undefined) {
          done(false, code || 300)
        } else if (readBack !== str) {
          done(false, 301)
        } else {
          done(true, null)
        }
      })
    }

    // 第 1 步：落盘写入（失败自动重试一次）
    doWrite(1, (writeOk, writeCode) => {
      if (!writeOk) {
        if (cb) cb(false, writeCode, clean)
        return
      }

      // 第 2 步：写后回读比对校验
      verify((verifyOk, verifyCode) => {
        if (verifyOk) {
          // 落盘且回读校验确认通过后，清理旧版冗余历史编码文件
          const legacy = joinLegacy(dir, clean)
          if (legacy !== targetPath) {
            g.fs.remove(legacy, () => {})
          }
          if (cb) cb(true, null, clean)
          return
        }

        // 回读校验未通过，重写一次并二次比对
        doWrite(1, (retryWriteOk, retryWriteCode) => {
          if (!retryWriteOk) {
            if (cb) cb(false, retryWriteCode || verifyCode, clean)
            return
          }
          verify((finalVerifyOk, finalVerifyCode) => {
            if (finalVerifyOk) {
              const legacy = joinLegacy(dir, clean)
              if (legacy !== targetPath) {
                g.fs.remove(legacy, () => {})
              }
              if (cb) cb(true, null, clean)
            } else {
              if (cb) cb(false, finalVerifyCode || 301, clean)
            }
          })
        })
      })
    })
  })
}

function remove(dir, name, cb) {
  const primary = join(dir, name)
  const legacy = joinLegacy(dir, name)
  g.fs.remove(primary, (okPrimary, codePrimary) => {
    if (legacy !== primary) {
      g.fs.remove(legacy, (okLegacy, codeLegacy) => {
        const ok = okPrimary || okLegacy
        if (cb) cb(ok, ok ? null : (codePrimary || codeLegacy || 300))
      })
    } else {
      if (cb) cb(okPrimary, codePrimary)
    }
  })
}

function rename(dir, oldName, newName, cb) {
  const clean = safeName(newName)
  if (!clean) {
    if (cb) cb(false, 202)
    return
  }
  const dstUri = join(dir, clean)
  const uri = ROOT + dir + '/'
  g.fs.ensureDir(uri, (okDir, dirCode) => {
    if (!okDir) {
      if (cb) cb(false, dirCode || 300)
      return
    }
    const srcPrimary = join(dir, oldName)
    const srcLegacy = joinLegacy(dir, oldName)
    g.fs.exists(srcPrimary, (hasPrimary) => {
      const srcUri = hasPrimary ? srcPrimary : srcLegacy
      g.fs.rename(srcUri, dstUri, (ok, code) => {
        if (cb) cb(ok, code, clean)
      })
    })
  })
}

function exists(dir, name, cb) {
  const primary = join(dir, name)
  g.fs.exists(primary, (yes) => {
    if (yes) {
      if (cb) cb(true)
      return
    }
    const legacy = joinLegacy(dir, name)
    if (legacy !== primary) {
      g.fs.exists(legacy, (legacyYes) => {
        if (cb) cb(!!legacyYes)
      })
    } else {
      if (cb) cb(false)
    }
  })
}

export { safeName }

export default { list, read, save, remove, rename, exists, safeName, ROOT }
