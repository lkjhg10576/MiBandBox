#!/usr/bin/env bash
# 构建并部署到已运行的 Vela 模拟器（adb 设备 emulator-5554）
set -e
cd "$(dirname "$0")/.."
PKG=com.cleanroom.bandbox
ADB=${ADB:-$HOME/.vela/sdk/tools/adb/linux/adb}
RPK=$(ls -t dist/*.rpk | head -1)

./node_modules/.bin/aiot build "$@" >/tmp/opencode/build.log 2>&1 || {
  tail -40 /tmp/opencode/build.log
  exit 1
}

$ADB shell "am stop $PKG" >/dev/null 2>&1 || true
sleep 2
$ADB push "$RPK" "/data/app/$PKG.rpk" >/dev/null
$ADB shell "rm -r /data/app/$PKG" >/dev/null 2>&1 || true
$ADB shell "mkdir /data/app/$PKG" >/dev/null
$ADB shell "unzip -o /data/app/$PKG.rpk -d /data/app/$PKG" >/dev/null
$ADB shell "am start $PKG" >/dev/null 2>&1
echo "deployed $RPK"
