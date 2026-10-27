#!/usr/bin/env bash
# Builds x264 (the H.264 encoder HandBrake uses) as static libraries for the app's ABIs.
#   modules/compress/android/x264/build.sh <x264 source dir> [ndk dir]
# Output: <abi>/lib/libx264.a and <abi>/include/x264.h, x264_config.h next to this script.
# x264 is GPL-2.0-or-later: an APK that includes it must be distributed under GPL terms.
set -euo pipefail
SRC=$(cd "$1" && pwd)
NDK=${2:-$HOME/Library/Android/sdk/ndk/27.1.12297006}
OUT=$(cd "$(dirname "$0")" && pwd)
API=30
TC=$NDK/toolchains/llvm/prebuilt/darwin-x86_64
[ -d "$TC" ] || TC=$NDK/toolchains/llvm/prebuilt/linux-x86_64

# x264's Makefile can't install into a path with spaces, so install to a temp dir and copy.
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

build() {
  local abi=$1 host=$2 cc=$3 extra=$4
  echo "== $abi"
  rm -rf "$OUT/$abi" "$STAGE/$abi"
  (cd "$SRC" && make distclean >/dev/null 2>&1 || true)
  (cd "$SRC" && CC="$TC/bin/$cc" ./configure \
      --prefix="$STAGE/$abi" --host="$host" --cross-prefix="$TC/bin/llvm-" --sysroot="$TC/sysroot" \
      --enable-static --enable-pic --disable-cli --disable-opencl --bit-depth=8 --chroma-format=420 \
      $extra >/dev/null && make -j8 >/dev/null 2>&1 && make install-lib-static >/dev/null)
  mkdir -p "$OUT/$abi"
  cp -R "$STAGE/$abi/lib" "$STAGE/$abi/include" "$OUT/$abi/"
  rm -rf "$OUT/$abi/lib/pkgconfig"
}

build arm64-v8a aarch64-linux-android aarch64-linux-android$API-clang ""
build armeabi-v7a arm-linux-androideabi armv7a-linux-androideabi$API-clang "--extra-cflags=-mfpu=neon -mfloat-abi=softfp"
# x86 builds are for the emulator only; plain C keeps them free of a nasm dependency.
build x86 i686-linux-android i686-linux-android$API-clang "--disable-asm"
build x86_64 x86_64-linux-android x86_64-linux-android$API-clang "--disable-asm"
(cd "$SRC" && git rev-parse HEAD > "$OUT/X264_COMMIT" 2>/dev/null || true)
(cd "$SRC" && make distclean >/dev/null 2>&1 || true)
echo done
