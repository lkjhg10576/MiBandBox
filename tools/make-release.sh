#!/usr/bin/env bash
# 生成 release/BandBox-<版本>/ 下的构建产物与校验和。
# 用法：./tools/make-release.sh 0.3.5
set -e
cd "$(dirname "$0")/.."
VER=${1:-0.3.5}
DIR="release/BandBox-$VER"
mkdir -p "$DIR"

# jsc 字节码包（更接近发布包）
npm run build:jsc >/dev/null
RPK=$(ls -t dist/*.rpk | head -1)
cp "$RPK" "$DIR/"
cp "release/BandBox-0.3.4/BandBox歌词同步.abp" "$DIR/" 2>/dev/null || true

cd "$DIR"
rm -f SHA256SUMS.txt
sha256sum com.miband.box.debug.*.rpk "BandBox歌词同步.abp" > SHA256SUMS.txt
echo "== $DIR =="
ls -l
echo
cat SHA256SUMS.txt
