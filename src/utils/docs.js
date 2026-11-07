/**
 * 文档仓库：笔记本与歌词本共用。
 * 目录下每个 txt 为一个文档，标题取文件名。
 */
import g from './g'
import { normalizeTitle } from './lyricsDoc'

const ROOT = 'internal://files/bandbox/'

function join(dir, name) {
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
      const docs = (arr || [])
        .filter((it) => it && it.uri && /\.txt$/.test(it.uri))
        .map((it) => {
          const raw = it.uri.split('/').pop() || ''
          const name = decodeURIComponent(raw.replace(/\.txt$/, ''))
          return {
            name,
            title: name,
            size: it.length || 0,
            mtime: it.lastModifiedTime || 0,
            uri: uri + raw
          }
        })
        .sort((a, b) => b.mtime - a.mtime)
      cb(docs)
    })
  })
}

function read(dir, name, cb) {
  g.fs.readText(join(dir, name), cb)
}

function save(dir, name, text, cb) {
  const clean = safeName(name)
  if (!clean) {
    if (cb) cb(false, 202, '')
    return
  }
  const uri = ROOT + dir + '/'
  g.fs.ensureDir(uri, () => {
    g.fs.writeText(join(dir, clean), String(text == null ? '' : text), (ok, code) => {
      if (cb) cb(ok, code, clean)
    })
  })
}

function remove(dir, name, cb) {
  g.fs.remove(join(dir, name), (ok, code) => {
    if (cb) cb(ok, code)
  })
}

function rename(dir, oldName, newName, cb) {
  const clean = safeName(newName)
  if (!clean) {
    if (cb) cb(false, 202)
    return
  }
  const uri = ROOT + dir + '/'
  g.fs.rename(join(dir, oldName), join(dir, clean), (ok, code) => {
    if (cb) cb(ok, code, clean)
  })
}

function exists(dir, name, cb) {
  g.fs.exists(join(dir, name), cb)
}

export { safeName }

export default { list, read, save, remove, rename, exists, safeName, ROOT }
