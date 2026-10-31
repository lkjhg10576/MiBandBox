# Band 10 模拟器修复记录

## 结论

黑屏**不是** `Modem is not alive` 导致的。该行只是 RIL 启动时的正常告警，后续日志里 Modem 实际已被识别（`Found Multimode Modem`）。

真正原因：Band 10 使用的 `vela-watch-5.0` 镜像是**不带表盘/桌面**的开发镜像，启动时会出现：

```
[AMS] can't find target by intent[,action.system.HOME]
[AMS] Startup home app failure!!!
```

因此不运行任何快应用时就是黑屏，这是镜像设计行为，不是模拟器坏了。

## 为什么不能用另一个镜像

- `vela-miwear-watch-5.0`：带表盘，但表盘是 **466×466 圆形**，套在 212×520 的 Band 10 skin 上会变成圆形表盘被裁切，机型不对。
- `vela-watch-5.0`：212×520 正确，但没有表盘/桌面，且内核缺少原版 Hyper Box 需要的 `system.interconnect` 特性。

## 当前可用配置（已落在 `~/.vela/vvd/Vela_Band10.vvd`）

| 项 | 值 |
|---|---|
| 屏幕 | 212×520，skin `xiaomi_band_10`，跑道屏 |
| kernel | 复制自 `~/.vela/sdk/system-images/vela-miwear-watch-5.0/nuttx` |
| system/data | 仍用 `vela-watch-5.0`（无圆形表盘、无 home） |
| 效果 | 启动后黑屏（正常），运行快应用后按 212×520 正确显示；`system.interconnect` 可用 |

> kernel 用 miwear 版是为了补上 `system.interconnect`；system/data 保持 generic 版是为了避免 466 圆表盘。VVD 内的 `nuttx` mtime 已 touch 新，IDE 启动时不会用旧镜像覆盖。

## 启动与运行

```bash
# 启动（也可以直接在 AIoT-IDE 里点运行）
~/.vela/sdk/emulator/linux-x86_64/emulator \
  -vela -avd Vela_Band10 -port 5554 -show-kernel -grpc 8554 -no-window \
  -qemu -device virtio-snd,bus=virtio-mmio-bus.2 -allow-host-audio -semihosting -smp 2

# 安装并启动 rpk（在当前 miwear kernel 下）
adb -s emulator-5554 push app.rpk /data/app/app.rpk
adb -s emulator-5554 shell 'pm install /data/app/app.rpk'
adb -s emulator-5554 shell 'am start <package>'

# 截图/点击
.venv-emu/bin/python tools/emu.py --port 8554 shot out.png
.venv-emu/bin/python tools/emu.py --port 8554 tap 106 260
```

已用原版 `com.charlie.hyperbox` 验证：212×520 下 UI 正常，截图 `/tmp/opencode/band10_fixed_app4.png`。

## 恢复官方原状

```bash
rm ~/.vela/vvd/Vela_Band10.vvd/nuttx
```

删除后模拟器会回退到 `vela-watch-5.0` 的 generic kernel（黑屏、无 `system.interconnect`）。
