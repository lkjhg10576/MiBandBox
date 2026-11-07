#!/usr/bin/env bash
# 冷启动 FMP 实测：重启应用 → 流式抓 logcat → 解析 [perf] 埋点
#
# 用法：
#   ./tools/measure-fmp.sh [次数]     默认 3 次，取中位数
#
# 依赖：已运行的 Vela 模拟器（adb 设备 emulator-5554）+ 已部署的 dist/*.rpk
set -e
cd "$(dirname "$0")/.."
ADB=${ADB:-$HOME/.vela/sdk/tools/adb/linux/adb}
SERIAL=${SERIAL:-emulator-5554}
PKG=com.miband.box
RUNS=${1:-3}
OUT=.shots
mkdir -p "$OUT"

for i in $(seq 1 "$RUNS"); do
  LOG="$OUT/fmp-run-$i.txt"
  ( timeout 40 "$ADB" -s "$SERIAL" logcat -v time 2>/dev/null > "$LOG" ) &
  LPID=$!
  sleep 2
  "$ADB" -s "$SERIAL" shell "am stop $PKG" >/dev/null 2>&1 || true
  sleep 2
  "$ADB" -s "$SERIAL" shell "am start $PKG" >/dev/null 2>&1 || true
  wait $LPID || true
  echo "--- run $i ---"
  node tools/perf-fmp.mjs "$LOG" | tail -6
done
