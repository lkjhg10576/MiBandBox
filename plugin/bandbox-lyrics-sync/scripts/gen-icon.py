#!/usr/bin/env python3
"""
生成插件图标 plugin/bandbox-lyrics-sync/icon.png。

纯标准库实现（zlib + struct），不依赖 Pillow。
图案：深色圆角方块 + 两条歌词横线 + 向右箭头（表示「把歌词传到手表」）。

用法：python3 scripts/gen-icon.py
"""
import os
import struct
import zlib

S = 216  # 画布尺寸（与手环端图标一致）

BG = (17, 20, 23, 255)       # 卡片底色
ACCENT = (13, 110, 255, 255)  # 强调蓝
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)

px = [[CLEAR for _ in range(S)] for _ in range(S)]


def fill_rect(x0, y0, x1, y1, color):
    """填充矩形（含端点），自动裁剪。"""
    for y in range(max(0, y0), min(S, y1 + 1)):
        for x in range(max(0, x0), min(S, x1 + 1)):
            px[y][x] = color


def fill_rounded_rect(x0, y0, x1, y1, radius, color):
    """填充圆角矩形。"""
    for y in range(max(0, y0), min(S, y1 + 1)):
        for x in range(max(0, x0), min(S, x1 + 1)):
            cx = min(max(x, x0 + radius), x1 - radius)
            cy = min(max(y, y0 + radius), y1 - radius)
            if (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius:
                px[y][x] = color


def fill_triangle(tip_x, tip_y, back_x, half_h, color):
    """向右的实心三角（箭头头部）。tip_x 为尖端（更靠右），back_x 为底边。"""
    span = abs(tip_x - back_x)
    for i in range(span + 1):
        x = back_x + i if tip_x > back_x else back_x - i
        h = int(half_h * (1 - i / span)) if span else 0
        for y in range(tip_y - h, tip_y + h + 1):
            if 0 <= y < S and 0 <= x < S:
                px[y][x] = color


# ---- 底板 ----
fill_rounded_rect(8, 8, S - 9, S - 9, 46, BG)

# ---- 歌词横线（两条白色横线，左对齐）----
fill_rect(44, 62, 168, 73, WHITE)
fill_rect(44, 92, 132, 103, WHITE)

# ---- 箭头：竖杆 + 三角头 ----
fill_rect(44, 128, 116, 143, ACCENT)
fill_triangle(158, 135, 116, 30, ACCENT)


def encode_png(path):
    raw = bytearray()
    for y in range(S):
        raw.append(0)  # 每行的 filter type 0（None）
        for x in range(S):
            raw.extend(px[y][x])

    def chunk(tag, data):
        return (
            struct.pack('>I', len(data))
            + tag
            + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', S, S, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')

    with open(path, 'wb') as f:
        f.write(png)
    return len(png)


def main():
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icon.png')
    out = os.path.normpath(out)
    size = encode_png(out)
    print('icon.png written:', out, '(%d bytes, %dx%d RGBA)' % (size, S, S))


if __name__ == '__main__':
    main()
