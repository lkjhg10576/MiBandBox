#!/usr/bin/env python3
"""BandBox 资源生成器：全部图形自绘，不复制任何原应用素材。"""
import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(ROOT, "..", "..", "src", "common"))
ICONS = os.path.join(OUT, "icons")
S = 4  # 超采样倍数
W = 44
C = (232, 238, 255, 255)  # 线描主色
BLUE = (78, 135, 255, 255)
DIM = (150, 170, 210, 255)


def canvas(size=W, color=(0, 0, 0, 0)):
    return Image.new("RGBA", (size * S, size * S), color)


def save(im, path, size=W):
    im = im.resize((size, size), Image.LANCZOS)
    im.save(path)
    print("wrote", path)


def rr(d, box, r, color=C, width=5):
    d.rounded_rectangle([box[0] * S, box[1] * S, box[2] * S, box[3] * S], radius=r * S, outline=color, width=width)


def line(d, pts, color=C, width=5):
    d.line([(x * S, y * S) for x, y in pts], fill=color, width=width, joint="curve")


def circle(d, cx, cy, r, color=C, width=5, fill=None):
    d.ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], outline=color, width=width, fill=fill)


def dot(d, cx, cy, r, color=C, fill=None):
    d.ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], fill=fill or color)


def arc(d, cx, cy, r, a0, a1, color=C, width=5):
    d.arc([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], a0, a1, fill=color, width=width)


def poly(d, pts, color=C, width=5):
    d.polygon([(x * S, y * S) for x, y in pts], outline=color, width=width)


def icon_calculator():
    im = canvas(); d = ImageDraw.Draw(im)
    rr(d, (7, 5, 37, 39), 5)
    d.rectangle([12 * S, 10 * S, 32 * S, 17 * S], outline=C, width=4)
    for row in range(3):
        for col in range(3):
            dot(d, 14 + col * 8, 24 + row * 6, 1.4)
    save(im, os.path.join(ICONS, "calculator.png"))


def icon_notebook():
    im = canvas(); d = ImageDraw.Draw(im)
    rr(d, (9, 5, 35, 39), 4)
    line(d, [(14, 5), (14, 39)])
    for y in (14, 21, 28):
        line(d, [(20, y), (30, y)], width=4)
    save(im, os.path.join(ICONS, "notebook.png"))


def icon_fluorescence():
    im = canvas(); d = ImageDraw.Draw(im)
    line(d, [(14, 30), (28, 14)], width=9)
    circle(d, 30, 12, 3.5, fill=C, width=1)
    for off in (-4, 0, 4):
        line(d, [(10 + off, 34), (22 + off, 22)], width=2, color=DIM)
    line(d, [(33, 6), (37, 2)], width=3, color=DIM)
    save(im, os.path.join(ICONS, "fluorescence.png"))


def icon_daysmatter():
    im = canvas(); d = ImageDraw.Draw(im)
    rr(d, (6, 9, 38, 38), 5)
    line(d, [(6, 17), (38, 17)])
    line(d, [(14, 5), (14, 12)])
    line(d, [(30, 5), (30, 12)])
    dot(d, 15, 24, 2)
    dot(d, 22, 24, 2)
    dot(d, 29, 24, 2)
    dot(d, 15, 31, 2)
    dot(d, 22, 31, 2)
    save(im, os.path.join(ICONS, "daysmatter.png"))


def icon_calendar():
    im = canvas(); d = ImageDraw.Draw(im)
    rr(d, (6, 9, 38, 39), 5)
    line(d, [(6, 17), (38, 17)])
    line(d, [(14, 5), (14, 12)])
    line(d, [(30, 5), (30, 12)])
    dot(d, 13, 24, 1.6)
    dot(d, 22, 24, 1.6)
    dot(d, 31, 24, 1.6)
    dot(d, 13, 32, 1.6)
    circle(d, 22, 32, 4)
    dot(d, 30, 32, 1.6)
    save(im, os.path.join(ICONS, "calendar.png"))


def icon_sentence():
    im = canvas(); d = ImageDraw.Draw(im)
    for x in (9, 25):
        arc(d, x + 5, 17, 5, 200, 340, width=5)
        line(d, [(x + 1, 20), (x + 1, 31)], width=5)
        line(d, [(x + 9, 20), (x + 9, 31)], width=5)
    save(im, os.path.join(ICONS, "sentence.png"))


def icon_password():
    im = canvas(); d = ImageDraw.Draw(im)
    circle(d, 15, 16, 8)
    line(d, [(21, 22), (34, 35)], width=6)
    line(d, [(28, 29), (33, 24)], width=5)
    line(d, [(32, 33), (36, 29)], width=5)
    save(im, os.path.join(ICONS, "password.png"))


def icon_answer():
    im = canvas(); d = ImageDraw.Draw(im)
    rr(d, (8, 6, 36, 39), 4)
    line(d, [(14, 6), (14, 39)], width=4, color=DIM)
    arc(d, 26, 17, 6, 150, 400, width=4)
    line(d, [(26, 23), (26, 27)], width=4)
    dot(d, 26, 32, 1.6)
    save(im, os.path.join(ICONS, "answer.png"))


def icon_vibrate():
    im = canvas(); d = ImageDraw.Draw(im)
    rr(d, (15, 7, 29, 37), 4)
    dot(d, 22, 32, 1.4)
    for x, s in ((9, 1), (5, 2)):
        arc(d, x + 5, 22, 6 + s * 3, 110, 250, width=3, color=DIM)
        arc(d, 39 - x - 5, 22, 6 + s * 3, -70, 70, width=3, color=DIM)
    save(im, os.path.join(ICONS, "vibrate.png"))


def icon_time():
    im = canvas(); d = ImageDraw.Draw(im)
    circle(d, 22, 22, 16)
    line(d, [(22, 22), (22, 12)], width=5)
    line(d, [(22, 22), (29, 27)], width=5)
    dot(d, 22, 22, 2)
    save(im, os.path.join(ICONS, "time.png"))


def icon_storage():
    im = canvas(); d = ImageDraw.Draw(im)
    d.ellipse([8 * S, 8 * S, 36 * S, 16 * S], outline=C, width=5)
    line(d, [(8, 12), (8, 32)], width=5)
    line(d, [(36, 12), (36, 32)], width=5)
    arc(d, 22, 32, 14, 0, 180, width=5)
    arc(d, 22, 22, 14, 0, 180, width=3, color=DIM)
    save(im, os.path.join(ICONS, "storage.png"))


def icon_fish():
    im = canvas(); d = ImageDraw.Draw(im)
    d.ellipse([6 * S, 14 * S, 33 * S, 32 * S], outline=C, width=5)
    poly(d, [(31, 23), (39, 15), (39, 31)], width=4)
    dot(d, 13, 21, 1.6)
    arc(d, 22, 23, 4, 30, 150, width=3, color=DIM)
    dot(d, 9, 10, 1.5, color=DIM)
    dot(d, 15, 7, 1.2, color=DIM)
    save(im, os.path.join(ICONS, "fish.png"))


def icon_display():
    im = canvas(); d = ImageDraw.Draw(im)
    rr(d, (5, 7, 39, 32), 4)
    for i, x in enumerate((11, 17, 23, 29, 35)):
        line(d, [(x, 12), (x, 27)], width=3, color=DIM if i % 2 else C)
    line(d, [(22, 32), (22, 37)])
    line(d, [(14, 38), (30, 38)])
    save(im, os.path.join(ICONS, "display.png"))


def icon_flashlight():
    im = canvas(); d = ImageDraw.Draw(im)
    poly(d, [(8, 20), (20, 20), (27, 13), (27, 33), (20, 26), (8, 26)], width=4)
    line(d, [(31, 14), (38, 9)], width=3, color=DIM)
    line(d, [(32, 20), (40, 20)], width=3, color=DIM)
    line(d, [(31, 28), (38, 33)], width=3, color=DIM)
    save(im, os.path.join(ICONS, "flashlight.png"))


def icon_cps():
    im = canvas(); d = ImageDraw.Draw(im)
    circle(d, 22, 24, 10)
    dot(d, 22, 24, 3, fill=C)
    for ang in range(0, 360, 45):
        a = math.radians(ang)
        x1 = 22 + 14 * math.sin(a); y1 = 24 - 14 * math.cos(a)
        x2 = 22 + 17 * math.sin(a); y2 = 24 - 17 * math.cos(a)
        line(d, [(x1, y1), (x2, y2)], width=2, color=DIM)
    save(im, os.path.join(ICONS, "cpsTest.png"))


def icon_diet():
    im = canvas(); d = ImageDraw.Draw(im)
    arc(d, 22, 24, 16, 0, 180, width=5)
    line(d, [(6, 24), (38, 24)], width=5)
    line(d, [(14, 10), (30, 20)], width=3, color=DIM)
    line(d, [(18, 7), (32, 18)], width=3, color=DIM)
    save(im, os.path.join(ICONS, "diet.png"))


def icon_random():
    im = canvas(); d = ImageDraw.Draw(im)
    rr(d, (7, 7, 37, 37), 7)
    for x, y in ((14, 14), (28, 14), (21, 22), (14, 30), (28, 30)):
        dot(d, x, y, 2.2)
    save(im, os.path.join(ICONS, "random.png"))


def icon_system():
    im = canvas(); d = ImageDraw.Draw(im)
    rr(d, (11, 11, 33, 33), 4)
    rr(d, (17, 17, 27, 27), 2, width=4)
    for i in range(4):
        p = 14 + i * 5
        line(d, [(p, 4), (p, 10)], width=3)
        line(d, [(p, 34), (p, 40)], width=3)
        line(d, [(4, p), (10, p)], width=3)
        line(d, [(34, p), (40, p)], width=3)
    save(im, os.path.join(ICONS, "system.png"))


def icon_performance():
    im = canvas(); d = ImageDraw.Draw(im)
    arc(d, 22, 26, 16, 180, 360, width=5)
    line(d, [(22, 26), (31, 16)], width=5)
    dot(d, 22, 26, 2)
    line(d, [(6, 26), (38, 26)], width=4, color=DIM)
    save(im, os.path.join(ICONS, "performance.png"))


def icon_history():
    im = canvas(); d = ImageDraw.Draw(im)
    arc(d, 22, 23, 15, 40, 320, width=5)
    line(d, [(22, 23), (22, 13)], width=4)
    line(d, [(22, 23), (29, 23)], width=4)
    poly(d, [(33, 5), (39, 11), (32, 12)], width=3, color=C)
    save(im, os.path.join(ICONS, "history.png"))


def icon_scoreboard():
    im = canvas(); d = ImageDraw.Draw(im)
    rr(d, (5, 10, 39, 34), 4)
    line(d, [(22, 12), (22, 32)], width=3, color=DIM)
    line(d, [(12, 18), (16, 14)], width=4)
    line(d, [(28, 14), (33, 19)], width=4)
    dot(d, 14, 26, 2)
    dot(d, 29, 26, 2)
    line(d, [(18, 37), (26, 37)], width=4)
    save(im, os.path.join(ICONS, "scoreboard.png"))


def icon_morse():
    im = canvas(); d = ImageDraw.Draw(im)
    dot(d, 10, 14, 3)
    dot(d, 21, 14, 3)
    line(d, [(29, 14), (38, 14)], width=6)
    line(d, [(10, 27), (19, 27)], width=6)
    dot(d, 27, 27, 3)
    dot(d, 38, 27, 3)
    save(im, os.path.join(ICONS, "morseCode.png"))


def icon_waste():
    im = canvas(); d = ImageDraw.Draw(im)
    line(d, [(7, 12), (37, 12)], width=5)
    rr(d, (12, 12, 32, 38), 3, width=5)
    line(d, [(18, 7), (26, 7)], width=5)
    line(d, [(18, 20), (18, 32)], width=3, color=DIM)
    line(d, [(26, 20), (26, 32)], width=3, color=DIM)
    save(im, os.path.join(ICONS, "wasteSorting.png"))


def icon_qrcode():
    im = canvas(); d = ImageDraw.Draw(im)
    for ox, oy in ((6, 6), (26, 6), (6, 26)):
        rr(d, (ox, oy, ox + 11, oy + 11), 2, width=4)
        dot(d, ox + 5.5, oy + 5.5, 1.6)
    for x, y in ((24, 24), (30, 24), (36, 24), (24, 30), (33, 31), (27, 36), (37, 37)):
        dot(d, x, y, 1.8)
    save(im, os.path.join(ICONS, "qrcode.png"))


def icon_marquee():
    im = canvas(); d = ImageDraw.Draw(im)
    rr(d, (5, 10, 39, 30), 5)
    line(d, [(10, 16), (28, 16)], width=4)
    line(d, [(10, 23), (22, 23)], width=4, color=DIM)
    poly(d, [(30, 33), (38, 38), (30, 43)], width=3, color=C)
    save(im, os.path.join(ICONS, "marquee.png"))


def icon_lylist():
    im = canvas(); d = ImageDraw.Draw(im)
    line(d, [(27, 8), (27, 30)], width=5)
    line(d, [(27, 8), (36, 6)], width=5)
    line(d, [(36, 6), (36, 12)], width=5)
    circle(d, 22, 31, 5, width=5)
    save(im, os.path.join(ICONS, "lylist.png"))


def icon_level():
    im = canvas(); d = ImageDraw.Draw(im)
    rr(d, (5, 15, 39, 29), 7)
    line(d, [(14, 22), (14, 19)], width=3, color=DIM)
    line(d, [(22, 22), (22, 18)], width=3, color=DIM)
    line(d, [(30, 22), (30, 19)], width=3, color=DIM)
    circle(d, 22, 22, 3, fill=C, width=1)
    save(im, os.path.join(ICONS, "level.png"))


def icon_settings():
    im = canvas(); d = ImageDraw.Draw(im)
    circle(d, 22, 22, 10)
    circle(d, 22, 22, 3, width=4)
    for i in range(8):
        a = math.radians(i * 45)
        line(d, [
            (22 + math.cos(a) * 10, 22 + math.sin(a) * 10),
            (22 + math.cos(a) * 15, 22 + math.sin(a) * 15),
        ])
    save(im, os.path.join(ICONS, "settings.png"))


def common_shadow():
    w, h = 212, 84
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = im.load()
    for y in range(h):
        a = int(200 * (1 - y / (h - 1)) ** 1.5)
        for x in range(w):
            px[x, y] = (0, 0, 0, a)
    im.save(os.path.join(OUT, "shadow.png"))
    print("wrote shadow.png")


def common_more():
    size = 72
    im = Image.new("RGBA", (size * S, size * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([4 * S, 4 * S, 68 * S, 68 * S], fill=(38, 38, 38, 255), outline=(90, 90, 90, 255), width=2 * S)
    for x in (26, 36, 46):
        d.ellipse([(x - 3) * S, (33 - 3) * S, (x + 3) * S, (33 + 3) * S], fill=(255, 255, 255, 255))
    save(im, os.path.join(OUT, "more.png"), size)


def common_plus():
    size = 72
    im = Image.new("RGBA", (size * S, size * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([4 * S, 4 * S, 68 * S, 68 * S], fill=(13, 110, 255, 255))
    d.line([(36 - 12) * S, 36 * S, (36 + 12) * S, 36 * S], fill=(255, 255, 255, 255), width=5 * S)
    d.line([36 * S, (36 - 12) * S, 36 * S, (36 + 12) * S], fill=(255, 255, 255, 255), width=5 * S)
    save(im, os.path.join(OUT, "plus.png"), size)


def common_check():
    size = 64
    im = Image.new("RGBA", (size * S, size * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([4 * S, 4 * S, 60 * S, 60 * S], fill=(13, 110, 255, 255))
    d.line([(19 * S, 33 * S), (28 * S, 42 * S), (46 * S, 22 * S)], fill=(255, 255, 255, 255), width=6 * S, joint="curve")
    save(im, os.path.join(OUT, "check.png"), size)


def common_enter():
    im = canvas(32)
    d = ImageDraw.Draw(im)
    line(d, [(12, 8), (20, 16), (12, 24)], width=4)
    save(im, os.path.join(OUT, "enter.png"), 32)


def common_back():
    im = canvas(32)
    d = ImageDraw.Draw(im)
    line(d, [(20, 8), (12, 16), (20, 24)], width=4)
    save(im, os.path.join(OUT, "back.png"), 32)


def common_empty():
    im = canvas(92)
    d = ImageDraw.Draw(im)
    rr(d, (14, 22, 78, 72), 10, color=(120, 130, 150, 255), width=4)
    line(d, [(14, 36), (78, 36)], width=3, color=(120, 130, 150, 255))
    line(d, [(30, 14), (62, 14)], width=4, color=(120, 130, 150, 255))
    for x in (30, 46, 62):
        line(d, [(x, 50), (x, 58)], width=3, color=(120, 130, 150, 255))
    save(im, os.path.join(OUT, "empty.png"), 92)


def common_switch():
    for on in (True, False):
        w, h = 32, 22
        im = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        fill = (13, 110, 255, 255) if on else (70, 70, 70, 255)
        d.rounded_rectangle([1 * S, 1 * S, 31 * S, 21 * S], radius=10 * S, fill=fill)
        cx = 21 if on else 11
        d.ellipse([(cx - 7) * S, 4 * S, (cx + 7) * S, 18 * S], fill=(255, 255, 255, 255))
        save(im, os.path.join(OUT, "switch_on.png" if on else "switch_off.png"), 32)


def app_icon():
    size = 216
    im = Image.new("RGBA", (size * S, size * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([8 * S, 8 * S, 208 * S, 208 * S], radius=52 * S, fill=(13, 110, 255, 255))
    d.rounded_rectangle([48 * S, 62 * S, 168 * S, 154 * S], radius=18 * S, outline=(255, 255, 255, 255), width=8 * S)
    d.line([(84 * S, 62 * S), (84 * S, 154 * S)], fill=(255, 255, 255, 255), width=6 * S)
    d.line([(108 * S, 88 * S), (150 * S, 88 * S)], fill=(255, 255, 255, 255), width=6 * S)
    d.line([(108 * S, 112 * S), (150 * S, 112 * S)], fill=(255, 255, 255, 255), width=6 * S)
    d.line([(108 * S, 136 * S), (136 * S, 136 * S)], fill=(255, 255, 255, 255), width=6 * S)
    save(im, os.path.join(OUT, "icon.png"), size)


def main():
    os.makedirs(ICONS, exist_ok=True)
    for fn in (
        icon_calculator, icon_notebook, icon_fluorescence, icon_daysmatter,
        icon_calendar, icon_sentence, icon_password, icon_answer, icon_vibrate, icon_time,
        icon_storage, icon_fish, icon_display, icon_flashlight, icon_cps,
        icon_diet, icon_random, icon_system, icon_performance, icon_history,
        icon_scoreboard, icon_morse, icon_waste, icon_qrcode, icon_marquee,
        icon_lylist, icon_level, icon_settings,
    ):
        fn()
    common_shadow()
    common_more()
    common_plus()
    common_check()
    common_enter()
    common_back()
    common_empty()
    common_switch()
    app_icon()


if __name__ == "__main__":
    main()
