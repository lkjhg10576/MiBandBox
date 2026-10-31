#!/usr/bin/env bash
# 构建并部署到已运行的 Vela 模拟器（adb 设备 emulator-5554）。
#
# 安装用 `pm install`：直接 rm -rf /data/app/<pkg> + unzip 会让 AMS 里的
# 已注册应用变成「文件被删但状态还在」的坏状态，之后 am start 只出黑屏。
set -e
cd "$(dirname "$0")/.."
PKG=com.miband.box
ADB=${ADB:-$HOME/.vela/sdk/tools/adb/linux/adb}
SERIAL=${SERIAL:-emulator-5554}
RPK=$(ls -t dist/*.rpk | head -1)

$ADB -s "$SERIAL" shell "am stop $PKG" >/dev/null 2>&1 || true
sleep 1
$ADB -s "$SERIAL" push "$RPK" "/data/app/$PKG.rpk" >/dev/null
$ADB -s "$SERIAL" shell "pm install /data/app/$PKG.rpk" >/dev/null
$ADB -s "$SERIAL" shell "am start $PKG" >/dev/null
echo "deployed $RPK"
