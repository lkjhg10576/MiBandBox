/**
 * 文档仓库：笔记本与歌词本共用。
 * 目录下每个 txt 为一个文档，标题取文件名。
 */
import fs from './fs'

const ROOT = 'internal://files/bandbox/'

function join(dir, name) {
  return ROOT + dir + '/' + encodeURIComponent(name) + '.txt'
}

function safeName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
}

function list(dir, cb) {
  const uri = ROOT + dir + '/'
  fs.ensureDir(uri, () => {
    fs.list(uri, (arr) => {
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
  fs.readText(join(dir, name), cb)
}

function save(dir, name, text, cb) {
  const clean = safeName(name)
  if (!clean) {
    if (cb) cb(false, 202, '')
    return
  }
  const uri = ROOT + dir + '/'
  fs.ensureDir(uri, () => {
    fs.writeText(join(dir, clean), String(text == null ? '' : text), (ok, code) => {
      if (cb) cb(ok, code, clean)
    })
  })
}

function remove(dir, name, cb) {
  fs.remove(join(dir, name), (ok, code) => {
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
  fs.rename(join(dir, oldName), join(dir, clean), (ok, code) => {
    if (cb) cb(ok, code, clean)
  })
}

function exists(dir, name, cb) {
  fs.exists(join(dir, name), cb)
}

export default { list, read, save, remove, rename, exists, safeName, ROOT }
