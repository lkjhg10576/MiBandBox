#!/usr/bin/env python3
"""从思源/Noto Sans CJK 生成 BandBox 的中文字体子集（OFL 1.1）。

用法：
    /tmp/opencode/fontenv/bin/python tools/gen-assets/font.py           # 开发用：GB2312 + ASCII
    /tmp/opencode/fontenv/bin/python tools/gen-assets/font.py --exact   # 发布用：只含源码用到的字
"""
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.abspath(os.path.join(ROOT, "..", "..", "src"))
OUT = os.path.join(SRC, "common", "fonts", "BandBoxSans.ttf")
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"


def gb2312_level1():
    chars = []
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                ch = bytes([hi, lo]).decode("gb2312")
            except UnicodeDecodeError:
                continue
            if ch not in chars:
                chars.append(ch)
    return "".join(chars)


def scan_exact():
    chars = set()
    for root, _, files in os.walk(SRC):
        for f in files:
            if not f.endswith((".ux", ".js", ".json")):
                continue
            path = os.path.join(root, f)
            try:
                text = open(path, encoding="utf-8").read()
            except UnicodeDecodeError:
                continue
            for ch in text:
                if ord(ch) > 127:
                    chars.add(ch)
    return "".join(sorted(chars))


def scan_shipped():
    """已发布字体里已有的字符。

    字体子集只增不减：源码里删掉一句话，并不代表这个字以后还用不上；
    而且字形集合一变，CID→GID 的映射会跟着变，手表端的文本渲染
    可能整页出豆腐块。所以这里把已发布的字形并进来。
    """
    chars = set()
    if not os.path.exists(OUT):
        return ""
    try:
        from fontTools.ttLib import TTFont

        font = TTFont(OUT)
        for code in font.getBestCmap():
            chars.add(chr(code))
        font.close()
    except Exception as exc:  # pragma: no cover - 缺 fontTools 时降级
        print("warn: 读取已发布字体失败，仅按源码取字：", exc)
    return "".join(sorted(chars))


def main():
    exact = "--exact" in sys.argv
    if exact:
        text = scan_exact()
        # 与已发布字体取并集，保证字形集合只增不减
        text = "".join(sorted(set(text) | set(scan_shipped())))
    else:
        text = gb2312_level1()
    # ASCII、中文标点、常用符号
    text += "".join(chr(c) for c in range(0x20, 0x7F))
    text += "·—–…“”‘’《》〈〉「」『』【】、。，！？：；（）％＋－×÷＝°′″→←↑↓←→✓✕✖√−﹣‧•◦▪▫◆◇■□●○★☆♥›‹「」"
    text = "".join(sorted(set(text)))
    tmp = "/tmp/opencode/bandbox_chars.txt"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # pyftsubset 来自 fonttools；优先用 PATH 上的，其次用旧的独立虚拟环境
    subset = shutil.which("pyftsubset") or "/tmp/opencode/fontenv/bin/pyftsubset"
    cmd = [
        subset,
        FONT,
        "--font-number=2",
        f"--text-file={tmp}",
        f"--output-file={OUT}",
        "--layout-features=*",
        "--no-hinting",
        "--desubroutinize",
    ]
    subprocess.run(cmd, check=True)
    print("chars:", len(text))
    print("font:", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
