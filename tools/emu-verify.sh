#!/usr/bin/env bash
# 模拟器验证：构建 → 安装 → 等安装完成 → 启动 → 截图
#
# 用法：
#   ./tools/emu-verify.sh [截图名] [等待秒数]
#
# 说明：Vela 模拟器的 pm install 是异步的，装完前启动会得到黑屏，
# 所以这里轮询 logcat 里的 "rpk install ongoing" 直到消失再启动。
set -e
cd "$(dirname "$0")/.."
ADB=${ADB:-$HOME/.vela/sdk/tools/adb/linux/adb}
SERIAL=${SERIAL:-emulator-5554}
PKG=com.miband.box
NAME=${1:-shot}
WAIT=${2:-12}
OUT=.shots
mkdir -p "$OUT"

RPK=$(ls -t dist/*.rpk | head -1)
"$ADB" -s "$SERIAL" shell "am stop $PKG" >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" push "$RPK" "/data/app/$PKG.rpk" >/dev/null
"$ADB" -s "$SERIAL" shell "pm install /data/app/$PKG.rpk" >/dev/null 2>&1 || true

echo "安装中…"
for i in $(seq 1 60); do
  N=$(timeout 20 "$ADB" -s "$SERIAL" logcat -d 2>/dev/null | grep -c 'rpk install ongoing' || true)
  if [ "$N" = "0" ]; then break; fi
  sleep 2
done
sleep 2

timeout 20 "$ADB" -s "$SERIAL" shell "am start $PKG" >/dev/null 2>&1 || true
sleep "$WAIT"
.venv-emu/bin/python tools/emu.py shot "$OUT/$NAME.png" 2>/dev/null | tail -1
echo "截图：$OUT/$NAME.png"
