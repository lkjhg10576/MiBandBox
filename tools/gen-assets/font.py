#!/usr/bin/env python3
"""从思源/Noto Sans CJK 生成 BandBox 的中文字体子集（OFL 1.1）。

用法：
    /tmp/opencode/fontenv/bin/python tools/gen-assets/font.py           # 开发用：GB2312 + ASCII
    /tmp/opencode/fontenv/bin/python tools/gen-assets/font.py --exact   # 发布用：只含源码用到的字
"""
import os
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


def main():
    exact = "--exact" in sys.argv
    if exact:
        text = scan_exact()
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
    cmd = [
        "/tmp/opencode/fontenv/bin/pyftsubset",
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
