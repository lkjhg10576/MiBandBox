/**
 * pnglib —— 零依赖 PNG 编解码库（Node 内置 zlib）
 *
 * 用途：
 *   - perf-audit.mjs 读 IHDR/色数，统计 PNG8 可行性
 *   - png8.mjs 做 PNG8 转换、尺寸重采样、量化
 *
 * 支持解码：color type 0/2/3/4/6，bit depth 8/16（16 位降为 8 位），palette 位深 1/2/4/8。
 * 支持编码：color type 6（RGBA8）与 color type 3（PNG8 + tRNS）。
 */
import zlib from 'node:zlib'

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

export function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/**
 * 解码 PNG → { width, height, colorType, bitDepth, pixels(RGBA8) }
 */
export function decodePNG(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('不是 PNG')
  let off = 8
  let ihdr = null
  let palette = null
  let trns = null
  const idat = []
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    off += 12 + len
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12]
      }
    } else if (type === 'PLTE') {
      palette = []
      for (let i = 0; i + 2 < data.length; i += 3) {
        palette.push([data[i], data[i + 1], data[i + 2], 255])
      }
    } else if (type === 'tRNS') {
      trns = data
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
  }
  if (!ihdr) throw new Error('缺少 IHDR')
  if (ihdr.interlace) throw new Error('不支持隔行 PNG')
  const { width, height, colorType, bitDepth } = ihdr
  const ch = CHANNELS[colorType]
  if (!ch) throw new Error('不支持的 colorType ' + colorType)

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const bpp = Math.max(1, Math.ceil((ch * bitDepth) / 8)) // 每像素字节数（整字节对齐）
  const rowBytes = Math.ceil((ch * bitDepth * width) / 8)
  const out = Buffer.alloc(rowBytes * height)

  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const cur = out.subarray(y * rowBytes, (y + 1) * rowBytes)
    raw.copy(cur, 0, pos, pos + rowBytes)
    pos += rowBytes
    const prev = y > 0 ? out.subarray((y - 1) * rowBytes, y * rowBytes) : null
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= bpp ? prev[i - bpp] : 0
      switch (filter) {
        case 0: break
        case 1: cur[i] = (cur[i] + a) & 0xff; break
        case 2: cur[i] = (cur[i] + b) & 0xff; break
        case 3: cur[i] = (cur[i] + ((a + b) >> 1)) & 0xff; break
        case 4: cur[i] = (cur[i] + paeth(a, b, c)) & 0xff; break
        default: throw new Error('未知 filter ' + filter)
      }
    }
  }

  const pixels = new Uint8Array(width * height * 4)
  const getSample = (row, idx) => {
    if (bitDepth === 8) return row[idx]
    if (bitDepth === 16) return row[idx * 2]
    // bitDepth < 8：palette/gray，按位取
    const perByte = 8 / bitDepth
    const byte = row[Math.floor(idx / perByte)]
    const shift = 8 - bitDepth * ((idx % perByte) + 1)
    const mask = (1 << bitDepth) - 1
    const v = (byte >> shift) & mask
    return colorType === 3 ? v : Math.round((v * 255) / mask)
  }

  for (let y = 0; y < height; y++) {
    const row = out.subarray(y * rowBytes, (y + 1) * rowBytes)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      if (colorType === 6) {
        pixels[o] = getSample(row, x * 4)
        pixels[o + 1] = getSample(row, x * 4 + 1)
        pixels[o + 2] = getSample(row, x * 4 + 2)
        pixels[o + 3] = getSample(row, x * 4 + 3)
      } else if (colorType === 2) {
        pixels[o] = getSample(row, x * 3)
        pixels[o + 1] = getSample(row, x * 3 + 1)
        pixels[o + 2] = getSample(row, x * 3 + 2)
        pixels[o + 3] = 255
      } else if (colorType === 0) {
        const g = getSample(row, x)
        pixels[o] = pixels[o + 1] = pixels[o + 2] = g
        pixels[o + 3] = 255
      } else if (colorType === 4) {
        const g = getSample(row, x * 2)
        pixels[o] = pixels[o + 1] = pixels[o + 2] = g
        pixels[o + 3] = getSample(row, x * 2 + 1)
      } else {
        const idx = getSample(row, x)
        const c = (palette && palette[idx]) || [0, 0, 0, 255]
        pixels[o] = c[0]
        pixels[o + 1] = c[1]
        pixels[o + 2] = c[2]
        pixels[o + 3] = trns && idx < trns.length ? trns[idx] : 255
      }
    }
  }
  return { width, height, colorType, bitDepth, palette, pixels }
}

/** RGBA8 → PNG（color type 6） */
export function encodePNG({ width, height, pixels }) {
  const rowBytes = width * 4
  const raw = Buffer.alloc((rowBytes + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0
    Buffer.from(pixels.buffer, pixels.byteOffset + y * rowBytes, rowBytes).copy(raw, y * (rowBytes + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return assemble([{ type: 'IHDR', data: ihdr }, { type: 'IDAT', data: zlib.deflateSync(raw, { level: 9 }) }])
}

/** 索引图 → PNG8（color type 3 + tRNS） */
export function encodePNG8({ width, height, palette, indices }) {
  const rowBytes = width
  const raw = Buffer.alloc((rowBytes + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0
    Buffer.from(indices.buffer, indices.byteOffset + y * rowBytes, rowBytes).copy(raw, y * (rowBytes + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 3
  const plte = Buffer.alloc(palette.length * 3)
  palette.forEach((c, i) => {
    plte[i * 3] = c[0]
    plte[i * 3 + 1] = c[1]
    plte[i * 3 + 2] = c[2]
  })
  // tRNS：按 alpha 升序排在前面的连续索引上
  let alphaCount = 0
  for (const c of palette) {
    if (c[3] < 255) alphaCount++
    else break
  }
  const chunks = [{ type: 'IHDR', data: ihdr }, { type: 'PLTE', data: plte }]
  if (alphaCount > 0) {
    const trns = Buffer.alloc(alphaCount)
    for (let i = 0; i < alphaCount; i++) trns[i] = palette[i][3]
    chunks.push({ type: 'tRNS', data: trns })
  }
  chunks.push({ type: 'IDAT', data: zlib.deflateSync(raw, { level: 9 }) })
  return assemble(chunks)
}

function assemble(chunks) {
  const parts = [SIG]
  for (const c of chunks) {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(c.data.length, 0)
    const type = Buffer.from(c.type, 'ascii')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([type, c.data])), 0)
    parts.push(len, type, c.data, crc)
  }
  return Buffer.concat(parts)
}

/** 统计唯一颜色数（RGBA 四元组） */
export function uniqueColors(pixels) {
  const set = new Set()
  for (let i = 0; i < pixels.length; i += 4) {
    set.add((pixels[i] << 24) | (pixels[i + 1] << 16) | (pixels[i + 2] << 8) | pixels[i + 3])
  }
  return set.size
}

/** 盒式滤波缩放（降采样用） */
export function resizeBox(img, dw, dh) {
  const { width: sw, height: sh, pixels: src } = img
  const out = new Uint8Array(dw * dh * 4)
  const xr = sw / dw
  const yr = sh / dh
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * yr)
    const y1 = Math.min(sh, Math.max(y0 + 1, Math.floor((y + 1) * yr)))
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * xr)
      const x1 = Math.min(sw, Math.max(x0 + 1, Math.floor((x + 1) * xr)))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const o = (sy * sw + sx) * 4
          const alpha = src[o + 3] / 255
          r += src[o] * alpha
          g += src[o + 1] * alpha
          b += src[o + 2] * alpha
          a += src[o + 3]
          n++
        }
      }
      const o = (y * dw + x) * 4
      const avgA = a / n
      const wsum = a / 255
      out[o] = wsum > 0 ? Math.round(r / wsum) : 0
      out[o + 1] = wsum > 0 ? Math.round(g / wsum) : 0
      out[o + 2] = wsum > 0 ? Math.round(b / wsum) : 0
      out[o + 3] = Math.round(avgA)
    }
  }
  return { width: dw, height: dh, pixels: out }
}

/**
 * 中位切分量化：最多 maxColors 种颜色。
 * 返回 { palette: [[r,g,b,a]...], indices: Uint8Array }
 */
export function quantize(img, maxColors = 256) {
  const { width, height, pixels } = img
  const hist = new Map()
  for (let i = 0; i < pixels.length; i += 4) {
    const key = (pixels[i] << 24) | (pixels[i + 1] << 16) | (pixels[i + 2] << 8) | pixels[i + 3]
    hist.set(key, (hist.get(key) || 0) + 1)
  }
  const colors = []
  for (const [key, count] of hist) {
    colors.push({
      r: (key >>> 24) & 0xff,
      g: (key >>> 16) & 0xff,
      b: (key >>> 8) & 0xff,
      a: key & 0xff,
      count
    })
  }
  if (colors.length <= maxColors) {
    const palette = colors.map((c) => [c.r, c.g, c.b, c.a])
    const indexOf = new Map()
    palette.forEach((c, i) => indexOf.set((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3], i))
    const indices = new Uint8Array(width * height)
    for (let i = 0; i < pixels.length; i += 4) {
      const key = (pixels[i] << 24) | (pixels[i + 1] << 16) | (pixels[i + 2] << 8) | pixels[i + 3]
      indices[i / 4] = indexOf.get(key)
    }
    return { palette, indices }
  }

  // 中位切分
  let boxes = [colors]
  while (boxes.length < maxColors) {
    let target = -1
    let bestRange = -1
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]
      if (box.length < 2) continue
      for (const ch of ['r', 'g', 'b']) {
        let min = 255, max = 0
        for (const c of box) {
          if (c[ch] < min) min = c[ch]
          if (c[ch] > max) max = c[ch]
        }
        const range = (max - min) * Math.log2(box.length + 1)
        if (range > bestRange) {
          bestRange = range
          target = i
        }
      }
    }
    if (target < 0) break
    const box = boxes[target]
    let bestCh = 'r'
    let boxRange = -1
    for (const ch of ['r', 'g', 'b']) {
      let min = 255, max = 0
      for (const c of box) {
        if (c[ch] < min) min = c[ch]
        if (c[ch] > max) max = c[ch]
      }
      if (max - min > boxRange) {
        boxRange = max - min
        bestCh = ch
      }
    }
    box.sort((a, b) => a[bestCh] - b[bestCh])
    const mid = box.length >> 1
    boxes.splice(target, 1, box.slice(0, mid), box.slice(mid))
  }

  const palette = boxes.map((box) => {
    let r = 0, g = 0, b = 0, a = 0, n = 0
    for (const c of box) {
      r += c.r
      g += c.g
      b += c.b
      a += c.a
      n++
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)]
  })

  const indices = new Uint8Array(width * height)
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3]
    let best = 0
    let bestD = Infinity
    for (let p = 0; p < palette.length; p++) {
      const c = palette[p]
      const dr = r - c[0], dg = g - c[1], db = b - c[2], da = a - c[3]
      const d = dr * dr * 3 + dg * dg * 4 + db * db * 2 + da * da
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    indices[i / 4] = best
  }
  return { palette, indices }
}
