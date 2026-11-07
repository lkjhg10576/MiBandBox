#!/usr/bin/env bash
# 生成 release/BandBox-<版本>/ 下的构建产物与校验和。
#
# 用法：./tools/make-release.sh [版本] [--prune]
#   版本     缺省读 src/manifest.json 的 versionName
#   --prune  打包后删除旧的 release/BandBox-* 目录与 zip（仓库只保留最新一版）
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VER=""
PRUNE=0
for a in "$@"; do
  case "$a" in
    --prune) PRUNE=1 ;;
    *) VER="$a" ;;
  esac
done
if [ -z "$VER" ]; then
  VER=$(node -p "require('./src/manifest.json').versionName")
fi
DIR="release/BandBox-$VER"
mkdir -p "$DIR"

# jsc 字节码包（更接近发布包）
npm run build:jsc >/dev/null
RPK=$(ls -t dist/*.rpk | head -1)
cp "$RPK" "$DIR/"

# 手机插件：一律从源码现编。
# 旧版本是从 release/BandBox-0.3.x/ 里拷旧 .abp，插件源码一变（如 0.3.0 的动态口令
# 同步）就会漏掉新功能，且旧目录一旦清理就没得拷 —— 现编可保证包内插件与仓库源码一致。
PLUGIN_DIR="plugin/bandbox-lyrics-sync"
PLUGIN_VER=$(node -p "require('./$PLUGIN_DIR/manifest.json').version")
echo "== 构建手机插件 $PLUGIN_VER =="
(cd "$PLUGIN_DIR" && npm run package >/dev/null)
cp "$PLUGIN_DIR/dist/BandBox歌词同步.abp" "$DIR/"

cd "$ROOT/$DIR"
rm -f SHA256SUMS.txt
sha256sum com.miband.box.debug.*.rpk "BandBox歌词同步.abp" > SHA256SUMS.txt
echo "== $DIR =="
ls -l
echo
cat SHA256SUMS.txt

cd "$ROOT"
ZIP="release/BandBox-$VER.zip"
rm -f "$ZIP"
zip -rq "$ZIP" "$DIR"
echo
echo "== $ZIP =="
ls -lh "$ZIP"

if [ "$PRUNE" = "1" ]; then
  echo
  echo "== 清理旧发行版 =="
  for d in release/BandBox-*; do
    [ "$d" = "$DIR" ] && continue
    case "$d" in *.zip) continue ;; esac   # zip 由下面的循环处理
    [ -e "$d" ] || continue
    echo "rm -rf $d"
    rm -rf "$d"
  done
  for z in release/BandBox-*.zip; do
    [ "$z" = "$ZIP" ] && continue
    [ -e "$z" ] || continue
    echo "rm -f $z"
    rm -f "$z"
  done
fi
