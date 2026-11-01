#!/usr/bin/env python3
"""Vela 模拟器 gRPC 控制器 —— 截图 / 触摸 / 按键 / 日志。

模拟器（AIoT-IDE 附带，Android emulator 内核）开放 android.emulation.control.EmulatorController，
因此可以脱离 IDE 直接驱动：截图、点击、滑动、按键、读日志。

用法：
    .venv-emu/bin/python tools/emu.py status
    .venv-emu/bin/python tools/emu.py shot out.png
    .venv-emu/bin/python tools/emu.py tap 233 300
    .venv-emu/bin/python tools/emu.py swipe 120 400 120 120 300
    .venv-emu/bin/python tools/emu.py key GoBack
    .venv-emu/bin/python tools/emu.py logcat -n 100
    .venv-emu/bin/python tools/emu.py shotwin out.png      # X11 兜底：直接抓模拟器窗口
    .venv-emu/bin/python tools/emu.py watch ./shots        # 每秒截图，便于录交互
"""
import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "emugrpc"))

import grpc  # noqa: E402
import emulator_controller_pb2 as pb  # noqa: E402
import emulator_controller_pb2_grpc as pbg  # noqa: E402


def find_port(explicit=None):
    """依次尝试 8554..8565，返回第一个可连通的 gRPC 端口。"""
    ports = [explicit] if explicit else list(range(8554, 8566))
    for p in ports:
        try:
            ch = grpc.insecure_channel(f"localhost:{p}")
            grpc.channel_ready_future(ch).result(timeout=0.6)
            return p, ch
        except Exception:
            continue
    return None, None


def stub(port=None):
    p, ch = find_port(port)
    if not ch:
        sys.exit(
            "未找到模拟器 gRPC 端口（试过 8554-8565）。\n"
            "请在 AIoT-IDE 里启动模拟器，或带上 --port 指定端口。"
        )
    return p, ch, pbg.EmulatorControllerStub(ch)


def _safe_out(out):
    """把输出路径限制在当前工作目录内，避免绝对路径或 .. 逃逸。"""
    base = os.path.realpath(os.getcwd())
    target = os.path.realpath(os.path.join(base, out))
    if os.path.commonpath([base, target]) != base:
        sys.exit(f"输出路径必须在当前工作目录内：{out}")
    return target


def do_shot(stub_, out, scale=0):
    out = _safe_out(out)
    fmt = pb.ImageFormat(format=pb.ImageFormat.PNG)
    if scale:
        fmt.width = scale
    img = stub_.getScreenshot(fmt, timeout=10)
    Path(out).write_bytes(img.image)
    w = img.format.width or "?"
    h = img.format.height or "?"
    print(f"{out}  {len(img.image)} bytes  {w}x{h}")


def mouse(stub_, x, y, buttons):
    stub_.sendMouse(
        pb.MouseEvent(x=int(x), y=int(y), buttons=buttons), timeout=5
    )


def do_tap(stub_, x, y, hold=0.06):
    # Vela 模拟器对 sendTouch 支持不稳定，sendMouse 实测可用
    mouse(stub_, x, y, 1)
    time.sleep(hold)
    mouse(stub_, x, y, 0)


def do_swipe(stub_, x1, y1, x2, y2, ms=300, steps=12):
    mouse(stub_, x1, y1, 1)
    for i in range(1, steps + 1):
        t = i / steps
        mouse(stub_, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 1)
        time.sleep(ms / 1000 / steps)
    mouse(stub_, x2, y2, 0)


def do_key(stub_, name):
    stub_.sendKey(
        pb.KeyboardEvent(codeType=pb.KeyboardEvent.XKB if False else 0, eventType=2, key=name),
        timeout=5,
    )


def do_logcat(stub_, n):
    msgs = stub_.getLogcat(pb.LogMessage(start=0), timeout=5)
    print((msgs.contents or "").strip()[-n:])


def shot_window(out):
    """兜底：X11 抓模拟器窗口。需要 DISPLAY 与 xdotool。"""
    out = _safe_out(out)
    ids = subprocess.run(
        ["xdotool", "search", "--name", "Vela|AIoT|Emulator|模拟器"],
        capture_output=True,
        text=True,
    ).stdout.split()
    if not ids:
        sys.exit("没找到模拟器窗口（xdotool search 无结果）")
    wid = ids[-1]
    name = subprocess.run(
        ["xdotool", "getwindowname", wid], capture_output=True, text=True
    ).stdout.strip()
    geo = subprocess.run(
        ["xdotool", "getwindowgeometry", wid], capture_output=True, text=True
    ).stdout.strip()
    subprocess.run(["import", "-window", wid, out], check=True)
    print(f"{out}  <- window {wid} '{name}'  ({geo.splitlines()[-1].strip()})")


def do_watch(stub_, outdir, interval):
    outdir = _safe_out(outdir)
    os.makedirs(outdir, exist_ok=True)
    i = 0
    print(f"录像中 → {outdir}/（Ctrl-C 停止）")
    try:
        while True:
            do_shot(stub_, os.path.join(outdir, f"shot_{i:05d}.png"))
            i += 1
            time.sleep(interval)
    except KeyboardInterrupt:
        print(f"\n共 {i} 帧")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=None)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status")
    s = sub.add_parser("shot")
    s.add_argument("out", nargs="?", default="shot.png")
    s.add_argument("--scale", type=int, default=0)
    t = sub.add_parser("tap")
    t.add_argument("x", type=int)
    t.add_argument("y", type=int)
    sw = sub.add_parser("swipe")
    for a in ("x1", "y1", "x2", "y2"):
        sw.add_argument(a, type=int)
    sw.add_argument("--ms", type=int, default=300)
    k = sub.add_parser("key")
    k.add_argument("name")
    lc = sub.add_parser("logcat")
    lc.add_argument("-n", type=int, default=4000)
    w = sub.add_parser("shotwin")
    w.add_argument("out", nargs="?", default="shotwin.png")
    v = sub.add_parser("watch")
    v.add_argument("outdir")
    v.add_argument("--interval", type=float, default=1.0)

    a = ap.parse_args()
    if a.cmd == "shotwin":
        return shot_window(a.out)

    port, _, st = stub(a.port)
    print(f"[gRPC :{port}]", file=sys.stderr)
    if a.cmd == "status":
        s_ = st.getStatus(pb.Empty(), timeout=5)
        print(s_)
    elif a.cmd == "shot":
        do_shot(st, a.out, a.scale)
    elif a.cmd == "tap":
        do_tap(st, a.x, a.y)
        print(f"tap {a.x},{a.y}")
    elif a.cmd == "swipe":
        do_swipe(st, a.x1, a.y1, a.x2, a.y2, a.ms)
        print(f"swipe {a.x1},{a.y1} -> {a.x2},{a.y2}")
    elif a.cmd == "key":
        do_key(st, a.name)
        print(f"key {a.name}")
    elif a.cmd == "logcat":
        do_logcat(st, a.n)
    elif a.cmd == "watch":
        do_watch(st, a.outdir, a.interval)


if __name__ == "__main__":
    main()
